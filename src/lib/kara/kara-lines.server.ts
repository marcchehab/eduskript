/**
 * Server-side check whether a (speaker, text) pair is a real Kara line, so
 * voice routes only render or store audio for text some level actually speaks
 * (used by /api/kara/tts and /api/dev/voice-save).
 */

import { prisma } from '@/lib/prisma'
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
  for (const { content } of pages) {
    for (const m of content.matchAll(/```kara-world[^\n]*\n([\s\S]*?)```/g)) {
      if (karaMessages(parseKaraLevel(m[1])).some(msg => msg.text === text && msg.speaker?.toUpperCase() === who)) return true
    }
  }
  return false
}
