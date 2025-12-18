import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageEditor } from '@/components/dashboard/page-editor'

interface PageParams {
  collectionSlug: string
  skriptSlug: string
  pageSlug: string
}

async function getPageData(collectionSlug: string, skriptSlug: string, pageSlug: string, userId: string) {
  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: {
          userId: userId
        }
      }
    }
  })

  if (!collection) return null

  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      collectionSkripts: {
        some: {
          collectionId: collection.id
        }
      }
    }
  })

  if (!skript) return null

  const page = await prisma.page.findFirst({
    where: { 
      slug: pageSlug, 
      skriptId: skript.id 
    },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  })

  if (!page) return null

  return { collection, skript, page }
}

export default async function PageEditPage({ 
  params 
}: { 
  params: Promise<PageParams> 
}) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return notFound()
  }

  const { collectionSlug, skriptSlug, pageSlug } = await params
  const data = await getPageData(collectionSlug, skriptSlug, pageSlug, session.user.id)

  if (!data) {
    return notFound()
  }

  const { collection, skript, page } = data

  return (
    <PageEditor
      collection={collection}
      skript={skript}
      page={{
        ...page,
        examSettings: page.examSettings as { requireSEB?: boolean } | null
      }}
    />
  )
}
