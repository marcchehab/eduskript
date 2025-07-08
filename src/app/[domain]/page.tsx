import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { PublicSiteLayout } from '@/components/public/layout'

// Enable ISR with on-demand regeneration
export const revalidate = 60 // Revalidate every 60 seconds
export const dynamic = 'force-static' // Force static generation
export const dynamicParams = true // Allow new params to be generated on-demand

interface DomainIndexProps {
  params: Promise<{
    domain: string
  }>
}

// Generate metadata for SEO
export async function generateMetadata({ params }: DomainIndexProps): Promise<Metadata> {
  const { domain } = await params
  
  try {
    const teacher = await prisma.user.findFirst({
      where: { subdomain: domain }
    })

    if (!teacher) {
      return {
        title: 'Teacher Not Found',
        description: 'The requested teacher could not be found.'
      }
    }

    const title = teacher.name || 'Eduscript'
    const description = teacher.bio || `Educational content by ${teacher.name}`

    return {
      title,
      description,
      authors: [{ name: teacher.name || 'Unknown' }],
      openGraph: {
        title,
        description,
        type: 'website',
        siteName: teacher.name || 'Eduscript',
        url: `https://${domain}`
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description
      }
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: 'Eduscript',
      description: 'Educational content platform'
    }
  }
}

export default async function DomainIndex({ params }: DomainIndexProps) {
  const { domain } = await params

  try {
    // Find teacher by subdomain (custom domains support will be added later)
    const teacher = await prisma.user.findFirst({
      where: {
        subdomain: domain
      },
      include: {
        scripts: {
          where: { isPublished: true },
          include: {
            chapters: {
              where: { isPublished: true },
              include: {
                pages: {
                  where: { isPublished: true },
                  orderBy: { order: 'asc' }
                }
              },
              orderBy: { order: 'asc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!teacher) {
      notFound()
    }

    const teacherData = {
      name: teacher.name || 'Teacher',
      subdomain: teacher.subdomain || '',
      bio: teacher.bio || undefined,
      title: teacher.title || undefined
    }

    return (
      <PublicSiteLayout teacher={teacherData} siteStructure={teacher.scripts}>
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Welcome to {teacher.name}&apos;s Educational Platform
            </h1>
            
            {teacher.bio && (
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 max-w-2xl mx-auto">
                {teacher.bio}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
              {teacher.scripts.map((script) => (
                <div key={script.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
                    {script.title}
                  </h3>
                  {script.description && (
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                      {script.description}
                    </p>
                  )}
                  <div className="text-sm text-gray-500 dark:text-gray-500">
                    {script.chapters.length} chapters • {' '}
                    {script.chapters.reduce((acc: number, ch) => acc + ch.pages.length, 0)} pages
                  </div>
                </div>
              ))}
            </div>

            {teacher.scripts.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">
                  No published content available yet.
                </p>
              </div>
            )}
          </div>
        </div>
      </PublicSiteLayout>
    )
  } catch (error) {
    console.error('Error fetching teacher site:', error)
    notFound()
  }
}
