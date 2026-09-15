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
 * Every request also sets `data_collection: 'deny'`: OpenRouter then only
 * routes to providers that don't train on or store prompts (`zdr: true` would
 * be stricter still). It filters the pool, fallbacks still happen within it.
 * Student work (feedback images, exam answers) goes through here, and the AVV
 * for schools promises no training.
 */

// A type alias (not an interface) so it casts cleanly to Record<string, unknown>
// where it's spread into the OpenAI SDK params.
export type OpenrouterProviderRouting = {
  provider: {
    data_collection: 'deny'
    order?: string[]
    allow_fallbacks?: boolean
  }
}

/** Privacy-only routing, for routes that must not pick up OPENROUTER_PROVIDERS
 *  (that pin targets the text model's providers). */
export const OPENROUTER_NO_TRAINING: OpenrouterProviderRouting = {
  provider: { data_collection: 'deny' },
}

/**
 * Known-healthy provider order for `deepseek/deepseek-v4-flash` (checked
 * 2026-08-21 via OpenRouter's endpoints API). Excludes providers with poor
 * uptime at the time: Azure (41.7% uptime/30m), DeepSeek official (92.4%),
 * SiliconFlow (88.2%). Re-check periodically — provider health drifts.
 */
export const DEEPSEEK_V4_FLASH_PROVIDERS = ['DigitalOcean', 'DeepInfra', 'GMICloud', 'CoreWeave']

export function openrouterProviderRouting(
  defaultOrder?: string[]
): OpenrouterProviderRouting {
  const raw = process.env.OPENROUTER_PROVIDERS
  const providers = raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : (defaultOrder ?? [])

  if (providers.length === 0) return OPENROUTER_NO_TRAINING

  return {
    provider: {
      data_collection: 'deny',
      order: providers,
      // Fall back to other providers if every named provider is unavailable —
      // worse than the pinned ones but better than failing the request.
      allow_fallbacks: true,
    },
  }
}
