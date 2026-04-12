import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// GET /api/admin/users - List all users
export async function GET() {
  const { error, session } = await requireAdmin()
  if (error) return error

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        pageSlug: true,
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
    const { email, name, pageSlug, title, password, isAdmin, requirePasswordReset, accountType, studentPseudonym } = await request.json()

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

    // Check if pageSlug already exists (only for teachers)
    if (!isStudent && pageSlug) {
      const existingPageSlug = await prisma.user.findUnique({
        where: { pageSlug },
      })

      if (existingPageSlug) {
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

    // Create user (normalize email for case-insensitive matching)
    const normalizedEmail = email ? email.toLowerCase().trim() : null
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        pageSlug: isStudent ? null : pageSlug,
        pageName: isStudent ? null : name, // Use name as default page name for teachers
        title: isStudent ? null : (title || null),
        hashedPassword,
        emailVerified: new Date(), // Auto-verify admin-created users
        isAdmin: isStudent ? false : (isAdmin || false), // Students can't be admins
        requirePasswordReset: requirePasswordReset !== undefined ? requirePasswordReset : true,
        accountType: isStudent ? 'student' : 'teacher',
        studentPseudonym: finalStudentPseudonym,
      },
      select: {
        id: true,
        email: true,
        name: true,
        pageSlug: true,
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

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}
