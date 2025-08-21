import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageEditor } from '@/components/dashboard/page-editor'

interface PageParams {
  slug: string
  chapterSlug: string
  pageSlug: string
}

async function getPageData(slug: string, chapterSlug: string, pageSlug: string, userId: string) {
  const collection = await prisma.collection.findFirst({
    where: { 
      slug,
      authors: {
        some: {
          userId: userId
        }
      }
    }
  })

  if (!collection) return null

  const chapter = await prisma.chapter.findFirst({
    where: { 
      slug: chapterSlug, 
      collectionId: collection.id 
    }
  })

  if (!chapter) return null

  const page = await prisma.page.findFirst({
    where: { 
      slug: pageSlug, 
      chapterId: chapter.id 
    },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1
      }
    }
  })

  if (!page) return null

  return { collection, chapter, page }
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

  const { slug, chapterSlug, pageSlug } = await params
  const data = await getPageData(slug, chapterSlug, pageSlug, session.user.id)

  if (!data) {
    return notFound()
  }

  const { collection, chapter, page } = data

  return (
    <PageEditor 
      collection={collection} 
      chapter={chapter} 
      page={page} 
    />
  )
}
