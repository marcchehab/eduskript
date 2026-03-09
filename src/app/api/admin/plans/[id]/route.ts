import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'

// PATCH /api/admin/plans/[id] - Update a plan
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params

  try {
    const body = await request.json()
    const { name, slug, priceChf, interval, features, isActive } = body

    const existing = await prisma.plan.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    // Check slug uniqueness if changing
    if (slug && slug !== existing.slug) {
      const slugTaken = await prisma.plan.findUnique({ where: { slug } })
      if (slugTaken) {
        return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
      }
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
        ...(priceChf !== undefined && { priceChf: Number(priceChf) }),
        ...(interval !== undefined && { interval }),
        ...(features !== undefined && { features }),
        ...(isActive !== undefined && { isActive }),
      },
    })

    return NextResponse.json({ plan })
  } catch (err) {
    console.error('Error updating plan:', err)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}

// DELETE /api/admin/plans/[id] - Soft-delete (deactivate) a plan
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params

  try {
    const existing = await prisma.plan.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    await prisma.plan.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deactivating plan:', err)
    return NextResponse.json({ error: 'Failed to deactivate plan' }, { status: 500 })
  }
}
