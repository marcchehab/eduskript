/**
 * MCP tool: get_eduskript_context
 *
 * The MCP `initialize` instructions field is dropped by claude.ai's consumer
 * host (presumably to avoid arbitrary servers prompt-injecting the model).
 * Tool descriptions DO reach the model, so we expose the same payload here as
 * a tool the assistant calls once per session.
 *
 * Returns:
 *   - Platform overview (Eduskript hierarchy, role, language conventions)
 *   - Full markdown syntax reference (callouts, code editors, math, plugins, …)
 *   - The teacher's personal aiSystemPrompt (Site.aiSystemPrompt) — same field
 *     the in-product AI Edit and the dashboard chat assistant use.
 *
 * Other tool descriptions (`create_page`, `update_page`) nudge the assistant
 * to call this first when authoring content.
 */

import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { BASE_PROMPT } from '@/lib/ai/prompts'
import { getCondensedSyntaxReference } from '@/lib/ai/syntax-reference'
import { getMcpContext } from '@/lib/mcp/context'

export const getEduskriptContextConfig = {
  title: 'Get Eduskript context',
  description:
    'Returns the Eduskript platform overview, the full markdown syntax reference (callouts, interactive code editors, math, plugins, etc.), and the teacher\'s personal AI preferences. Call this ONCE at the start of any session that involves creating or editing Eduskript content — it teaches you the platform\'s markdown extensions and the teacher\'s authoring style. Cheap and idempotent; safe to call again if you forget.',
  inputSchema: {},
}

export async function getEduskriptContext() {
  const ctx = getMcpContext()
  // aiSystemPrompt lives on the teacher's Site.
  const site = await prisma.site.findFirst({
    where: { userId: ctx.userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { aiSystemPrompt: true },
  })

  const sections: string[] = [
    '## Platform overview',
    BASE_PROMPT,
    '',
    '## Markdown syntax reference',
    getCondensedSyntaxReference(),
  ]

  const teacherPrompt = site?.aiSystemPrompt?.trim()
  if (teacherPrompt) {
    sections.push(
      '',
      "## Teacher's personal preferences",
      teacherPrompt,
    )
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: sections.join('\n'),
      },
    ],
  }
}
