'use server'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { revalidatePath, revalidateTag } from 'next/cache'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { PRIMARY_SITE_ORDER } from '@/lib/sites'

export interface ImportTargetsCheck {
  existingCollectionTitles: string[]
  existingSkriptSlugs: string[]
}

/**
 * Read-only dedupe check for the client-side importer's preview step.
 * Attachments/videos aren't checked here — those go straight through
 * saveFile()'s / the Mux upload route's own existence checks per-file.
 */
export async function checkImportTargets(collectionTitles: string[], skriptSlugs: string[]): Promise<ImportTargetsCheck> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { existingCollectionTitles: [], existingSkriptSlugs: [] }
  }
  const userId = session.user.id

  const [existingCollections, existingSkripts] = await Promise.all([
    collectionTitles.length > 0
      ? prisma.collection.findMany({
          where: { title: { in: collectionTitles }, site: { userId } },
          select: { title: true }
        })
      : Promise.resolve([]),
    skriptSlugs.length > 0
      ? prisma.skript.findMany({
          where: { slug: { in: skriptSlugs }, authors: { some: { userId } } },
          select: { slug: true }
        })
      : Promise.resolve([])
  ])

  return {
    existingCollectionTitles: existingCollections.map(c => c.title),
    existingSkriptSlugs: existingSkripts.map(s => s.slug)
  }
}

export interface ImportStructurePayload {
  collections: { title: string; skripts: string[] }[]
  skripts: {
    slug: string
    title: string
    description: string | null
    pages: { slug: string; title: string; content: string; order: number }[]
  }[]
}

export interface ImportStructureResult {
  success: boolean
  error?: string
  skriptIds?: Record<string, string>
  collectionsCreated?: number
  skriptsCreated?: number
  pagesCreated?: number
}

/**
 * Client-side importer's write step for collections/skripts/pages — text
 * only, no binary. Attachments and videos are uploaded separately by the
 * browser directly to S3/Mux (see skript-import-client.ts) once this
 * returns the new skript ids to attach them to.
 */
export async function createImportStructure(payload: ImportStructurePayload): Promise<ImportStructureResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { success: false, error: 'Unauthorized' }
  }
  const userId = session.user.id

  const result = { collectionsCreated: 0, skriptsCreated: 0, pagesCreated: 0 }
  const skriptIds: Record<string, string> = {}
  const collectionIdMap = new Map<string, string>()

  const userSite = await prisma.site.findFirst({
    where: { userId },
    orderBy: PRIMARY_SITE_ORDER,
    select: { id: true, slug: true }
  })
  if (!userSite) {
    return { success: false, error: 'You need to set up your public page before importing' }
  }

  for (const collectionData of payload.collections) {
    let collection = await prisma.collection.findFirst({
      where: { title: collectionData.title, siteId: userSite.id }
    })
    if (!collection) {
      collection = await prisma.collection.create({
        data: { title: collectionData.title, siteId: userSite.id }
      })
      result.collectionsCreated++
    }
    collectionIdMap.set(collectionData.title, collection.id)
  }

  for (const skriptData of payload.skripts) {
    let skript = await prisma.skript.findFirst({
      where: { slug: skriptData.slug, authors: { some: { userId } } }
    })

    if (!skript) {
      const owningCollection = payload.collections.find(c => c.skripts.includes(skriptData.slug))
      const collectionId = owningCollection ? collectionIdMap.get(owningCollection.title) : null

      skript = await prisma.skript.create({
        data: {
          title: skriptData.title,
          description: skriptData.description,
          slug: skriptData.slug,
          isPublished: false,
          authors: { create: { userId, permission: 'author' } },
          ...(collectionId && {
            collectionSkripts: { create: { collectionId, order: 0 } }
          })
        }
      })
      result.skriptsCreated++
    }

    skriptIds[skriptData.slug] = skript.id

    for (const p of skriptData.pages) {
      const existingPage = await prisma.page.findFirst({
        where: { slug: p.slug, skriptId: skript.id }
      })
      if (existingPage) continue

      const page = await prisma.page.create({
        data: {
          title: p.title,
          content: p.content,
          slug: p.slug,
          order: p.order,
          isPublished: false,
          skriptId: skript.id,
          authors: { create: { userId, permission: 'author' } }
        }
      })

      await prisma.pageVersion.create({
        data: {
          pageId: page.id,
          content: p.content,
          version: 1,
          authorId: userId,
          changeLog: 'Imported'
        }
      })

      result.pagesCreated++
    }
  }

  if (userSite.slug) {
    revalidateTag(CACHE_TAGS.teacherContent(userSite.slug), { expire: 0 })
    revalidatePath(`/${userSite.slug}`)
    revalidatePath('/dashboard')
  }

  return { success: true, skriptIds, ...result }
}
