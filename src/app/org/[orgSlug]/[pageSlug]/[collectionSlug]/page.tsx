import { notFound } from 'next/navigation'
import { PublicSiteLayout } from '@/components/public/layout'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'

interface PageProps {
  params: Promise<{
    orgSlug: string
    pageSlug: string
    collectionSlug: string
  }>
}

// Enable ISR
export const revalidate = false
export const dynamicParams = true

export async function generateStaticParams() {
  return []
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, pageSlug, collectionSlug } = await params

  try {
    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true }
    })

    if (!organization) {
      return {
        title: 'Page Not Found',
        description: 'The requested page could not be found.'
      }
    }

    // Find teacher
    const teacher = await prisma.user.findFirst({
      where: {
        pageSlug: pageSlug,
        organizationMemberships: {
          some: { organizationId: organization.id }
        }
      },
      select: { id: true, name: true, pageName: true }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found.'
      }
    }

    // Get the collection
    const collection = await prisma.collection.findFirst({
      where: {
        slug: collectionSlug,
        authors: {
          some: { userId: teacher.id }
        }
      }
    })

    if (!collection) {
      return {
        title: 'Collection Not Found',
        description: 'The requested collection could not be found.',
        robots: 'noindex'
      }
    }

    const teacherName = teacher.pageName || teacher.name || 'Teacher'
    const title = `${collection.title} | ${teacherName} | ${organization.name}`
    const description = collection.description || `${collection.title} by ${teacherName}`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: organization.name,
        url: `/org/${orgSlug}/${pageSlug}/${collectionSlug}`
      }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduskript',
      description: 'Educational content platform'
    }
  }
}

export default async function OrgTeacherCollectionPage({ params }: PageProps) {
  const { orgSlug, pageSlug, collectionSlug } = await params

  // Get organization
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      description: true,
      logoUrl: true
    }
  })

  if (!organization) {
    notFound()
  }

  // Find teacher
  const teacher = await prisma.user.findFirst({
    where: {
      pageSlug: pageSlug,
      organizationMemberships: {
        some: { organizationId: organization.id }
      }
    },
    select: {
      id: true,
      name: true,
      pageName: true,
      pageDescription: true,
      pageIcon: true,
      bio: true,
      title: true,
      sidebarBehavior: true,
      typographyPreference: true
    }
  })

  if (!teacher) {
    notFound()
  }

  // Get the collection with its skripts
  const collection = await prisma.collection.findFirst({
    where: {
      slug: collectionSlug,
      authors: {
        some: { userId: teacher.id }
      }
    },
    include: {
      collectionSkripts: {
        where: {
          skript: { isPublished: true }
        },
        include: {
          skript: {
            include: {
              pages: {
                where: { isPublished: true },
                orderBy: { order: 'asc' },
                select: { id: true, title: true, slug: true }
              }
            }
          }
        },
        orderBy: { order: 'asc' }
      }
    }
  })

  if (!collection) {
    notFound()
  }

  // Build site structure
  const siteStructure = [{
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    skripts: collection.collectionSkripts.map(cs => ({
      id: cs.skript.id,
      title: cs.skript.title,
      slug: cs.skript.slug,
      pages: cs.skript.pages.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug
      }))
    }))
  }]

  const teacherData = {
    name: teacher.name || 'Teacher',
    pageSlug: teacher.pageName || pageSlug,
    pageName: teacher.pageName || null,
    pageDescription: teacher.pageDescription || null,
    pageIcon: teacher.pageIcon || null,
    bio: teacher.bio || null,
    title: teacher.title || null
  }

  const currentPath = `/${collectionSlug}`

  return (
    <PublicSiteLayout
      teacher={teacherData}
      siteStructure={siteStructure}
      currentPath={currentPath}
      sidebarBehavior={teacher.sidebarBehavior as 'contextual' | 'full' || 'contextual'}
      typographyPreference={teacher.typographyPreference as 'modern' | 'classic' || 'modern'}
      routePrefix={`/org/${orgSlug}/${pageSlug}`}
    >
      <div id="paper" className="paper-responsive py-24 bg-card dark:bg-slate-900/80 paper-shadow border border-border dark:border-white/10">
        <div className="text-center py-8">
          <h1 className="text-3xl font-bold mb-4">{collection.title}</h1>
          {collection.description && (
            <p className="text-muted-foreground mb-8">{collection.description}</p>
          )}
        </div>

        {collection.collectionSkripts.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {collection.collectionSkripts.map(cs => (
              <Link
                key={cs.skript.id}
                href={`/org/${orgSlug}/${pageSlug}/${collectionSlug}/${cs.skript.slug}`}
                className="block p-6 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 transition-colors"
              >
                <h2 className="text-xl font-semibold mb-2">{cs.skript.title}</h2>
                {cs.skript.description && (
                  <p className="text-sm text-muted-foreground mb-2">{cs.skript.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {cs.skript.pages.length} {cs.skript.pages.length === 1 ? 'page' : 'pages'}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground">
            No published skripts in this collection yet.
          </p>
        )}
      </div>
    </PublicSiteLayout>
  )
}
