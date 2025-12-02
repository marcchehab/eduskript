import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkSkriptPermissions } from '@/lib/permissions'
import { FrontPageEditor } from '@/components/dashboard/frontpage-editor'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SkriptFrontPageProps {
  params: Promise<{
    slug: string
    skriptSlug: string
  }>
}

export default async function SkriptFrontPageEditPage({ params }: SkriptFrontPageProps) {
  const session = await getServerSession(authOptions)
  const { slug: collectionSlug, skriptSlug } = await params

  if (!session?.user?.id) {
    redirect('/auth/signin')
  }

  // Get the collection
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

  // Get the skript with permissions
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
          user: true
        }
      },
      frontPage: true
    }
  })

  if (!skript) {
    notFound()
  }

  // Check permissions
  const permissions = checkSkriptPermissions(session.user.id, skript.authors)

  if (!permissions.canEdit) {
    redirect(`/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}`)
  }

  // Get user's username for preview URL
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pageSlug: true }
  })

  const previewUrl = user?.pageSlug
    ? `/${user.pageSlug}/${collectionSlug}/${skriptSlug}`
    : undefined

  return (
    <FrontPageEditor
      type="skript"
      frontPage={skript.frontPage}
      skript={{
        id: skript.id,
        slug: skript.slug,
        title: skript.title,
        collectionSlug
      }}
      backUrl={`/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}`}
      previewUrl={previewUrl}
    />
  )
}
