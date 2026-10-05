import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import OpenAI from 'openai'
import { PLUGIN_AUTHORING_PROMPT, extractPluginHtml } from '@/lib/ai/plugin-prompt'
import { openrouterRouting } from '@/lib/ai/openrouter'

const CONTENT_MODEL = 'deepseek/deepseek-v4.1-flash'

// Upper bound on how long one Generate click may take, across all attempts.
// Each OpenAI call gets the remaining budget as its timeout and no new attempt
// starts once it is used up. Before this, 3 attempts ran back to back and a
// teacher waited 2.8 min (QA finding ai-plugin-generate-too-large-after-3min).
const TOTAL_BUDGET_MS = 120_000
// Below this many attempt-seconds left, another attempt is not worth starting.
const MIN_ATTEMPT_MS = 15_000
// finish_reason 'length' with less text than this means the model spent its
// max_tokens on reasoning and barely started the HTML; that is not "too large".
// Heuristic: a finished plugin is usually several thousand chars.
const NEARLY_EMPTY_CHARS = 4000

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `${PLUGIN_AUTHORING_PROMPT}

## Output Format

Return ONLY raw HTML content (the <style>, <div>, and <script> tags).
Do NOT wrap in JSON. Do NOT wrap in markdown fences. Just the HTML.`

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isPaidUser(session.user)) {
    return paidOnlyResponse('AI plugin generation is a paid feature.')
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
  }

  // Rate limiting (DB-backed)
  const recentJobs = await prisma.importJob.count({
    where: {
      userId: session.user.id,
      type: 'plugin-generate',
      createdAt: { gt: new Date(Date.now() - 60_000) },
    },
  })
  if (recentJobs >= 10) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please wait.' }, { status: 429 })
  }

  const { prompt, currentHtml } = await request.json()
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Track the request as a rate-limit marker. We reuse the import_jobs
  // table only because it gives us per-user time-bucketed counting; this
  // row is NOT a real import. Write it as terminal ('completed') so the
  // dashboard's active-import polling never picks it up — past attempts
  // wrote 'processing' and left these rows hanging forever, surfacing the
  // prompt text in the import-progress UI.
  await prisma.importJob.create({
    data: {
      userId: session.user.id,
      type: 'plugin-generate',
      status: 'completed',
      progress: 100,
      message: prompt.slice(0, 200),
      result: {},
      completedAt: new Date(),
    },
  })

  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://eduskript.org',
      'X-Title': 'Eduskript',
    },
    // Our loop below is the only retry; the SDK's own retries would multiply
    // the wait beyond TOTAL_BUDGET_MS.
    maxRetries: 0,
  })

  // Build user message: if there's existing HTML, this is an edit request
  let userMessage: string
  if (currentHtml?.trim()) {
    userMessage = `Here is the current plugin HTML:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nApply this change: ${prompt}`
  } else {
    userMessage = prompt
  }

  const MAX_RETRIES = 3
  const deadline = Date.now() + TOTAL_BUDGET_MS
  const timeoutResponse = () =>
    NextResponse.json(
      { error: 'The AI took too long to respond. Please try again, or describe the plugin more briefly.' },
      { status: 504 }
    )
  let lastTruncatedLength = 0

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now()
    if (attempt > 1 && remaining < MIN_ATTEMPT_MS) {
      return lastTruncatedLength > 0 ? truncatedResponse(lastTruncatedLength) : timeoutResponse()
    }
    try {
      const response = await openai.chat.completions.create({
        // deepseek-v4.1-flash (successor of v4-flash, chosen 2026-08 over glm-5.2
        // for price at comparable German quality, see docs/ai-model-selection-eval.md).
        model: CONTENT_MODEL,
        max_tokens: 16384,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        ...(openrouterRouting(CONTENT_MODEL) as Record<string, unknown>),
      }, { timeout: Math.max(remaining, 1_000) })

      const text = response.choices[0]?.message?.content ?? ''
      const finishReason = response.choices[0]?.finish_reason

      // If truncated, retry
      if (finishReason === 'length') {
        console.warn(`Plugin generation attempt ${attempt}/${MAX_RETRIES} truncated at ${text.length} chars`)
        lastTruncatedLength = text.length
        if (attempt < MAX_RETRIES) continue
        return truncatedResponse(text.length)
      }

      if (!text.trim()) {
        if (attempt < MAX_RETRIES) continue
        return NextResponse.json({ error: 'AI returned an empty response. Please try again.' }, { status: 500 })
      }

      // Strip markdown fences and any chat prose around them
      const cleaned = extractPluginHtml(text)

      return NextResponse.json({ entryHtml: cleaned })
    } catch (error) {
      console.error(`Plugin generation attempt ${attempt} failed:`, error)
      if (error instanceof Error && error.name === 'APIConnectionTimeoutError') {
        return timeoutResponse()
      }
      if (attempt >= MAX_RETRIES) {
        return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ error: 'AI generation failed after retries' }, { status: 500 })
}

// finish_reason 'length' on the last attempt. Only call it "too large" when
// the model actually wrote a lot; a nearly empty cut-off means it ran out of
// tokens while reasoning, and the fix is retrying, not simplifying.
function truncatedResponse(textLength: number) {
  if (textLength < NEARLY_EMPTY_CHARS) {
    return NextResponse.json(
      { error: 'The AI stopped before finishing the plugin. Please try again.' },
      { status: 502 }
    )
  }
  return NextResponse.json(
    { error: 'Generated plugin was too large. Try simplifying your description.' },
    { status: 422 }
  )
}
