import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidateTag, revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      pageName: true,
      pageDescription: true,
      pageIcon: true,
      pageLanguage: true,
      title: true,
      bio: true,
      site: { select: { slug: true } },
    },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Expose pageSlug under its legacy field name so the dashboard UI doesn't
  // need to be touched. The source of truth is Site.slug.
  return NextResponse.json({ ...user, pageSlug: user.site?.slug ?? null, site: undefined })
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user's admin status, org admin status, and current page slug
    // (slug lives on Site now).
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        isAdmin: true,
        site: { select: { id: true, slug: true } },
        organizationMemberships: {
          where: { role: { in: ['owner', 'admin'] } },
          select: { id: true },
          take: 1,
        },
      },
    })

    const body = await request.json()

    // Use admin schema if user is platform admin or org admin, otherwise use regular schema
    const isOrgAdmin = (currentUser?.organizationMemberships?.length ?? 0) > 0
    const schema = (currentUser?.isAdmin || isOrgAdmin) ? adminUpdateProfileSchema : updateProfileSchema
    const validatedData = schema.parse(body)

    const result = await withDatabaseConnection(async () => {
      // pageSlug now lives on Site, not User. Uniqueness is checked against
      // Site.slug across user + org sites. Username collisions still live on
      // User and need a separate check.
      if (validatedData.pageSlug) {
        const conflict = await prisma.$transaction([
          prisma.site.findFirst({
            where: { slug: validatedData.pageSlug, NOT: { userId: session.user.id } },
            select: { id: true },
          }),
          prisma.user.findFirst({
            where: { username: validatedData.pageSlug, NOT: { id: session.user.id } },
            select: { id: true },
          }),
        ])
        if (conflict[0] || conflict[1]) {
          throw new Error('This page slug is already taken')
        }
      }

      // Build update data with only the fields that were provided,
      // so saving profile settings doesn't wipe out page settings and vice versa
      const updateData: Record<string, unknown> = {
        name: validatedData.name,
        needsProfileCompletion: false,
      }
      if ('pageName' in body) updateData.pageName = validatedData.pageName || null
      if ('pageDescription' in body) updateData.pageDescription = validatedData.pageDescription || null
      if ('pageIcon' in body) updateData.pageIcon = validatedData.pageIcon || null
      if ('pageLanguage' in body) updateData.pageLanguage = validatedData.pageLanguage || null
      if ('title' in body) updateData.title = validatedData.title || null
      if ('bio' in body) updateData.bio = validatedData.bio || null

      // Update the user profile and clear needsProfileCompletion flag, plus
      // upsert the Site row when pageSlug changes (URL slug lives there).
      const updatedUser = await prisma.user.update({
        where: { id: session.user.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          pageLanguage: true,
          title: true,
          bio: true,
        }
      })

      let newSlug = currentUser?.site?.slug ?? null
      if ('pageSlug' in body && validatedData.pageSlug) {
        const upserted = await prisma.site.upsert({
          where: { userId: session.user.id },
          update: { slug: validatedData.pageSlug },
          create: { slug: validatedData.pageSlug, userId: session.user.id },
        })
        newSlug = upserted.slug
      }

      return { ...updatedUser, pageSlug: newSlug }
    })

    // Invalidate caches for the user's public page
    const oldPageSlug = currentUser?.site?.slug ?? null
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
        { error: 'Invalid data', details: error.errors },
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
