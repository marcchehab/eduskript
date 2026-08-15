import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import OpenAI from 'openai'
import { PLUGIN_AUTHORING_PROMPT } from '@/lib/ai/plugin-prompt'

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
  })

  // Build user message: if there's existing HTML, this is an edit request
  let userMessage: string
  if (currentHtml?.trim()) {
    userMessage = `Here is the current plugin HTML:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nApply this change: ${prompt}`
  } else {
    userMessage = prompt
  }

  const MAX_RETRIES = 3

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        // deepseek-v4-flash: ~15x cheaper than glm-5.2:nitro at comparable/better
        // German quality, no dedicated-fast-provider tier needed (see docs/ai-model-selection-eval.md)
        model: 'deepseek/deepseek-v4-flash',
        max_tokens: 16384,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      })

      const text = response.choices[0]?.message?.content ?? ''
      const finishReason = response.choices[0]?.finish_reason

      // If truncated, retry
      if (finishReason === 'length') {
        console.warn(`Plugin generation attempt ${attempt}/${MAX_RETRIES} truncated at ${text.length} chars`)
        if (attempt < MAX_RETRIES) continue
        return NextResponse.json({ error: 'Generated plugin was too large. Try simplifying your description.' }, { status: 422 })
      }

      if (!text.trim()) {
        if (attempt < MAX_RETRIES) continue
        return NextResponse.json({ error: 'AI returned an empty response. Please try again.' }, { status: 500 })
      }

      // Strip markdown fences if the model wrapped the response
      const cleaned = text.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

      return NextResponse.json({ entryHtml: cleaned })
    } catch (error) {
      console.error(`Plugin generation attempt ${attempt} failed:`, error)
      if (attempt >= MAX_RETRIES) {
        return NextResponse.json({ error: 'AI generation failed' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ error: 'AI generation failed after retries' }, { status: 500 })
}
