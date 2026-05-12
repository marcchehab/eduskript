import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SkriptPageProps {
  params: Promise<{
    skriptSlug: string
  }>
}

// Redirects to the first page's edit URL.
// If the skript has no pages, creates a default page first.
export default async function SkriptPage({ params }: SkriptPageProps) {
  const session = await getServerSession(authOptions)
  const { skriptSlug } = await params

  if (!session?.user?.id) {
    return notFound()
  }

  const skript = await prisma.skript.findFirst({
    where: {
      slug: skriptSlug,
      ...(session.user.isAdmin ? {} : {
        authors: {
          some: { userId: session.user.id }
        }
      })
    },
    include: {
      pages: {
        orderBy: { order: 'asc' },
        take: 1,
        select: { slug: true }
      }
    }
  })

  if (!skript) {
    notFound()
  }

  if (skript.pages.length > 0) {
    redirect(`/dashboard/skripts/${skriptSlug}/pages/${skript.pages[0].slug}/edit`)
  }

  // No pages exist — create a default page and redirect to it.
  // The page-authors row is required: every other code path that loads a
  // page for edit (loadPageForActor in src/lib/services/pages.ts) filters
  // by `authors: { some: { userId } }`. Without it the creator can't even
  // save the page they just landed on.
  const defaultPage = await prisma.page.create({
    data: {
      title: 'Introduction',
      slug: 'introduction',
      content: `# Introduction\n\nThis is your first page. Start writing here!\n`,
      isPublished: true,
      skriptId: skript.id,
      order: 0,
      authors: {
        create: { userId: session.user.id, permission: 'author' },
      },
    }
  })

  redirect(`/dashboard/skripts/${skriptSlug}/pages/${defaultPage.slug}/edit`)
}
