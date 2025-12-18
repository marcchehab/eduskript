import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getOrgMembership } from '@/lib/org-auth'

// Enable ISR - pages are cached until explicitly invalidated
export const revalidate = false
export const dynamicParams = true

interface CollectionPageProps {
  params: Promise<{
    orgSlug: string
    collectionSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: CollectionPageProps): Promise<Metadata> {
  const { orgSlug, collectionSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Organization Not Found',
        description: 'The requested organization could not be found.'
      }
    }

    // Get org admins
    const adminMembers = await prisma.organizationMember.findMany({
      where: {
        organizationId: organization.id,
        role: { in: ['owner', 'admin'] }
      },
      select: { userId: true }
    })
    const adminUserIds = adminMembers.map(m => m.userId)

    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: { some: { userId: { in: adminUserIds } } }
      },
      select: { title: true, description: true }
    })

    if (!collection) {
      return {
        title: 'Collection Not Found',
        description: 'The requested collection could not be found.'
      }
    }

    return {
      title: `${collection.title} | ${organization.name}`,
      description: collection.description || `${collection.title} by ${organization.name}`
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform'
    }
  }
}

export default async function OrgCollectionPage({ params }: CollectionPageProps) {
  const { orgSlug, collectionSlug } = await params

  // Get organization
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true }
  })

  if (!organization) {
    notFound()
  }

  // Check if user is org admin
  const session = await getServerSession(authOptions)
  const membership = session?.user?.id
    ? await getOrgMembership(session.user.id, organization.id)
    : null
  const isAdmin =
    session?.user?.isAdmin ||
    membership?.role === 'owner' ||
    membership?.role === 'admin'

  // Get org admins for content lookup
  const adminMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: organization.id,
      role: { in: ['owner', 'admin'] }
    },
    select: { userId: true }
  })
  const adminUserIds = adminMembers.map(m => m.userId)

  // Find the collection
  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: { some: { userId: { in: adminUserIds } } }
    },
    include: {
      collectionSkripts: {
        include: {
          skript: {
            include: {
              pages: {
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  isPublished: true
                }
              }
            }
          }
        },
        orderBy: { order: 'asc' }
      }
    }
  })

  if (!collection) {
    notFound()
  }

  // Authorization: Only admins can view unpublished collections
  if (!collection.isPublished && !isAdmin) {
    notFound()
  }

  // Find the first available page to redirect to
  const firstCollectionSkript = collection.collectionSkripts.find(cs =>
    isAdmin || cs.skript.isPublished
  )

  const firstSkript = firstCollectionSkript?.skript
  const firstPage = firstSkript?.pages.find(page =>
    isAdmin || page.isPublished
  )

  if (firstPage && firstSkript) {
    // Redirect to the first available page
    redirect(`/org/${orgSlug}/c/${collectionSlug}/${firstSkript.slug}/${firstPage.slug}`)
  }

  // No pages available - 404
  notFound()
}
