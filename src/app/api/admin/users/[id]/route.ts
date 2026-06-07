import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { createTrialSubscription } from '@/lib/trial'

// GET /api/admin/users/[id] - Get single user
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAdmin()
  if (error) return error

  const { id } = await params

  try {
    const userRaw = await prisma.user.findUnique({
      where: { id },
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
        oauthProvider: true,
        isTemporary: true,
        hashedPassword: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!userRaw) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Expose only whether a password is set (an email user can have it changed),
    // never the hash itself.
    const { site, hashedPassword, ...rest } = userRaw
    const user = { ...rest, pageSlug: site?.slug ?? null, hasPassword: !!hashedPassword }

    return NextResponse.json({ user })
  } catch (error) {
    console.error('Error fetching user:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user' },
      { status: 500 }
    )
  }
}

// PATCH /api/admin/users/[id] - Update user
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAdmin()
  if (error) return error

  const { id } = await params

  try {
    const { email, name, pageSlug, title, isAdmin, requirePasswordReset, billingPlan, grantTrial, trialPlanId, trialDays, isTemporary, newPassword } = await request.json()

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id },
    })

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Password change: only for email/password users (no OAuth identity). Hashed
    // here; clears the must-reset flag and verifies the email so login works.
    let hashedPassword: string | undefined
    if (typeof newPassword === 'string' && newPassword.length > 0) {
      if (existingUser.oauthProvider) {
        return NextResponse.json(
          { error: 'Cannot set a password for an OAuth user' },
          { status: 400 }
        )
      }
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters' },
          { status: 400 }
        )
      }
      hashedPassword = await bcrypt.hash(newPassword, 12)
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

      // Check if email is taken by another user
      const emailTaken = await prisma.user.findFirst({
        where: {
          email,
          id: { not: id },
        },
      })

      if (emailTaken) {
        return NextResponse.json(
          { error: 'Email already taken by another user' },
          { status: 409 }
        )
      }
    }

    // Check if pageSlug is taken (URL slugs are unique across all sites).
    if (pageSlug) {
      const taken = await prisma.site.findFirst({
        where: { slug: pageSlug, NOT: { userId: id } },
      })

      if (taken) {
        return NextResponse.json(
          { error: 'Page slug already taken by another user' },
          { status: 409 }
        )
      }
    }

    // Update user (and Site row when pageSlug changes).
    const updatedUserRaw = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          ...(email && { email }),
          ...(name && { name }),
          ...(title !== undefined && { title: title || null }),
          ...(isAdmin !== undefined && { isAdmin }),
          ...(requirePasswordReset !== undefined && { requirePasswordReset }),
          ...(billingPlan !== undefined && { billingPlan }),
          ...(isTemporary !== undefined && { isTemporary }),
          ...(hashedPassword && { hashedPassword, requirePasswordReset: false, emailVerified: existingUser.emailVerified ?? new Date() }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          title: true,
          isAdmin: true,
          billingPlan: true,
          requirePasswordReset: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      let siteSlug: string | null = null
      if (pageSlug) {
        const upserted = await tx.site.upsert({
          where: { userId: id },
          update: { slug: pageSlug },
          create: { slug: pageSlug, userId: id },
        })
        siteSlug = upserted.slug
      } else {
        const existing = await tx.site.findUnique({
          where: { userId: id },
          select: { slug: true },
        })
        siteSlug = existing?.slug ?? null
      }

      return { ...u, pageSlug: siteSlug }
    })
    const updatedUser = updatedUserRaw

    // If billingPlan changed, create/update admin-granted subscription
    if (billingPlan !== undefined && billingPlan !== 'free') {
      const plan = await prisma.plan.findUnique({ where: { slug: billingPlan } })
      if (plan) {
        // Upsert: find existing active subscription or create new one
        const existingSub = await prisma.subscription.findFirst({
          where: { userId: id, status: 'active' },
        })

        if (existingSub) {
          await prisma.subscription.update({
            where: { id: existingSub.id },
            data: { planId: plan.id, status: 'active' },
          })
        } else {
          await prisma.subscription.create({
            data: {
              userId: id,
              planId: plan.id,
              status: 'active',
              // No payrexxSubId — admin-granted
            },
          })
        }
      }
    } else if (billingPlan === 'free') {
      // Cancel any active subscriptions
      await prisma.subscription.updateMany({
        where: { userId: id, status: 'active' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      })
    }

    // Admin grant trial
    if (grantTrial) {
      // Cancel any existing active/trialing subscription first
      await prisma.subscription.updateMany({
        where: { userId: id, status: { in: ['active', 'trialing'] } },
        data: { status: 'cancelled', cancelledAt: new Date() },
      })
      await prisma.user.update({
        where: { id },
        data: { billingPlan: 'free' },
      })
      const trial = await createTrialSubscription(id, trialPlanId || undefined, trialDays || undefined)
      if (!trial) {
        return NextResponse.json(
          { error: 'No trial plan configured. Set a plan with isDefaultTrial=true first.' },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    console.error('Error updating user:', error)
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/users/[id] - Delete user
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAdmin()
  if (error) return error

  const { id } = await params

  try {
    // Prevent deleting yourself
    if (session?.user?.id === id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      )
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Delete user (this will cascade delete related records based on schema)
    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  } catch (error) {
    console.error('Error deleting user:', error)
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    )
  }
}
