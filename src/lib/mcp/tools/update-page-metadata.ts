/**
 * MCP tool: update_page_metadata — change title, slug, description, or publish
 * state of a page WITHOUT touching the markdown body.
 *
 * Exists because partial-update tools that accept `content` as one of many
 * optional fields are foot-guny: a single `content: ""` wipes the page. By
 * design this tool has no `content` parameter, so misuse cannot destroy
 * teaching material. Use `update_page_content` for body edits.
 */

import { z } from 'zod'
import { getMcpContext, requireScope } from '@/lib/mcp/context'
import { updatePageForUser } from '@/lib/services/pages'

export const updatePageMetadataConfig = {
  title: 'Update page metadata',
  description:
    "Update the metadata of an Eduskript page — title, slug, description (og:description), and publication flags. Cannot touch the markdown body by design (use `update_page_content` for that). Safe to call repeatedly: a metadata-only call never creates a new PageVersion. Caller must have edit permission. The page description is a plain-text summary used as og:description on the public page (overrides the auto-derived excerpt — set this when the auto-excerpt picks up the wrong opening paragraph).",
  inputSchema: {
    pageId: z.string().min(1).describe('Page ID to update.'),
    title: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Plain-text page description. Overrides the auto-derived og:description excerpt. Pass null or empty string to clear and fall back to the auto-derived excerpt.',
      ),
    isPublished: z.boolean().optional(),
    isUnlisted: z.boolean().optional(),
  },
}

export async function updatePageMetadata(args: {
  pageId: string
  title?: string
  slug?: string
  description?: string | null
  isPublished?: boolean
  isUnlisted?: boolean
}) {
  requireScope('content:write')
  const ctx = getMcpContext()

  const { pageId, ...patch } = args
  // Note: `content` is intentionally NOT in the destructured patch — even if
  // a malformed call sneaks through Zod, prisma.page.update would simply
  // ignore unknown columns. This is the structural safety property.
  const updated = await updatePageForUser(ctx.userId, pageId, patch, {
    editSource: 'mcp',
    editClient: ctx.clientName,
  })

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: updated.id,
            title: updated.title,
            slug: updated.slug,
            description: updated.description,
            isPublished: updated.isPublished,
            isUnlisted: updated.isUnlisted,
            updatedAt: updated.updatedAt,
          },
          null,
          2,
        ),
      },
    ],
  }
}
