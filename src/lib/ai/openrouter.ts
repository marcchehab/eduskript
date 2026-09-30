/**
 * OpenRouter request helpers.
 *
 * Every request goes through `openrouterRouting(model)`, which sets:
 *   - `data_collection: 'deny'` — skip providers that train on prompts.
 *   - `zdr: true` — only zero-data-retention endpoints. `data_collection`
 *     alone does NOT exclude providers that retain prompts (Google AI Studio
 *     keeps them 55 days, GMICloud retains too; checked 2026-09-23). The
 *     privacy policy (/datenschutz) and the AVV template promise "no training,
 *     no storage" for student data; teacher content gets the same treatment so
 *     there is one routing rule, not two.
 *   - `sort: 'throughput'` — among the remaining endpoints, fastest first.
 *     OpenRouter's default picks by price + load, not speed. Measured
 *     2026-09-30 on an AI Edit page rewrite (~3k in / ~4k out tokens):
 *     deepseek-v4-flash pinned to DigitalOcean took 144–151 s, the same model
 *     on Novita 12–24 s; deepseek-v4.1-flash with zdr + throughput sort 7–9 s.
 *     Bench scripts were ad hoc (not in the repo).
 *
 * Gemini models are pinned to Google Vertex instead (see OPENROUTER_GEMINI).
 *
 * `OPENROUTER_PROVIDERS` (comma-separated provider names, case-sensitive as
 * on openrouter.ai) overrides the order for non-Gemini models. zdr still
 * applies, so the fallback pool is ZDR-only too.
 *
 * Which providers end up serving teacher-content requests changes with
 * OpenRouter's ZDR list; /datenschutz covers them as "Weitere Modellanbieter".
 * Student work (scoring, AI feedback) goes to Gemini on Vertex only — keep it
 * that way unless /datenschutz lists the new provider (AVV: 30 days' notice).
 */

// A type alias (not an interface) so it casts cleanly to Record<string, unknown>
// where it's spread into the OpenAI SDK params.
export type OpenrouterProviderRouting = {
  provider: {
    data_collection: 'deny'
    zdr: true
    sort?: 'throughput'
    order?: string[]
    allow_fallbacks?: boolean
  }
}

const OPENROUTER_ZDR: OpenrouterProviderRouting = {
  provider: { data_collection: 'deny', zdr: true, sort: 'throughput' },
}

/**
 * Gemini on Google Vertex. zdr leaves Vertex only, and OpenRouter's default
 * pool holds just the standard `google-vertex/global` endpoint — flex/priority
 * tier endpoints are only used when named (see
 * openrouter.ai/docs/guides/features/service-tiers, "How Routing Works").
 * Standard Vertex had 94.7% uptime over 24h on 2026-09-23 and 96.5% (3.8-flash)
 * / 99.8% (3.5-flash-lite) on 2026-09-30, so the priority endpoint (~1.8x
 * price, 99.9%) is named as fallback; it's billed only on requests the
 * standard one fails. No further fallback: Vertex is the only Gemini ZDR host.
 */
const OPENROUTER_GEMINI: OpenrouterProviderRouting = {
  provider: {
    data_collection: 'deny',
    zdr: true,
    order: ['google-vertex/global', 'google-vertex/global/priority'],
    allow_fallbacks: false,
  },
}

export function openrouterRouting(model: string): OpenrouterProviderRouting {
  if (model.startsWith('google/')) return OPENROUTER_GEMINI

  const providers = (process.env.OPENROUTER_PROVIDERS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (providers.length === 0) return OPENROUTER_ZDR

  return {
    provider: {
      ...OPENROUTER_ZDR.provider,
      order: providers,
      // The fallback pool is ZDR-only as well, so falling back is safe.
      allow_fallbacks: true,
    },
  }
}
