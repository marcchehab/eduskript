/**
 * OpenRouter request helpers.
 *
 * OpenRouter routes requests across many providers per model. By default it
 * picks based on cost + load, NOT speed — so a fast-on-paper model like
 * z-ai/glm-4.7 (Cerebras: 575 tok/s) often gets routed to a slower provider
 * (DeepInfra: 62 tok/s, Z.AI: 38 tok/s + 4s TTFT). Without pinning, the
 * perceived latency on AI Edit is much worse than the leaderboard suggests.
 *
 * Set `OPENROUTER_PROVIDERS` to a comma-separated provider name list, e.g.
 *   OPENROUTER_PROVIDERS=Cerebras,Groq
 * to tell OpenRouter "try these in order, fall back to defaults if all
 * unavailable." Provider names are case-sensitive and match the names on
 * https://openrouter.ai (Cerebras, Groq, Google, DeepInfra, Anthropic, etc.).
 *
 * Every request also sets `data_collection: 'deny'`: OpenRouter then skips
 * providers that train on prompts. That alone does NOT exclude providers that
 * retain prompts — e.g. Google AI Studio keeps them 55 days, GMICloud retains
 * too (OpenRouter provider list, checked 2026-09-23). Routes that send student
 * work (AI feedback, AI scoring/rubrics) therefore also set `zdr: true`, which
 * limits the pool to zero-data-retention endpoints: for gemini-3.8-flash that
 * is Google Vertex only, for deepseek-v4-flash DigitalOcean among others
 * (we pin DigitalOcean only). The privacy policy (/datenschutz) and the AVV template promise
 * "no training, no storage" for student data — keep zdr on those routes.
 */

// A type alias (not an interface) so it casts cleanly to Record<string, unknown>
// where it's spread into the OpenAI SDK params.
export type OpenrouterProviderRouting = {
  provider: {
    data_collection: 'deny'
    zdr?: boolean
    order?: string[]
    allow_fallbacks?: boolean
  }
}

/** Privacy-only routing, for routes that must not pick up OPENROUTER_PROVIDERS
 *  (that pin targets the text model's providers). */
export const OPENROUTER_NO_TRAINING: OpenrouterProviderRouting = {
  provider: { data_collection: 'deny' },
}

/** No training AND zero data retention, for requests carrying student work. */
export const OPENROUTER_STUDENT_DATA: OpenrouterProviderRouting = {
  provider: { data_collection: 'deny', zdr: true },
}

/**
 * Gemini vision (AI feedback on handwriting). zdr leaves Google Vertex only,
 * and OpenRouter's default pool holds just the standard `google-vertex/global`
 * endpoint — flex/priority tier endpoints are only used when named (see
 * openrouter.ai/docs/guides/features/service-tiers, "How Routing Works").
 * Standard Vertex had 94.7% uptime over 24h on 2026-09-23 (AI Studio 99.9%, but
 * it retains prompts 55 days), so the priority endpoint (99.8%, ~1.8x price) is
 * named as fallback; it's billed only on requests the standard one fails.
 */
export const OPENROUTER_GEMINI_STUDENT_DATA: OpenrouterProviderRouting = {
  provider: {
    data_collection: 'deny',
    zdr: true,
    order: ['google-vertex/global', 'google-vertex/global/priority'],
    allow_fallbacks: false,
  },
}

/**
 * Known-healthy provider order for `deepseek/deepseek-v4-flash` (checked
 * 2026-08-21 via OpenRouter's endpoints API). Excludes providers with poor
 * uptime at the time: Azure (41.7% uptime/30m), DeepSeek official (92.4%),
 * SiliconFlow (88.2%). 2026-09-23: dropped GMICloud (retains prompts),
 * CoreWeave (no longer serves this model) and DeepInfra (not certified under
 * the Swiss-U.S. Data Privacy Framework; DigitalOcean is). DigitalOcean is
 * no-training, zero-retention, 99.94% uptime/24h at the time. It is listed as
 * a sub-processor on /datenschutz — update that list when changing this one.
 * With zdr (student data) there is no fallback: if DigitalOcean is down, AI
 * scoring fails and the route retries. Teacher-content routes still fall back.
 */
export const DEEPSEEK_V4_FLASH_PROVIDERS = ['DigitalOcean']

export function openrouterProviderRouting(
  defaultOrder?: string[],
  opts: { zdr?: boolean } = {}
): OpenrouterProviderRouting {
  const raw = process.env.OPENROUTER_PROVIDERS
  const providers = raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : (defaultOrder ?? [])

  const base = opts.zdr ? OPENROUTER_STUDENT_DATA : OPENROUTER_NO_TRAINING
  if (providers.length === 0) return base

  return {
    provider: {
      ...base.provider,
      order: providers,
      // Fall back to other providers if every named provider is unavailable —
      // worse than the pinned ones but better than failing the request. Not for
      // student data: the fallback pool holds providers that /datenschutz does
      // not list as sub-processors, so a request fails instead (scoring retries).
      allow_fallbacks: !opts.zdr,
    },
  }
}
