/**
 * Server-side check whether a (speaker, text) pair is a real Kara line, so
 * voice routes only render or store audio for text some level actually speaks
 * (used by /api/kara/tts, /api/dev/voice-save and /api/kara/voice-pick).
 * Also the edit-permission check for the author voice routes.
 */

import { prisma } from '@/lib/prisma'
import { checkPagePermissions } from '@/lib/permissions'
import { isAuroraDefault } from './aurora-defaults'
import { karaMessages, parseKaraLevel } from './world'

/** True when (speaker, text) is a line some Kara level or default actually speaks. */
export async function isKaraLine(speaker: string, text: string): Promise<boolean> {
  const who = speaker.toUpperCase()
  if (who === 'AURORA' && isAuroraDefault(text)) return true
  const pages = await prisma.page.findMany({
    where: { AND: [{ content: { contains: text } }, { content: { contains: '```kara-world' } }] },
    select: { content: true },
    take: 20,
  })
  return pages.some(({ content }) => isLineOfContent(content, who, text))
}

/** True when some kara-world block of this page markdown speaks (speaker, text). */
export function isLineOfContent(content: string, speaker: string, text: string): boolean {
  const who = speaker.toUpperCase()
  for (const m of content.matchAll(/```kara-world[^\n]*\n([\s\S]*?)```/g)) {
    if (karaMessages(parseKaraLevel(m[1])).some(msg => msg.text === text && msg.speaker?.toUpperCase() === who)) return true
  }
  return false
}

/**
 * The page's content when the user may edit it (page or skript author with
 * permission "author", or admin; same rule as /api/pages/[id]/can-edit), else null.
 */
export async function editablePageContent(pageId: string, userId: string, isAdmin?: boolean): Promise<string | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { content: true, authors: { include: { user: true } }, skript: { select: { authors: { include: { user: true } } } } },
  })
  if (!page) return null
  return checkPagePermissions(userId, page.authors, page.skript.authors, isAdmin).canEdit ? page.content : null
}
