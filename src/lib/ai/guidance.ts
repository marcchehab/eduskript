/**
 * Load the organization + teacher custom AI guidance (Site.aiSystemPrompt) for a
 * user, as a single block to append to any AI system prompt. This is where a
 * teacher's preferences live — e.g. "use Swiss German, never the ß character",
 * tone, terminology. Same source the AI-edit / AI-chat routes use; extracted so
 * AI scoring + rubric generation honour it too.
 */

import { prisma } from '@/lib/prisma'

export async function loadAiGuidance(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      site: { select: { aiSystemPrompt: true } },
      organizationMemberships: {
        include: { organization: { include: { site: { select: { aiSystemPrompt: true } } } } },
      },
    },
  })
  const org = user?.organizationMemberships.find((m) => m.organization.site?.aiSystemPrompt)?.organization
  const parts: string[] = []
  if (org?.site?.aiSystemPrompt) parts.push(`## Organization Guidelines\n${org.site.aiSystemPrompt}`)
  if (user?.site?.aiSystemPrompt) parts.push(`## Teacher Preferences\n${user.site.aiSystemPrompt}`)
  return parts.length ? parts.join('\n\n') : undefined
}
