import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CollectionEditor } from '@/components/dashboard/collection-editor'

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
      }
    }
  })

  if (!collection) {
    notFound()
  }

  return <CollectionEditor collection={collection} />
}
