/**
 * Plugins service — author-scoped reads + writes.
 *
 * Single source of truth for validation and the actual create/update, so
 * REST handlers (src/app/api/plugins/) and the MCP create_plugin tool go
 * through the same path. Every save that changes entryHtml writes a
 * PluginVersion snapshot (restorable, like page versions); saves stay live
 * immediately. No cache tags to invalidate (the embed route reads live), so
 * unlike pages/skripts there's no revalidation fan-out here.
 */

import { prisma } from '@/lib/prisma'
import { siteHasOrHadSlug } from '@/lib/site-slugs'
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
  args: { slug: string; name: string; description?: string; manifest?: object; entryHtml: string; changeLog?: string }
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
      versions: { create: { version: 1, entryHtml: args.entryHtml, changeLog: args.changeLog || 'Created' } },
    },
    include: { author: authorInclude },
  })

  return { ...plugin, author: flattenAuthor(plugin.author) }
}

export async function updatePluginForUser(
  userId: string,
  pluginId: string,
  args: { name?: string; description?: string; manifest?: object; entryHtml?: string; version?: string; changeLog?: string },
  /** Scope the returned author.pageSlug/pageName to this specific site instead of the author's primary — preserves the ownerSlug the caller updated through (multi-site authors). */
  ownerSlug?: string
) {
  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } })
  if (!plugin) throw new NotFoundError('Plugin not found')
  if (plugin.authorId !== userId) throw new PermissionDeniedError('Only the author can update this plugin')

  // Snapshot only when the HTML actually changes (metadata-only saves don't
  // add versions). O(1) extra queries: one aggregate + one insert.
  if (args.entryHtml !== undefined && args.entryHtml !== plugin.entryHtml) {
    await addPluginVersion(pluginId, args.entryHtml, args.changeLog)
  }

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
        ? { select: { id: true, name: true, image: true, sites: { where: siteHasOrHadSlug(ownerSlug), take: 1, select: { slug: true, pageName: true } } } }
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

/**
 * Append a version snapshot. Plugins created before PluginVersion existed have
 * no version 1, so the first snapshot after the migration just gets max+1 = 1.
 * Not race-proof: two concurrent saves can collide on (pluginId, version) and
 * the second one throws; the author is the only writer, so this is rare.
 */
async function addPluginVersion(pluginId: string, entryHtml: string, changeLog?: string) {
  const last = await prisma.pluginVersion.aggregate({ where: { pluginId }, _max: { version: true } })
  await prisma.pluginVersion.create({
    data: { pluginId, version: (last._max.version ?? 0) + 1, entryHtml, changeLog: changeLog || null },
  })
}

async function ownPlugin(userId: string, pluginId: string) {
  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } })
  if (!plugin) throw new NotFoundError('Plugin not found')
  if (plugin.authorId !== userId) throw new PermissionDeniedError('Only the author can see versions of this plugin')
  return plugin
}

/** Newest first, without the HTML of each version except on request. */
export async function listPluginVersions(userId: string, pluginId: string) {
  await ownPlugin(userId, pluginId)
  return prisma.pluginVersion.findMany({
    where: { pluginId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, changeLog: true, createdAt: true, entryHtml: true },
  })
}

/** Restore = save that version's HTML again (as a new version), so nothing is lost. */
export async function restorePluginVersion(userId: string, pluginId: string, versionId: string) {
  await ownPlugin(userId, pluginId)
  const v = await prisma.pluginVersion.findUnique({ where: { id: versionId } })
  if (!v || v.pluginId !== pluginId) throw new NotFoundError('Version not found')
  return updatePluginForUser(userId, pluginId, { entryHtml: v.entryHtml, changeLog: `Restored version ${v.version}` })
}

/**
 * Pages that embed one of the author's plugins. A plugin tag is
 * `<plugin src="<site slug>/<plugin slug>" …>` and any current or old slug of
 * any of the author's sites resolves to the same plugin, so all of them are
 * searched. Substring search over page content (ILIKE, no index): O(pages)
 * per slug, acceptable for an on-demand dashboard call, not for hot paths.
 */
export async function findPluginUsage(userId: string, pluginSlugs: string[]) {
  const sites = await prisma.site.findMany({
    where: { userId },
    select: { slug: true, slugAliases: { select: { slug: true } } },
  })
  const ownerSlugs = sites.flatMap((s) => [s.slug, ...s.slugAliases.map((a) => a.slug)])
  const usage: Record<string, { pageId: string; title: string; pageSlug: string; skriptSlug: string; skriptTitle: string; canEdit: boolean }[]> = {}
  if (ownerSlugs.length === 0 || pluginSlugs.length === 0) return usage

  const needles = pluginSlugs.flatMap((plugin) => ownerSlugs.map((owner) => ({ plugin, src: `${owner}/${plugin}` })))
  const pages = await prisma.page.findMany({
    where: { OR: needles.map((n) => ({ content: { contains: `src="${n.src}"` } })) },
    select: {
      id: true, title: true, slug: true, content: true,
      skript: { select: { slug: true, title: true, authors: { where: { userId }, select: { permission: true } } } },
    },
  })
  for (const page of pages) {
    for (const plugin of pluginSlugs) {
      if (!needles.some((n) => n.plugin === plugin && page.content.includes(`src="${n.src}"`))) continue
      ;(usage[plugin] ??= []).push({
        pageId: page.id,
        title: page.title,
        pageSlug: page.slug,
        skriptSlug: page.skript.slug,
        skriptTitle: page.skript.title,
        canEdit: page.skript.authors.some((a) => a.permission === 'author'),
      })
    }
  }
  return usage
}
