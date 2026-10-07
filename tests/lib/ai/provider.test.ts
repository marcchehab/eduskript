// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { aiModel, modelSpec, STUDENT_DATA } from '@/lib/ai/provider'

const saved = { ...process.env }
beforeEach(() => {
  process.env.INFOMANIAK_AI_TOKEN = 't'
  process.env.INFOMANIAK_AI_PRODUCT_ID = '1'
  process.env.OPENROUTER_API_KEY = 'k'
})
afterEach(() => { process.env = { ...saved } })

describe('aiModel', () => {
  it('sends every student-data purpose to Infomaniak by default', () => {
    for (const p of STUDENT_DATA) expect(aiModel(p).provider).toBe('infomaniak')
  })

  it('refuses a student-data purpose overridden to OpenRouter', () => {
    process.env.AI_MODEL_FEEDBACK = 'openrouter:google/gemini-3.8-flash'
    expect(() => aiModel('feedback')).toThrow(/student work/)
  })

  it('maps camelCase purposes to AI_MODEL_SNAKE env names', () => {
    process.env.AI_MODEL_SCRIPT_IMPORT = 'infomaniak:google/gemma-4-31B-it'
    expect(modelSpec('scriptImport')).toBe('infomaniak:google/gemma-4-31B-it')
  })

  it('strips +nothink and turns thinking off for Infomaniak', () => {
    const m = aiModel('scoring')
    expect(m.model).not.toContain('+nothink')
    expect(m.extra).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })

  it('adds OpenRouter zdr routing for OpenRouter models', () => {
    const m = aiModel('chat')
    expect(m.provider).toBe('openrouter')
    expect((m.extra.provider as { zdr: boolean }).zdr).toBe(true)
  })
})
