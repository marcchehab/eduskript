/**
 * One place that decides which AI provider and model serves which purpose.
 *
 * Model specs are `<provider>:<model>[+nothink]`:
 *   - `openrouter:google/gemini-3.5-flash-lite` — OpenRouter, with the zdr /
 *     throughput / Vertex routing from openrouter.ts.
 *   - `infomaniak:Qwen/Qwen3.5-397B-A17B-FP8+nothink` — Infomaniak AI Services
 *     (OpenAI-compatible, Swiss data centres, prompts not stored or used for
 *     training per their LLM API terms art. 6). `+nothink` turns off Qwen's
 *     reasoning (vLLM chat_template_kwargs).
 *
 * Each purpose has a default below and can be overridden per environment with
 * AI_MODEL_<PURPOSE>, e.g. AI_MODEL_CHAT=infomaniak:mistralai/Mistral-Small-4-119B-2603.
 *
 * Student data rule: purposes that send student work (STUDENT_DATA) must use
 * Infomaniak. /datenschutz and the AVV promise that student data stays in
 * Switzerland; aiModel() throws instead of silently sending it elsewhere.
 *
 * Measured 2026-10-07 on 60 real paper-exam crops against the teacher's
 * confirmed points (korrektur tool, ~/Documents/1_Projekte/korrektur):
 * Qwen3.5-397B on Infomaniak without thinking 78 % exact / 97 % within 0.5,
 * ~18 s per scoring; Gemini 3.8 Flash (previous default) 76 % / 98 %, ~5 s.
 * With thinking: 81 % / 95 %, ~85 s, ~4x the tokens.
 */

import OpenAI from 'openai'
import { openrouterRouting } from './openrouter'

export type AiPurpose =
  | 'feedback'      // ai-feedback on student handwriting/drawings (vision)
  | 'scoring'       // AI scoring of exam answers + rubric generation from samples
  | 'chat'          // teacher AI chat
  | 'plan'          // AI Edit planning / agent (tool calling)
  | 'content'       // AI Edit page content
  | 'diagram'       // Excalidraw generation
  | 'plugin'        // plugin generation
  | 'scriptImport'  // cleanup of imported teacher material (vision; may contain student data)

export type AiProvider = 'openrouter' | 'infomaniak'

const QWEN_CH = 'infomaniak:Qwen/Qwen3.5-397B-A17B-FP8+nothink'

const DEFAULTS: Record<AiPurpose, string> = {
  feedback: QWEN_CH,
  scoring: QWEN_CH,
  chat: 'openrouter:google/gemini-3.5-flash-lite',
  plan: 'openrouter:google/gemini-3.5-flash-lite',
  content: 'openrouter:deepseek/deepseek-v4.1-flash',
  diagram: 'openrouter:deepseek/deepseek-v4.1-flash',
  plugin: 'openrouter:z-ai/glm-5.2',
  scriptImport: QWEN_CH,
}

/** Purposes whose requests contain student work. Must stay on Infomaniak. */
export const STUDENT_DATA: readonly AiPurpose[] = ['feedback', 'scoring', 'scriptImport']

export interface AiModel {
  provider: AiProvider
  /** Model id as the provider expects it (no prefix, no +nothink). */
  model: string
  /** The full spec, e.g. for storing which model produced a score. */
  spec: string
  client: OpenAI
  /** Provider-specific request fields to spread into chat.completions.create. */
  extra: Record<string, unknown>
}

export function modelSpec(purpose: AiPurpose): string {
  const env = process.env[`AI_MODEL_${purpose.replace(/[A-Z]/g, c => '_' + c).toUpperCase()}`]
  return env?.trim() || DEFAULTS[purpose]
}

function parseSpec(spec: string): { provider: AiProvider; model: string; nothink: boolean } {
  const m = spec.match(/^(openrouter|infomaniak):(.+?)(\+nothink)?$/)
  if (!m) throw new Error(`Invalid AI model spec "${spec}" (expected <openrouter|infomaniak>:<model>)`)
  return { provider: m[1] as AiProvider, model: m[2], nothink: !!m[3] }
}

/** True when the provider for this purpose has credentials; routes answer 503 otherwise. */
export function aiConfigured(purpose: AiPurpose): boolean {
  const { provider } = parseSpec(modelSpec(purpose))
  return provider === 'openrouter'
    ? !!process.env.OPENROUTER_API_KEY
    : !!(process.env.INFOMANIAK_AI_TOKEN && process.env.INFOMANIAK_AI_PRODUCT_ID)
}

const clients = new Map<AiProvider, OpenAI>()

function clientFor(provider: AiProvider): OpenAI {
  let c = clients.get(provider)
  if (c) return c
  c = provider === 'openrouter'
    ? new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
      })
    : new OpenAI({
        apiKey: process.env.INFOMANIAK_AI_TOKEN,
        baseURL: `https://api.infomaniak.com/2/ai/${process.env.INFOMANIAK_AI_PRODUCT_ID}/openai/v1`,
      })
  clients.set(provider, c)
  return c
}

export function aiModel(purpose: AiPurpose): AiModel {
  const spec = modelSpec(purpose)
  const { provider, model, nothink } = parseSpec(spec)
  if (STUDENT_DATA.includes(purpose) && provider !== 'infomaniak') {
    throw new Error(`AI purpose "${purpose}" sends student work and must use Infomaniak (got "${spec}")`)
  }
  const extra: Record<string, unknown> = provider === 'openrouter'
    ? { ...openrouterRouting(model) }
    : nothink ? { chat_template_kwargs: { enable_thinking: false } } : {}
  return { provider, model, spec, client: clientFor(provider), extra }
}
