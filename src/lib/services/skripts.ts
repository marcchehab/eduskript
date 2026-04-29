/**
 * Skripts service — author-scoped reads.
 *
 * Mirrors the GET /api/skripts handler so REST and MCP go through the same path.
 * The "includeShared" flag is preserved for the REST handler; MCP defaults to
 * the broader OR query so teachers see both directly-authored skripts and ones
 * inherited via collection authorship.
 */

import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { NotFoundError, PermissionDeniedError } from '@/lib/services/pages'

interface ListOptions {
  includeShared?: boolean
}

const skriptInclude = {
  pages: {
    select: { id: true, title: true, slug: true, isPublished: true, order: true },
    orderBy: { order: 'asc' as const },
  },
  authors: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  collectionSkripts: {
    include: {
      collection: {
        include: {
          authors: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  },
} as const

export async function listSkriptsForUser(
  userId: string,
  options: ListOptions = {}
) {
  const { includeShared = true } = options

  const whereClause = includeShared
    ? {
        OR: [
          { authors: { some: { userId } } },
          {
            collectionSkripts: {
              some: {
                collection: { authors: { some: { userId } } },
              },
            },
          },
        ],
      }
    : { authors: { some: { userId } } }

  return prisma.skript.findMany({
    where: whereClause,
    include: skriptInclude,
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Fetch a single skript with permission check. Used by `create_page` MCP tool
 * and any other path that needs author-or-better authorization.
 */
export async function getSkriptForUser(
  userId: string,
  skriptId: string,
  ctx: { isAdmin?: boolean } = {}
) {
  const skript = await prisma.skript.findUnique({
    where: { id: skriptId },
    include: skriptInclude,
  })

  if (!skript) throw new NotFoundError('Skript not found')

  const collectionAuthors = skript.collectionSkripts.flatMap(
    (cs) => cs.collection?.authors ?? []
  )
  const perms = checkSkriptPermissions(
    userId,
    skript.authors,
    collectionAuthors,
    ctx.isAdmin
  )
  if (!perms.canView) {
    throw new PermissionDeniedError('Cannot view this skript')
  }

  return { skript, perms }
}
