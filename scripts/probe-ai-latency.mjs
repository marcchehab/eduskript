#!/usr/bin/env node
/**
 * probe-ai-latency.mjs
 *
 * Measure REAL-WORLD responsiveness of a model+provider setup by firing
 * representative Eduskript workloads through OpenRouter and timing them.
 *
 * Why this exists separately from rank-ai-models.mjs:
 *   The ranker scores "speed" from OpenRouter's PUBLISHED p50 throughput/TTFT
 *   for the FASTEST-on-paper provider. Production doesn't use that provider —
 *   it routes through OPENROUTER_PROVIDERS (or OpenRouter's cost-based default).
 *   And published TTFT doesn't capture how long a *reasoning* model "thinks"
 *   under our actual prompt shape (big system prompt -> JSON plan). This probe
 *   sends the real shapes and times them end to end, so a clever-but-slow model
 *   shows its true latency. It changes NO scoring — it's a standalone report.
 *
 * What it measures, per (model, prompt), median over --runs:
 *   - TTFT  : ms to the first streamed token of ANY kind (incl. reasoning).
 *   - TTFC  : ms to the first VISIBLE content token (reasoning excluded).
 *             For reasoning models TTFC >> TTFT; TTFC is what the user "sees".
 *   - total : ms wall-clock to completion. This is what the user actually waits
 *             for on plan-generation (prod parses the whole JSON, non-streamed).
 *   - tok/s : completion tokens / generation time (after first token).
 *   - reason: reasoning tokens burned (if the provider reports them).
 *   - served: the provider OpenRouter actually routed to.
 *
 * Requests are issued SEQUENTIALLY (within and across models) so concurrent
 * load doesn't skew the timings — so --all is slow by design.
 *
 * Usage:
 *   node scripts/probe-ai-latency.mjs                         # probe $OPENROUTER_MODEL (default z-ai/glm-5)
 *   node scripts/probe-ai-latency.mjs --model z-ai/glm-5,anthropic/claude-sonnet-4.6
 *   node scripts/probe-ai-latency.mjs --all                  # every model in ai-model-intelligence.json (slow + $$$)
 *   node scripts/probe-ai-latency.mjs --providers Cerebras,Groq   # override OPENROUTER_PROVIDERS for this run (A/B a routing)
 *   node scripts/probe-ai-latency.mjs --runs 5               # medians over 5 runs (default 3)
 *   node scripts/probe-ai-latency.mjs --prompt plan-generation    # only one workload (id from ai-probe-prompts.json)
 *   node scripts/probe-ai-latency.mjs --json                 # machine-readable
 *   pnpm ai:probe
 *
 * Needs OPENROUTER_API_KEY in .env. Honors OPENROUTER_PROVIDERS (same var prod
 * uses) unless --providers overrides it.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import OpenAI from 'openai'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INTEL_CACHE = join(__dirname, 'data', 'ai-model-intelligence.json')
const PROMPTS_FILE = join(__dirname, 'data', 'ai-probe-prompts.json')

const DEFAULT_RUNS = 3

const args = process.argv.slice(2)
const flag = (name, defaultVal) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return defaultVal
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const opts = {
  json: args.includes('--json'),
  all: args.includes('--all'),
  // --no-fallback pins the provider hard (allow_fallbacks: false) so a failed
  // pin errors instead of silently routing elsewhere — lets you measure ONE
  // provider in isolation. Prod (openrouter.ts) always allows fallbacks.
  noFallback: args.includes('--no-fallback'),
  runs: parseInt(flag('runs', DEFAULT_RUNS), 10),
  model: typeof flag('model') === 'string' ? flag('model') : null,
  prompt: typeof flag('prompt') === 'string' ? flag('prompt') : null,
  providers: typeof flag('providers') === 'string' ? flag('providers') : null,
}

function providerRouting() {
  // Mirror src/lib/ai/openrouter.ts: comma list -> { provider: { order, allow_fallbacks } }.
  // --providers overrides the OPENROUTER_PROVIDERS env for this run.
  const raw = opts.providers ?? process.env.OPENROUTER_PROVIDERS
  if (!raw) return {}
  const order = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (order.length === 0) return {}
  return { provider: { order, allow_fallbacks: !opts.noFallback } }
}

function median(nums) {
  const xs = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/**
 * Fire one streaming completion and time it. Returns null on error (logged).
 * TTFT = first delta of any kind; TTFC = first delta carrying `content`.
 * Reasoning deltas arrive as `delta.reasoning` (OpenRouter extension).
 */
async function probeOnce(client, model, prompt, routing) {
  const t0 = performance.now()
  let ttft = null
  let ttfc = null
  let served = null
  let usage = null
  let contentChars = 0

  try {
    const stream = await client.chat.completions.create({
      model,
      max_tokens: prompt.max_tokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      ...routing,
    })

    for await (const chunk of stream) {
      // OpenRouter stamps the routed provider on each chunk (non-standard field).
      if (!served && chunk.provider) served = chunk.provider
      if (chunk.usage) usage = chunk.usage

      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue
      const hasReasoning = typeof delta.reasoning === 'string' && delta.reasoning.length > 0
      const hasContent = typeof delta.content === 'string' && delta.content.length > 0
      if (ttft === null && (hasReasoning || hasContent)) ttft = performance.now() - t0
      if (ttfc === null && hasContent) ttfc = performance.now() - t0
      if (hasContent) contentChars += delta.content.length
    }
  } catch (e) {
    console.error(`  ! ${model} / ${prompt.id}: ${e.message}`)
    return null
  }

  const total = performance.now() - t0
  const completionTokens = usage?.completion_tokens ?? null
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null
  // Throughput over the generation window (after first token), the honest rate.
  const genWindow = ttft != null ? (total - ttft) / 1000 : null
  // Guard the artifact where the whole response lands in ~one chunk right after
  // TTFT: genWindow ~0 makes tok/s explode (saw 169725). Need a real window.
  const tokPerSec =
    completionTokens != null && genWindow && genWindow > 0.2
      ? completionTokens / genWindow
      : null

  return { ttft, ttfc, total, completionTokens, reasoningTokens, tokPerSec, served, contentChars }
}

async function probeModel(client, model, prompts, routing) {
  const results = []
  for (const prompt of prompts) {
    const runs = []
    for (let i = 0; i < opts.runs; i++) {
      const r = await probeOnce(client, model, prompt, routing)
      if (r) runs.push(r)
      process.stderr.write('.')
    }
    if (runs.length === 0) {
      results.push({ promptId: prompt.id, label: prompt.label, ok: false })
      continue
    }
    results.push({
      promptId: prompt.id,
      label: prompt.label,
      ok: true,
      runs: runs.length,
      ttft: median(runs.map(r => r.ttft)),
      ttfc: median(runs.map(r => r.ttfc)),
      total: median(runs.map(r => r.total)),
      tokPerSec: median(runs.map(r => r.tokPerSec)),
      completionTokens: median(runs.map(r => r.completionTokens)),
      reasoningTokens: median(runs.map(r => r.reasoningTokens)),
      served: runs.find(r => r.served)?.served ?? '—',
    })
  }
  process.stderr.write('\n')
  return { model, prompts: results }
}

function fmtMs(ms) {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}
function fmtNum(n, suffix = '') {
  return n == null ? '—' : `${Math.round(n)}${suffix}`
}

function printMarkdown(report, routing) {
  const routeDesc = routing.provider
    ? routing.provider.order.join(' → ') + (routing.provider.allow_fallbacks ? ' (fallbacks on)' : ' (pinned, no fallback)')
    : 'OpenRouter default (cost/load)'
  console.log()
  console.log(`Provider routing: ${routeDesc}`)
  console.log(`Runs per cell: ${opts.runs} (medians shown). Sequential requests.`)
  console.log()

  // Group output by prompt so models are directly comparable on each workload.
  const promptIds = report[0]?.prompts.map(p => p.promptId) ?? []
  for (const pid of promptIds) {
    const label = report[0].prompts.find(p => p.promptId === pid)?.label ?? pid
    console.log(`### ${label}`)
    console.log()
    console.log('| Model                                   | Served       | TTFT  | TTFC  | Total  | tok/s | Reason tok |')
    console.log('|-----------------------------------------|--------------|-------|-------|--------|-------|------------|')
    const rows = report
      .map(m => ({ model: m.model, p: m.prompts.find(x => x.promptId === pid) }))
      .filter(r => r.p)
      .sort((a, b) => (a.p.ok ? a.p.total : Infinity) - (b.p.ok ? b.p.total : Infinity))
    for (const { model, p } of rows) {
      if (!p.ok) {
        console.log(`| ${model.padEnd(39)} | ${'FAILED'.padEnd(12)} | ${'—'.padStart(5)} | ${'—'.padStart(5)} | ${'—'.padStart(6)} | ${'—'.padStart(5)} | ${'—'.padStart(10)} |`)
        continue
      }
      console.log(
        `| ${model.padEnd(39)} | ${String(p.served).padEnd(12)} | ${fmtMs(p.ttft).padStart(5)} | ${fmtMs(p.ttfc).padStart(5)} | ${fmtMs(p.total).padStart(6)} | ${fmtNum(p.tokPerSec).padStart(5)} | ${fmtNum(p.reasoningTokens).padStart(10)} |`
      )
    }
    console.log()
  }

  console.log('TTFT = first token of any kind (incl. reasoning). TTFC = first visible content token.')
  console.log('Total = wall-clock to completion (what the user waits for on non-streamed plan generation).')
  console.log('A big TTFC-minus-TTFT gap or high "Reason tok" means the model thinks a lot before answering — the usual cause of "clever but slow".')
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY not set — add it to .env. This probe makes real (billed) OpenRouter calls.')
    process.exit(1)
  }

  const promptData = JSON.parse(readFileSync(PROMPTS_FILE, 'utf-8'))
  let prompts = promptData.prompts
  if (opts.prompt) {
    prompts = prompts.filter(p => p.id === opts.prompt)
    if (prompts.length === 0) {
      console.error(`No prompt with id "${opts.prompt}". Available: ${promptData.prompts.map(p => p.id).join(', ')}`)
      process.exit(1)
    }
  }

  let models
  if (opts.model) {
    models = opts.model.split(',').map(s => s.trim()).filter(Boolean)
  } else if (opts.all) {
    models = Object.keys(JSON.parse(readFileSync(INTEL_CACHE, 'utf-8')).models)
  } else {
    models = [process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5']
  }

  const routing = providerRouting()
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })

  console.error(`Probing ${models.length} model(s) × ${prompts.length} prompt(s) × ${opts.runs} run(s) = ${models.length * prompts.length * opts.runs} calls...`)

  const report = []
  for (const model of models) {
    console.error(`\n${model}`)
    report.push(await probeModel(client, model, prompts, routing))
  }

  if (opts.json) {
    console.log(JSON.stringify({ routing, runs: opts.runs, report }, null, 2))
    return
  }
  printMarkdown(report, routing)
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
