/**
 * MCP tool: read_page — fetch a page's full content if the actor can view it.
 */

import { z } from 'zod'
import { getMcpContext } from '@/lib/mcp/context'
import { getPageForUser } from '@/lib/services/pages'
import { getSkriptFiles } from '@/lib/skript-files.server'
import { extractReferencedFilenames } from '@/lib/extract-file-references'

export const readPageConfig = {
  title: 'Read page',
  description:
    'Read the full markdown content of a single Eduskript page by ID. ' +
    'The response also includes a `files` array with direct download URLs for ' +
    'every image, SQLite database, Excalidraw schema, and other asset referenced ' +
    "in the page — useful for downloading databases (.db / .sqlite) and querying " +
    'them locally. The caller must have view permission on the page ' +
    '(directly or via skript / collection authorship).',
  inputSchema: {
    pageId: z
      .string()
      .min(1)
      .describe('The Eduskript page ID (cuid). Get IDs from list_my_skripts or search_my_content.'),
  },
}

type FileKind = 'database' | 'image' | 'video' | 'file'

function getFileKind(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'db' || ext === 'sqlite') return 'database'
  if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'mp4' || ext === 'mov') return 'video'
  return 'file'
}

export async function readPage(args: { pageId: string }) {
  const ctx = getMcpContext()
  console.log(`[mcp:read_page] userId=${ctx.userId} pageId=${args.pageId}`)
  const page = await getPageForUser(ctx.userId, args.pageId)

  const skriptFiles = await getSkriptFiles(page.skript.id)
  const referenced = extractReferencedFilenames(page.content)
  const files = referenced
    .map((name) => skriptFiles.files[name])
    .filter((f): f is NonNullable<typeof f> => f != null)
    .map((f) => ({ name: f.name, url: f.url, kind: getFileKind(f.name) }))

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: page.id,
            title: page.title,
            slug: page.slug,
            description: page.description,
            isPublished: page.isPublished,
            content: page.content,
            updatedAt: page.updatedAt,
            skript: {
              id: page.skript.id,
              title: page.skript.title,
              slug: page.skript.slug,
            },
            files,
          },
          null,
          2
        ),
      },
    ],
  }
}
