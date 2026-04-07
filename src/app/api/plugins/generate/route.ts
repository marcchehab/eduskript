import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are an expert plugin generator for Eduskript, an education platform.
You create self-contained HTML plugins that run inside sandboxed iframes.

## Plugin SDK

The host injects an SDK. Your plugin must call eduskript.init() to communicate:

\`\`\`js
var plugin = eduskript.init();

// Called once when the host sends initial data
plugin.onReady(function(ctx) {
  // ctx.config  — attributes from markdown (e.g., { mode: "quiz" })
  // ctx.data    — previously saved state, or null
  // ctx.theme   — "light" or "dark"
});

// Persist state (host validates: <1MB, rate-limited 2/s)
plugin.setData({ state: { /* your data */ }, updatedAt: Date.now() });

// Request current saved state
plugin.getData().then(function(data) { /* ... */ });

// React to theme changes
plugin.onThemeChange(function(theme) { /* "light" or "dark" */ });

// React to external data changes (teacher broadcast, multi-device sync)
plugin.onDataChanged(function(data) { /* ... */ });

// Resize the iframe (host auto-adjusts)
plugin.resize(height);
\`\`\`

## Constraints

- Output ONLY the HTML body content (no <!DOCTYPE>, <html>, <head>, or <body> tags — the host wraps your output)
- Use inline <style> and <script> tags
- You CAN use CDN libraries from: cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com
- You CANNOT use fetch(), XMLHttpRequest, or WebSocket (blocked by CSP)
- Support both light and dark themes via the onThemeChange callback
- Use 'var' instead of 'let/const' for maximum browser compatibility in the sandbox
- Keep it simple, educational, and visually polished
- Always call eduskript.init() and plugin.onReady()

## Output Format

Return ONLY raw HTML content (the <style>, <div>, and <script> tags).
Do NOT wrap in JSON. Do NOT wrap in markdown fences. Just the HTML.`

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // Track the request
  await prisma.importJob.create({
    data: {
      userId: session.user.id,
      type: 'plugin-generate',
      status: 'processing',
      progress: 0,
      message: prompt.slice(0, 200),
      result: {},
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
        model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
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
