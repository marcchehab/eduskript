import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { isPaidUser, paidOnlyResponse } from '@/lib/billing'
import type { SkriptContext } from '@/lib/ai/types'
import { loadFrontPageContext } from '@/lib/ai/frontpage-context'
import { openrouterProviderRouting } from '@/lib/ai/openrouter'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai:edit:agent')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/ai/edit/agent — Conversational, tool-calling edit turn.
 *
 * Unlike /api/ai/edit (which only PLANS edits and returns "no changes needed"
 * for anything conversational), this endpoint lets the model TALK about the
 * skript and, when the user wants changes, emit edit_page / create_page tool
 * calls. Each tool call becomes an edit card in the chat, with an optional
 * `note` the model writes as a natural lead-in ("Now the headings…"), so prose
 * and edits interleave like Claude Code.
 *
 * It returns the SAME { jobId, plan } shape the existing generate route + the
 * client `drive()` loop already understand (so per-card content is still
 * produced by /api/ai/edit/[jobId]/generate), plus:
 *   - content: the assistant's conversational message
 *   - plan.pages[].note: per-edit lead-in prose
 *
 * v1 scope: ONE model round per user message (the model emits its prose + all
 * its tool calls at once; notes provide the interleave). Multi-round reaction
 * to generated content (feeding tool results back) is a future enhancement.
 */

type ChatMsg = { role: 'user' | 'assistant'; content: string }

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'edit_page',
      description: 'Propose an edit to an EXISTING page in this skript. Use the exact pageId from the context.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'Exact ID of the page to edit, as shown in the context.' },
          note: { type: 'string', description: 'A short first-person lead-in shown just before this edit card, e.g. "Now tightening the intro." Keep it to one sentence.' },
          summary: { type: 'string', description: 'Precise description of the change; this is used to generate the new page content.' },
        },
        required: ['pageId', 'summary'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_page',
      description: 'Propose creating a NEW page in this skript.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the new page.' },
          slug: { type: 'string', description: 'URL slug, lowercase and hyphenated.' },
          note: { type: 'string', description: 'A short first-person lead-in shown just before this edit card. One sentence.' },
          summary: { type: 'string', description: 'What the new page should contain; used to generate its content.' },
        },
        required: ['title', 'slug', 'summary'],
      },
    },
  },
]

function buildSystemPrompt(ctx: SkriptContext, orgPrompt: string | undefined, focusedPageId?: string): string {
  const pageLines = ctx.pages
    .map(p => `- ID: ${p.id} | "${p.title}" (slug: ${p.slug})${p.id === focusedPageId ? ' [currently open]' : ''}`)
    .join('\n')
  const focused = focusedPageId ? ctx.pages.find(p => p.id === focusedPageId) : undefined

  return `You are an AI co-author helping a teacher with their Eduskript skript. You can BOTH:
1. Discuss the skript — answer questions, give feedback, suggest ideas — in plain prose.
2. Make changes — when the teacher wants edits, call the edit_page / create_page tools.

Guidelines:
- Act ONLY on the teacher's LATEST message. Earlier messages are context, not a to-do list — never repeat or re-run edits already mentioned earlier in the conversation.
- If the latest message is a QUESTION or discussion (e.g. "which pages do you see?", "what do you think of this?"), answer it in prose with NO tool calls at all. Calling a tool when the teacher only asked a question is wrong.
- Call edit_page / create_page ONLY when the latest message explicitly asks to change, add, or remove content.
- LANGUAGE: write EVERYTHING the teacher reads — your message content AND every \`note\` — in the same language the teacher is writing in (and that the skript content / site guidelines use). Never switch to English for the notes while chatting in another language; keep one consistent language across the whole reply.
- For each tool call, write a short natural lead-in in \`note\` ("Now I'll tighten the intro." — but in the conversation's language). These are shown in order with the edit cards, so your message + notes should read as one flowing explanation.
- Use the EXACT pageId from the context for edit_page. Do not invent IDs.
- You may call multiple tools in one turn (e.g. edit two pages).
${orgPrompt ? `\n${orgPrompt}\n` : ''}
## Skript: "${ctx.skript.title}"${ctx.skript.description ? ` — ${ctx.skript.description}` : ''}
Pages (in order):
${pageLines || '(no pages yet)'}
${focused ? `\n## Currently open page "${focused.title}" content:\n${focused.content}` : ''}`
}

export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  if (!isPaidUser(session.user)) {
    return paidOnlyResponse('AI editing is a paid feature.')
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json({ success: false, error: 'AI service not configured' }, { status: 503 })
  }

  const recentJobs = await prisma.importJob.count({
    where: { userId, type: 'ai-edit', createdAt: { gt: new Date(Date.now() - 60_000) } },
  })
  if (recentJobs >= 15) {
    return Response.json({ success: false, error: 'Rate limit exceeded. Please wait a moment.' }, { status: 429 })
  }

  const body = (await request.json()) as {
    skriptId?: string
    pageId?: string
    frontPageId?: string
    currentContent?: string
    messages?: ChatMsg[]
  }
  const { skriptId, pageId, frontPageId, currentContent } = body
  const messages = Array.isArray(body.messages) ? body.messages.filter(m => m?.content?.trim()) : []

  if (messages.length === 0) {
    return Response.json({ success: false, error: 'No message provided' }, { status: 400 })
  }
  if ((!skriptId && !frontPageId) || (skriptId && frontPageId)) {
    return Response.json({ success: false, error: 'Provide exactly one of skriptId or frontPageId' }, { status: 400 })
  }

  const latestUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''

  // Build context. Frontpage mode keeps the trivial single-edit behaviour (no
  // conversational tools) — the agent chat is a skript-mode feature.
  let skriptContext: SkriptContext
  if (frontPageId) {
    const ctx = await loadFrontPageContext({ frontPageId, userId, isAdmin: !!session.user.isAdmin, currentContent })
    if (!ctx.ok) return Response.json({ success: false, error: ctx.error }, { status: ctx.status })
    const plan = {
      totalEdits: 1,
      overallSummary: latestUser,
      pages: [{ pageId: frontPageId, pageTitle: 'Front Page', pageSlug: 'frontpage', summary: latestUser, isNew: false, note: '' }],
    }
    const job = await prisma.importJob.create({
      data: {
        userId, type: 'ai-edit', status: 'processing', progress: 0, message: 'Frontpage edit',
        result: { skriptId: null, frontPageId, instruction: latestUser, focusedPageId: frontPageId, currentContent: currentContent || null, plan, completedEdits: [], failedPages: [] },
      },
    })
    return Response.json({ success: true, content: '', jobId: job.id, plan })
  }

  const skript = await prisma.skript.findUnique({
    where: { id: skriptId! },
    include: {
      pages: { orderBy: { order: 'asc' } },
      authors: { include: { user: true } },
      files: { select: { id: true, name: true, contentType: true } },
    },
  })
  if (!skript) return Response.json({ success: false, error: 'Skript not found' }, { status: 404 })

  if (!checkSkriptPermissions(userId, skript.authors, !!session.user.isAdmin).canEdit) {
    return Response.json({ success: false, error: 'Edit access denied' }, { status: 403 })
  }

  const pageContentMap = new Map<string, string>()
  skript.pages.forEach(p => {
    pageContentMap.set(p.id, pageId && p.id === pageId && currentContent !== undefined ? currentContent : p.content)
  })
  skriptContext = {
    skript: { id: skript.id, title: skript.title, description: skript.description, slug: skript.slug, isPublished: skript.isPublished },
    pages: skript.pages.map(p => ({ id: p.id, title: p.title, slug: p.slug, content: pageContentMap.get(p.id) || p.content, order: p.order, isPublished: p.isPublished })),
    files: skript.files,
    focusedPageId: pageId,
  }

  // Org/teacher custom prompt.
  let orgPrompt: string | undefined
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      sites: { select: { aiSystemPrompt: true }, orderBy: PRIMARY_SITE_ORDER, take: 1 },
      organizationMemberships: { include: { organization: { include: { site: { select: { aiSystemPrompt: true } } } } } },
    },
  })
  const orgWithPrompt = user?.organizationMemberships.find(m => m.organization.site?.aiSystemPrompt)?.organization
  const customPrompts: string[] = []
  if (orgWithPrompt?.site?.aiSystemPrompt) customPrompts.push(`## Organization Guidelines\n${orgWithPrompt.site.aiSystemPrompt}`)
  if (user?.sites[0]?.aiSystemPrompt) customPrompts.push(`## Teacher Preferences\n${user.sites[0].aiSystemPrompt}`)
  if (customPrompts.length > 0) orgPrompt = customPrompts.join('\n\n')

  const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://eduskript.org', 'X-Title': 'Eduskript' },
  })

  const systemPrompt = buildSystemPrompt(skriptContext, orgPrompt, pageId)

  let content = ''
  let toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_PLAN_MODEL ?? 'google/gemini-3.5-flash-lite',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      tools: TOOLS,
      tool_choice: 'auto',
      ...(openrouterProviderRouting() as Record<string, unknown>),
    })
    const msg = completion.choices[0]?.message
    content = msg?.content?.trim() ?? ''
    toolCalls = (msg?.tool_calls ?? []).flatMap(tc => {
      if (tc.type !== 'function') return []
      try {
        return [{ name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') }]
      } catch {
        return []
      }
    })
  } catch (err) {
    log.error('agent completion failed:', err)
    return Response.json({ success: false, error: 'AI request failed. Please try again.' }, { status: 502 })
  }

  // Resolve tool calls into plan pages, validating pageIds against the skript.
  const byId = new Map(skript.pages.map(p => [p.id, p]))
  const pages = toolCalls
    .map(tc => {
      if (tc.name === 'edit_page') {
        const p = byId.get(String(tc.args.pageId))
        if (!p) return null
        return { pageId: p.id, pageTitle: p.title, pageSlug: p.slug, summary: String(tc.args.summary ?? ''), isNew: false, note: String(tc.args.note ?? '') }
      }
      if (tc.name === 'create_page') {
        const title = String(tc.args.title ?? '').trim()
        const slug = String(tc.args.slug ?? '').trim()
        if (!title || !slug) return null
        return { pageId: null, pageTitle: title, pageSlug: slug, summary: String(tc.args.summary ?? ''), isNew: true, note: String(tc.args.note ?? '') }
      }
      return null
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  // Pure conversation — no edits.
  if (pages.length === 0) {
    return Response.json({
      success: true,
      content: content || 'Let me know what you would like to change.',
      jobId: null,
      plan: { totalEdits: 0, overallSummary: content, pages: [] },
    })
  }

  const plan = { totalEdits: pages.length, overallSummary: content, pages }

  const job = await prisma.importJob.create({
    data: {
      userId,
      type: 'ai-edit',
      status: 'processing',
      progress: 0,
      message: `Agent proposed ${pages.length} edit(s)`,
      result: {
        skriptId: skriptId ?? null,
        frontPageId: null,
        instruction: latestUser,
        focusedPageId: pageId ?? null,
        currentContent: currentContent || null,
        plan,
        completedEdits: [],
        failedPages: [],
      },
    },
  })

  return Response.json({ success: true, content, jobId: job.id, plan })
}
