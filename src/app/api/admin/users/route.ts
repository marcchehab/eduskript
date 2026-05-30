import { NextResponse } from 'next/server'
import { revalidateTag, revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { CACHE_TAGS } from '@/lib/cached-queries'
import bcrypt from 'bcryptjs'

// GET /api/admin/users - List all users
export async function GET() {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    const usersRaw = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        site: { select: { slug: true } },
        title: true,
        isAdmin: true,
        requirePasswordReset: true,
        emailVerified: true,
        accountType: true,
        billingPlan: true,
        studentPseudonym: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        accounts: {
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
          },
        },
        subscriptions: {
          where: { status: { in: ['active', 'trialing'] } },
          select: {
            status: true,
            currentPeriodEnd: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { pageAuthors: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Expose URL slug under the legacy `pageSlug` field for the admin UI.
    const users = usersRaw.map(({ site, ...u }) => ({ ...u, pageSlug: site?.slug ?? null }))

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

// POST /api/admin/users - Create new user
export async function POST(request: Request) {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    const { email, name, pageSlug, title, password, isAdmin, requirePasswordReset, accountType, studentPseudonym, organizationId } = await request.json()

    const isStudent = accountType === 'student'

    // Validate required fields based on account type
    if (!name || !password) {
      return NextResponse.json(
        { error: 'Name and password are required' },
        { status: 400 }
      )
    }

    // Teachers require email and pageSlug
    if (!isStudent && (!email || !pageSlug)) {
      return NextResponse.json(
        { error: 'Email and page slug are required for teachers' },
        { status: 400 }
      )
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { error: 'Invalid email format' },
          { status: 400 }
        )
      }
    }

    // Validate password length
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    // Check if email already exists (only if email provided)
    if (email) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      })

      if (existingUser) {
        return NextResponse.json(
          { error: 'User with this email already exists' },
          { status: 409 }
        )
      }
    }

    // Check if pageSlug already exists (only for teachers); URL slug lives
    // on Site and is unique globally across user + org sites.
    if (!isStudent && pageSlug) {
      const existingSlug = await prisma.site.findUnique({
        where: { slug: pageSlug },
      })

      if (existingSlug) {
        return NextResponse.json(
          { error: 'User with this page slug already exists' },
          { status: 409 }
        )
      }
    }

    // Generate studentPseudonym for students if not provided
    let finalStudentPseudonym = studentPseudonym || null
    if (isStudent && !finalStudentPseudonym) {
      // Generate from email or name + timestamp
      const source = email || `${name}-${Date.now()}`
      // Simple hash for pseudonym (not cryptographic, just for uniqueness)
      const encoder = new TextEncoder()
      const data = encoder.encode(source)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      finalStudentPseudonym = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    // Check if studentPseudonym already exists
    if (finalStudentPseudonym) {
      const existingPseudonym = await prisma.user.findUnique({
        where: { studentPseudonym: finalStudentPseudonym },
      })

      if (existingPseudonym) {
        return NextResponse.json(
          { error: 'Student pseudonym already exists' },
          { status: 409 }
        )
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user (normalize email for case-insensitive matching). For
    // teachers, also create the Site row with the URL slug atomically.
    const normalizedEmail = email ? email.toLowerCase().trim() : null
    const createdRaw = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: normalizedEmail,
          name,
          title: isStudent ? null : (title || null),
          hashedPassword,
          emailVerified: new Date(),
          isAdmin: isStudent ? false : (isAdmin || false),
          requirePasswordReset: requirePasswordReset !== undefined ? requirePasswordReset : true,
          accountType: isStudent ? 'student' : 'teacher',
          studentPseudonym: finalStudentPseudonym,
        },
        select: {
          id: true,
          email: true,
          name: true,
          title: true,
          isAdmin: true,
          requirePasswordReset: true,
          emailVerified: true,
          accountType: true,
          studentPseudonym: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      let siteSlug: string | null = null
      if (!isStudent && pageSlug) {
        // Mirror the display name on Site.pageName so the public page
        // renders the teacher's name on first load (no separate edit step).
        const site = await tx.site.create({
          data: { slug: pageSlug, userId: u.id, pageName: name },
        })
        siteSlug = site.slug
      }
      if (organizationId && typeof organizationId === 'string') {
        // Verify org exists before inserting to surface a clean 400.
        const org = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { id: true },
        })
        if (!org) {
          throw new Error('INVALID_ORG_ID')
        }
        await tx.organizationMember.create({
          data: { organizationId, userId: u.id, role: 'member' },
        })
      }
      return { ...u, pageSlug: siteSlug }
    })

    // Bust any cached `null` for this pageSlug. If anything hit /<pageSlug>
    // before this admin-created teacher existed, getTeacherByPageSlug /
    // getTeacherWithLayout cached null indefinitely (revalidate: false);
    // matches the pattern in /api/auth/register.
    if (!isStudent && createdRaw.pageSlug) {
      revalidateTag(CACHE_TAGS.user(createdRaw.pageSlug), { expire: 0 })
      revalidateTag(CACHE_TAGS.teacherContent(createdRaw.pageSlug), { expire: 0 })
      revalidatePath(`/${createdRaw.pageSlug}`)
    }

    return NextResponse.json({ user: createdRaw }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_ORG_ID') {
      return NextResponse.json(
        { error: 'Selected organization does not exist' },
        { status: 400 }
      )
    }
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}
