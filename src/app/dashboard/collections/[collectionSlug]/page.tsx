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
    collectionSlug: string
  }>
}

export default async function CollectionPage({ params }: CollectionPageProps) {
  const session = await getServerSession(authOptions)
  const { collectionSlug } = await params
  
  if (!session?.user?.id) {
    return null
  }

  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: {
          userId: session.user.id
        }
      }
    },
    include: {
      collectionSkripts: {
        include: {
          skript: {
            include: {
              pages: {
                orderBy: { order: 'asc' }
              },
              authors: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true
                    }
                  }
                }
              }
            }
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

  // Transform the data structure to match what CollectionEditor expects
  const transformedCollection = {
    ...collection,
    skripts: collection.collectionSkripts
      .sort((a, b) => a.order - b.order) // Ensure they're sorted by order
      .map(cs => ({
        ...cs.skript,
        order: cs.order // Add the order from the junction table to the skript
      }))
  }

  return <CollectionEditor collection={transformedCollection} userPermissions={userPermissions} currentUserId={session.user.id} username={session.user.pageSlug || ''} />
}
