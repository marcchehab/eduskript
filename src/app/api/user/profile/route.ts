import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag, revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveOwnedSite } from '@/lib/sites'
import { withDatabaseConnection } from '@/lib/db-connection'
import { CACHE_TAGS } from '@/lib/cached-queries'
import { z } from 'zod'

// Base schema for non-admin users
const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  pageSlug: z.string()
    .transform(val => val === '' ? undefined : val)
    .pipe(z.optional(
      z.string()
        .min(3, 'Page URL must be at least 3 characters')
        .max(50, 'Page URL must be less than 50 characters')
        .regex(/^[a-z0-9-]+$/, 'Page URL can only contain lowercase letters, numbers, and hyphens')
        .refine(val => !val.startsWith('-') && !val.endsWith('-'), 'Page URL cannot start or end with a hyphen')
    )).optional(),
  pageName: z.string().optional(),
  pageDescription: z.string().optional(),
  pageIcon: z.string().url().optional().or(z.literal('')),
  // BCP-47 tag (e.g. "de-CH", "fr", "en"). Empty string clears the column.
  // Loose validation — any non-empty 2–35 char string passes; we'd rather
  // accept the teacher's input than block on a strict tag check.
  pageLanguage: z
    .string()
    .max(35)
    .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'Use a BCP-47 tag like "de-CH" or "en"')
    .optional()
    .or(z.literal('')),
  title: z.string().optional(),
  bio: z.string().optional()
})

// Admin schema allows shorter page slugs (minimum 1 character)
const adminUpdateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  pageSlug: z.string()
    .transform(val => val === '' ? undefined : val)
    .pipe(z.optional(
      z.string()
        .min(1, 'Page URL must be at least 1 character')
        .max(50, 'Page URL must be less than 50 characters')
        .regex(/^[a-z0-9-]+$/, 'Page URL can only contain lowercase letters, numbers, and hyphens')
        .refine(val => !val.startsWith('-') && !val.endsWith('-'), 'Page URL cannot start or end with a hyphen')
    )).optional(),
  pageName: z.string().optional(),
  pageDescription: z.string().optional(),
  pageIcon: z.string().url().optional().or(z.literal('')),
  // BCP-47 tag (e.g. "de-CH", "fr", "en"). Empty string clears the column.
  // Loose validation — any non-empty 2–35 char string passes; we'd rather
  // accept the teacher's input than block on a strict tag check.
  pageLanguage: z
    .string()
    .max(35)
    .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/, 'Use a BCP-47 tag like "de-CH" or "en"')
    .optional()
    .or(z.literal('')),
  title: z.string().optional(),
  bio: z.string().optional()
})

// Read the caller's current profile + page fields fresh from the DB.
// Reason this exists: the dashboard's settings UI was reading values out of
// the NextAuth session/JWT, which goes stale whenever the underlying row is
// edited from another path (MCP, AI Edit, direct API, another dashboard tab).
// Symptom: user updates pageDescription, opens settings, sees the OLD text.
// This GET is the authoritative source the UI hydrates from on mount.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page fields are per-site. `?siteId=` targets one of the caller's sites
  // (site settings UI); omitted falls back to the primary site (profile page).
  const siteId = new URL(request.url).searchParams.get('siteId')
  const { site, forbidden } = await resolveOwnedSite(session.user.id, siteId)
  if (forbidden) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, title: true, bio: true },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const siteRow = site
    ? await prisma.site.findUnique({
        where: { id: site.id },
        select: {
          slug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          pageLanguage: true,
        },
      })
    : null

  // Flatten Site fields onto the response under their legacy names so the
  // dashboard UI doesn't need to be touched. Source of truth is Site.
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    title: user.title,
    bio: user.bio,
    pageSlug: siteRow?.slug ?? null,
    pageName: siteRow?.pageName ?? null,
    pageDescription: siteRow?.pageDescription ?? null,
    pageIcon: siteRow?.pageIcon ?? null,
    pageLanguage: siteRow?.pageLanguage ?? null,
  })
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user's admin status and org admin status (drive schema choice).
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        isAdmin: true,
        organizationMemberships: {
          where: { role: { in: ['owner', 'admin'] } },
          select: { id: true },
          take: 1,
        },
      },
    })

    const body = await request.json()

    // Page fields target the site named by `body.siteId` (site settings UI), or
    // the primary site when omitted (profile page). Ownership-checked.
    const { site: targetSite, forbidden } = await resolveOwnedSite(session.user.id, body.siteId)
    if (forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Use admin schema if user is platform admin or org admin, otherwise use regular schema
    const isOrgAdmin = (currentUser?.organizationMemberships?.length ?? 0) > 0
    const schema = (currentUser?.isAdmin || isOrgAdmin) ? adminUpdateProfileSchema : updateProfileSchema
    const validatedData = schema.parse(body)

    const result = await withDatabaseConnection(async () => {
      // pageSlug lives on Site. Uniqueness is the Site.slug unique constraint,
      // global across every site. Exclude the target site itself so re-saving
      // its own slug isn't a false conflict; any OTHER site (including the
      // caller's other sites) sharing the slug is a real collision.
      if (validatedData.pageSlug) {
        const conflict = await prisma.site.findFirst({
          where: {
            slug: validatedData.pageSlug,
            ...(targetSite ? { NOT: { id: targetSite.id } } : {}),
          },
          select: { id: true },
        })
        if (conflict) {
          throw new Error('This page slug is already taken')
        }
      }

      // Profile fields (name, title, bio) live on User. Page-display fields
      // (pageName, pageDescription, …) and the URL slug live on Site. Split
      // the patch and apply each side independently — only touching the
      // fields the client actually sent so saving profile settings doesn't
      // wipe out page settings and vice versa.
      const userUpdate: Record<string, unknown> = {
        name: validatedData.name,
        needsProfileCompletion: false,
      }
      if ('title' in body) userUpdate.title = validatedData.title || null
      if ('bio' in body) userUpdate.bio = validatedData.bio || null

      const siteUpdate: Record<string, unknown> = {}
      if ('pageName' in body) siteUpdate.pageName = validatedData.pageName || null
      if ('pageDescription' in body) siteUpdate.pageDescription = validatedData.pageDescription || null
      if ('pageIcon' in body) siteUpdate.pageIcon = validatedData.pageIcon || null
      if ('pageLanguage' in body) siteUpdate.pageLanguage = validatedData.pageLanguage || null

      const updatedUser = await prisma.user.update({
        where: { id: session.user.id },
        data: userUpdate,
        select: {
          id: true,
          name: true,
          email: true,
          title: true,
          bio: true,
        }
      })

      // Edits apply to the resolved target site (siteId or primary). userId is
      // not a unique key (a user may own several sites), so we mutate by the
      // site's id rather than upserting by userId.
      const primarySiteId = targetSite?.id ?? null
      let newSlug = targetSite?.slug ?? null
      // Write the Site row if there's a slug change or any site-field change to
      // apply. Creating-on-demand keeps OAuth-signup teachers who haven't
      // claimed a slug yet from getting silently dropped here.
      const hasSiteFields = Object.keys(siteUpdate).length > 0
      const hasNewSlug = 'pageSlug' in body && validatedData.pageSlug
      const siteSelect = {
        slug: true,
        pageName: true,
        pageDescription: true,
        pageIcon: true,
        pageLanguage: true,
      } as const
      let siteRow: { slug: string; pageName: string | null; pageDescription: string | null; pageIcon: string | null; pageLanguage: string | null } | null = null
      if (hasNewSlug || hasSiteFields) {
        // Without an existing slug we can't create a Site (slug is required).
        // Fall back to keeping whatever's there if no slug was provided.
        if (hasNewSlug || newSlug) {
          if (primarySiteId) {
            siteRow = await prisma.site.update({
              where: { id: primarySiteId },
              data: {
                ...(hasNewSlug ? { slug: validatedData.pageSlug } : {}),
                ...siteUpdate,
              },
              select: siteSelect,
            })
          } else {
            siteRow = await prisma.site.create({
              data: {
                slug: (validatedData.pageSlug ?? newSlug)!,
                userId: session.user.id,
                ...siteUpdate,
              },
              select: siteSelect,
            })
          }
          newSlug = siteRow.slug
        }
      }

      // Read back the latest site fields if we didn't just write them.
      if (!siteRow && primarySiteId) {
        siteRow = await prisma.site.findUnique({
          where: { id: primarySiteId },
          select: siteSelect,
        })
      }

      return {
        ...updatedUser,
        pageSlug: newSlug,
        pageName: siteRow?.pageName ?? null,
        pageDescription: siteRow?.pageDescription ?? null,
        pageIcon: siteRow?.pageIcon ?? null,
        pageLanguage: siteRow?.pageLanguage ?? null,
      }
    })

    // Invalidate caches for the target site's public page
    const oldPageSlug = targetSite?.slug ?? null
    const newPageSlug = result.pageSlug

    // Revalidate cache tags for both old and new page slugs
    if (oldPageSlug) {
      revalidateTag(CACHE_TAGS.user(oldPageSlug), { expire: 0 })
      revalidateTag(CACHE_TAGS.teacherContent(oldPageSlug), { expire: 0 })
      revalidatePath(`/${oldPageSlug}`)
    }
    if (newPageSlug && newPageSlug !== oldPageSlug) {
      revalidateTag(CACHE_TAGS.user(newPageSlug), { expire: 0 })
      revalidateTag(CACHE_TAGS.teacherContent(newPageSlug), { expire: 0 })
      revalidatePath(`/${newPageSlug}`)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating profile:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid data', details: error.issues },
        { status: 400 }
      )
    }

    if (error instanceof Error && error.message === 'This page slug is already taken') {
      return NextResponse.json(
        { error: 'This page slug is already taken' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
