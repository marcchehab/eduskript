import { notFound } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { SkriptRedirect } from '@/components/SkriptRedirect'

// Enable ISR with on-demand regeneration for previews
export const revalidate = 0 // No caching for previews to show latest changes
export const dynamic = 'force-dynamic' // Force dynamic rendering for auth checks

interface SkriptPreviewProps {
  params: Promise<{
    domain: string
    collectionSlug: string
    skriptSlug: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: SkriptPreviewProps): Promise<Metadata> {
  const { domain, collectionSlug, skriptSlug } = await params
  
  try {
    // Find the teacher and collection
    const teacher = await prisma.user.findUnique({
      where: { subdomain: domain },
      select: { id: true, name: true, title: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher profile could not be found.'
      }
    }

    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: {
            userId: teacher.id
          }
        }
      },
      select: { title: true, description: true }
    })

    if (!collection) {
      return {
        title: 'Collection Not Found',
        description: 'The requested collection could not be found.'
      }
    }

    const skript = await prisma.skript.findFirst({
      where: {
        slug: skriptSlug,
        collection: {
          slug: collectionSlug,
          authors: {
            some: {
              userId: teacher.id
            }
          }
        }
      },
      select: { title: true }
    })

    if (!skript) {
      return {
        title: 'Skript Not Found',
        description: 'The requested skript could not be found.'
      }
    }

    return {
      title: `${skript.title} - ${collection.title} | ${teacher.name || domain}`,
      description: `${skript.title} from ${collection.title} by ${teacher.name || domain}`,
      robots: 'noindex, nofollow' // Prevent search engines from indexing previews
    }
  } catch (error) {
    console.error('Error generating metadata for skript preview:', error)
    return {
      title: 'Skript Preview',
      description: 'Preview mode for skript content'
    }
  }
}

interface CollectionPage {
  id: string
  title: string
  slug: string
  order: number
  isPublished: boolean
}





export default async function SkriptPreviewPage({ params }: SkriptPreviewProps) {
  const { domain, collectionSlug, skriptSlug } = await params
  const session = await getServerSession(authOptions)

  try {
    // Find the teacher
    const teacher = await prisma.user.findUnique({
      where: { subdomain: domain },
      select: { 
        id: true, 
        name: true, 
        email: true,
        title: true, 
        bio: true, 
        subdomain: true 
      }
    })

    if (!teacher) {
      notFound()
    }

    // Check if current user is the author
    const isAuthor = session?.user?.email === teacher.email

    // Find the collection with the specific skript
    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: {
            userId: teacher.id
          }
        }
      },
      include: {
        skripts: {
          where: {
            slug: skriptSlug
          },
          include: {
            pages: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                title: true,
                slug: true,
                order: true,
                isPublished: true
              }
            }
          }
        }
      }
    })

    if (!collection) {
      notFound()
    }

    // Authorization check: Only the author can preview unpublished collections
    if (!collection.isPublished && !isAuthor) {
      notFound()
    }

    const skript = collection.skripts[0]
    if (!skript) {
      notFound()
    }

    // Authorization check for skript
    if (!skript.isPublished && !isAuthor) {
      notFound()
    }

    // Find the first available page to redirect to
    const firstPage = skript.pages.find((page: CollectionPage) => 
      isAuthor || page.isPublished
    )

    if (firstPage) {
      // Redirect to the first available page
      return <SkriptRedirect redirectUrl={`/${domain}/${collectionSlug}/${skriptSlug}/${firstPage.slug}`} />
    }

    // If no pages are available, redirect back to collection
    return <SkriptRedirect redirectUrl={`/${domain}/${collectionSlug}`} />

  } catch (error) {
    console.error('Error loading skript preview:', error)
    notFound()
  }
} 