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
 */

export interface OpenrouterProviderRouting {
  provider: {
    order: string[]
    allow_fallbacks: boolean
  }
}

export function openrouterProviderRouting(): OpenrouterProviderRouting | Record<string, never> {
  const raw = process.env.OPENROUTER_PROVIDERS
  if (!raw) return {}

  const providers = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  if (providers.length === 0) return {}

  return {
    provider: {
      order: providers,
      // Fall back to other providers if every named provider is unavailable —
      // worse than the pinned ones but better than failing the request.
      allow_fallbacks: true,
    },
  }
}
