/**
 * Plugins service — author-scoped reads + writes.
 *
 * Single source of truth for validation and the actual create/update, so
 * REST handlers (src/app/api/plugins/) and the MCP create_plugin tool go
 * through the same path. Plugins have no version/audit table and no cache
 * tags to invalidate (the embed route reads live), so unlike pages/skripts
 * there's no revalidation fan-out here.
 */

import { prisma } from '@/lib/prisma'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'
import { ConflictError, NotFoundError, PermissionDeniedError, ValidationError } from '@/lib/services/pages'

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

const authorInclude = {
  select: { id: true, name: true, image: true, sites: { orderBy: PRIMARY_SITE_ORDER, take: 1, select: { slug: true, pageName: true } } },
} as const

function flattenAuthor(author: { id: string; name: string | null; image: string | null; sites: { slug: string; pageName: string | null }[] }) {
  return {
    id: author.id,
    name: author.name,
    image: author.image,
    pageSlug: author.sites[0]?.slug ?? null,
    pageName: author.sites[0]?.pageName ?? null,
  }
}

export function validatePluginInput(slug: string, name: string, entryHtml: string) {
  if (!slug || !name || !entryHtml) {
    throw new ValidationError('slug, name, and entryHtml are required')
  }
  if (slug.length < 2 || slug.length > 64 || !SLUG_REGEX.test(slug)) {
    throw new ValidationError('Slug must be 2-64 characters, lowercase alphanumeric with hyphens')
  }
}

export async function createPluginForUser(
  userId: string,
  args: { slug: string; name: string; description?: string; manifest?: object; entryHtml: string }
) {
  validatePluginInput(args.slug, args.name, args.entryHtml)

  const existing = await prisma.plugin.findUnique({
    where: { authorId_slug: { authorId: userId, slug: args.slug } },
  })
  if (existing) {
    throw new ConflictError(`You already have a plugin with slug "${args.slug}"`)
  }

  const plugin = await prisma.plugin.create({
    data: {
      slug: args.slug,
      name: args.name,
      description: args.description || null,
      manifest: args.manifest || {},
      entryHtml: args.entryHtml,
      authorId: userId,
    },
    include: { author: authorInclude },
  })

  return { ...plugin, author: flattenAuthor(plugin.author) }
}

export async function updatePluginForUser(
  userId: string,
  pluginId: string,
  args: { name?: string; description?: string; manifest?: object; entryHtml?: string; version?: string },
  /** Scope the returned author.pageSlug/pageName to this specific site instead of the author's primary — preserves the ownerSlug the caller updated through (multi-site authors). */
  ownerSlug?: string
) {
  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } })
  if (!plugin) throw new NotFoundError('Plugin not found')
  if (plugin.authorId !== userId) throw new PermissionDeniedError('Only the author can update this plugin')

  const updated = await prisma.plugin.update({
    where: { id: pluginId },
    data: {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.description !== undefined && { description: args.description }),
      ...(args.manifest !== undefined && { manifest: args.manifest }),
      ...(args.entryHtml !== undefined && { entryHtml: args.entryHtml }),
      ...(args.version !== undefined && { version: args.version }),
    },
    include: {
      author: ownerSlug
        ? { select: { id: true, name: true, image: true, sites: { where: { slug: ownerSlug }, take: 1, select: { slug: true, pageName: true } } } }
        : authorInclude,
    },
  })

  return { ...updated, author: flattenAuthor(updated.author) }
}

/**
 * Create-or-update by slug, scoped to the caller as author. Used by the MCP
 * create_plugin tool, which has no notion of "the plugin's id" up front —
 * only the slug it wants to write to. Requires overwrite=true to replace an
 * existing plugin, mirroring upload_asset's overwrite guard.
 */
export async function upsertPluginForUser(
  userId: string,
  args: { slug: string; name: string; description?: string; manifest?: object; entryHtml: string; overwrite?: boolean }
) {
  validatePluginInput(args.slug, args.name, args.entryHtml)

  const existing = await prisma.plugin.findUnique({
    where: { authorId_slug: { authorId: userId, slug: args.slug } },
  })

  if (!existing) {
    return { plugin: await createPluginForUser(userId, args), created: true }
  }

  if (!args.overwrite) {
    throw new ConflictError(`You already have a plugin with slug "${args.slug}". Pass overwrite=true to replace it.`)
  }

  const updated = await updatePluginForUser(userId, existing.id, {
    name: args.name,
    description: args.description,
    manifest: args.manifest,
    entryHtml: args.entryHtml,
  })
  return { plugin: updated, created: false }
}
