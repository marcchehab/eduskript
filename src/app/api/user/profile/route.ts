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
  title: z.string().optional(),
  bio: z.string().optional()
})

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch user's admin status, org admin status, and current page slug
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        isAdmin: true,
        pageSlug: true,
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
      // Check if page slug is already taken by another user (check both pageSlug and username)
      if (validatedData.pageSlug) {
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { pageSlug: validatedData.pageSlug },
              { username: validatedData.pageSlug }
            ],
            NOT: { id: session.user.id }
          }
        })

        if (existingUser) {
          throw new Error('This page slug is already taken')
        }
      }

      // Build update data with only the fields that were provided,
      // so saving profile settings doesn't wipe out page settings and vice versa
      const updateData: Record<string, unknown> = {
        name: validatedData.name,
        needsProfileCompletion: false,
      }
      if ('pageSlug' in body) updateData.pageSlug = validatedData.pageSlug
      if ('pageName' in body) updateData.pageName = validatedData.pageName || null
      if ('pageDescription' in body) updateData.pageDescription = validatedData.pageDescription || null
      if ('pageIcon' in body) updateData.pageIcon = validatedData.pageIcon || null
      if ('title' in body) updateData.title = validatedData.title || null
      if ('bio' in body) updateData.bio = validatedData.bio || null

      // Update the user profile and clear needsProfileCompletion flag
      return await prisma.user.update({
        where: { id: session.user.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          pageSlug: true,
          pageName: true,
          pageDescription: true,
          pageIcon: true,
          title: true,
          bio: true
        }
      })
    })

    // Invalidate caches for the user's public page
    const oldPageSlug = currentUser?.pageSlug
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
