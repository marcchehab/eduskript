import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { SkriptEditor } from '@/components/dashboard/skript-editor'

// Ensure the page is dynamic and not cached
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SkriptPageProps {
  params: Promise<{
    collectionSlug: string
    skriptSlug: string
  }>
}

export default async function SkriptPage({ params }: SkriptPageProps) {
  const session = await getServerSession(authOptions)
  const { collectionSlug, skriptSlug } = await params
  
  if (!session?.user?.id) {
    return null
  }

  // First get the collection to ensure the path is valid
  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: {
          userId: session.user.id
        }
      }
    }
  })

  if (!collection) {
    notFound()
  }

  // Get the skript with all its data
  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      collectionSkripts: {
        some: {
          collectionId: collection.id
        }
      }
    },
    include: {
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
      },
      pages: {
        orderBy: { order: 'asc' },
        include: {
          authors: {
            include: {
              user: true
            }
          }
        }
      },
      collectionSkripts: {
        where: {
          collectionId: collection.id
        },
        include: {
          collection: true
        }
      }
    }
  })

  if (!skript) {
    notFound()
  }

  // Check permissions
  const permissions = checkSkriptPermissions(session.user.id, skript.authors)
  
  if (!permissions.canView) {
    notFound()
  }

  // If user can't edit, redirect to the collection page
  if (!permissions.canEdit) {
    redirect(`/dashboard/collections/${collectionSlug}`)
  }

  return (
    <SkriptEditor 
      skript={skript}
      collectionSlug={collectionSlug}
      canEdit={permissions.canEdit}
      userPermissions={permissions}
      currentUserId={session.user.id}
    />
  )
}