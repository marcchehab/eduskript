/**
 * MCP tool: read_skript_frontpage — read the FrontPage attached to a skript.
 *
 * Returns null if the skript has no FrontPage row yet. View permission
 * (skript-author or collection-author) is sufficient to read.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getSkriptFrontPageForUser } from '@/lib/services/skript-frontpages'

export const readSkriptFrontpageConfig = {
  title: 'Read skript frontpage',
  description:
    "Read the FrontPage (intro/landing page) attached to a skript. Returns the markdown content + isPublished, or null if the skript has no frontpage yet. Caller needs view permission on the skript.",
  inputSchema: {
    skriptId: z.string().min(1).describe('The Eduskript skript ID (cuid).'),
  },
}

export async function readSkriptFrontpage(args: { skriptId: string }) {
  const ctx = getMcpContext()
  console.log(
    `[mcp:read_skript_frontpage] userId=${ctx.userId} skriptId=${args.skriptId}`
  )
  const frontPage = await getSkriptFrontPageForUser(ctx.userId, args.skriptId)

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(frontPage, null, 2),
      },
    ],
  }
}
