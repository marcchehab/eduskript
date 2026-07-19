/**
 * MCP tool: create_collection — create a sidebar collection on the actor's site.
 *
 * Requires content:write. Unlike POST /api/collections, this also adds the new
 * collection to the site's PageLayout so it appears in the sidebar immediately.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { createCollectionForUser } from '@/lib/services/collections'

export const createCollectionConfig = {
  title: 'Create collection',
  description:
    "Create a new collection (a sidebar section that bundles skripts) on the teacher's site and add it to the sidebar layout. The caller must own the target site. Use `list_my_sites` to find a siteId; omit it to use the primary site.",
  inputSchema: {
    title: z.string().min(1).describe('Human-readable collection title.'),
    siteId: z
      .string()
      .optional()
      .describe('Target site ID (must be owned by the caller). Omit for the primary site.'),
    accentColor: z
      .string()
      .optional()
      .describe('Optional accent color (CSS color / hex) for the collection.'),
  },
}

export async function createCollection(args: {
  title: string
  siteId?: string
  accentColor?: string
}) {
  requireScope('content:write')
  const ctx = getMcpContext()
  console.log(`[mcp:create_collection] userId=${ctx.userId} client=${ctx.clientName}`)
  const collection = await createCollectionForUser(ctx.userId, args, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { id: collection.id, title: collection.title, siteId: collection.siteId },
          null,
          2
        ),
      },
    ],
  }
}
