import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { openrouterProviderRouting } from '@/lib/ai/openrouter'
import {
  EXCALIDRAW_SYSTEM_PROMPT,
  buildUserPrompt,
  buildRetryPrompt,
  stripMermaidFences,
} from '@/lib/ai/excalidraw-prompt'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Same in-memory rate-limit shape as src/app/api/ai/chat/route.ts.
// 20 generations per minute is generous for a one-shot, non-streaming call.
const requestCounts = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20
const RATE_WINDOW = 60 * 1000

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const record = requestCounts.get(userId)
  if (!record || now > record.resetAt) {
    requestCounts.set(userId, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  if (record.count >= RATE_LIMIT) return false
  record.count++
  return true
}

interface RequestBody {
  prompt?: string
  language?: 'en' | 'de'
  // When the previous server response failed to parse client-side, the client
  // may retry once with the failed Mermaid + parser error so the model can
  // self-correct. Both fields required when retrying.
  retryWith?: {
    mermaid?: string
    error?: string
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'AI service not configured' }, { status: 503 })
    }

    if (!checkRateLimit(session.user.id)) {
      return Response.json(
        { error: 'Rate limit exceeded. Please wait a moment before generating again.' },
        { status: 429 }
      )
    }

    const body = (await request.json()) as RequestBody
    const prompt = body.prompt?.trim()
    const language: 'en' | 'de' = body.language === 'de' ? 'de' : 'en'

    if (!prompt) {
      return Response.json({ error: 'Missing prompt' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return Response.json({ error: 'Prompt too long (max 2000 chars)' }, { status: 400 })
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
    })

    const userMessage =
      body.retryWith?.mermaid && body.retryWith?.error
        ? buildRetryPrompt(prompt, language, body.retryWith.mermaid, body.retryWith.error)
        : buildUserPrompt(prompt, language)

    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'z-ai/glm-5',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: EXCALIDRAW_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      ...(openrouterProviderRouting() as Record<string, unknown>),
    })

    const raw = completion.choices[0]?.message?.content ?? ''
    const mermaid = stripMermaidFences(raw)
    if (!mermaid) {
      // Log the raw model output so we can diagnose. Empty responses usually
      // mean the model refused, hit a content filter, or got confused by the
      // retry context. Log the first 500 chars to keep the log bounded.
      console.warn('[ai/excalidraw] Empty mermaid after stripping fences', {
        rawLength: raw.length,
        rawPreview: raw.slice(0, 500),
        finishReason: completion.choices[0]?.finish_reason,
        isRetry: !!body.retryWith,
      })
      return Response.json(
        { error: 'AI returned an empty diagram. Try rephrasing your prompt.' },
        { status: 502 }
      )
    }

    return Response.json({ mermaid })
  } catch (error) {
    console.error('AI Excalidraw error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
