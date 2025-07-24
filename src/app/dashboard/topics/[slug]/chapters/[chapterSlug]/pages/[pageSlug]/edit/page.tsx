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
  const script = await prisma.topic.findFirst({
    where: { 
      slug,
      authors: {
        some: {
          userId: userId
        }
      }
    }
  })

  if (!script) return null

  const chapter = await prisma.chapter.findFirst({
    where: { 
      slug: chapterSlug, 
      topicId: script.id 
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

  return { script, chapter, page }
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

  const { script, chapter, page } = data

  return (
    <PageEditor 
      script={script} 
      chapter={chapter} 
      page={page} 
    />
  )
}
