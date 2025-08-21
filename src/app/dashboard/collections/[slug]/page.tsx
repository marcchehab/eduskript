import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CollectionEditor } from '@/components/dashboard/collection-editor'
import { checkCollectionPermissions } from '@/lib/permissions'

// Ensure the page is dynamic and not cached
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface CollectionPageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const session = await getServerSession(authOptions)
  const { slug } = await params
  
  if (!session?.user?.id) {
    return null
  }

  const collection = await prisma.collection.findFirst({
    where: {
      slug: slug,
      authors: {
        some: {
          userId: session.user.id
        }
      }
    },
    include: {
      skripts: {
        include: {
          pages: {
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { order: 'asc' }
      },
      authors: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              title: true
            }
          }
        }
      }
    }
  })

  if (!collection) {
    notFound()
  }

  // Check user permissions for this collection
  const userPermissions = checkCollectionPermissions(session.user.id, collection.authors)

  return <CollectionEditor collection={collection} userPermissions={userPermissions} />
}
