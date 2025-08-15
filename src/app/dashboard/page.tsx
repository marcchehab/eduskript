import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { FileText, BookOpen, Eye, Plus } from 'lucide-react'
import { AnalyticsDashboard } from '@/components/dashboard/analytics'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return null
  }

  // Fetch user's content statistics
  const [topics, totalChapters, totalPages] = await Promise.all([
    prisma.topic.findMany({
      where: {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        chapters: {
          include: {
            pages: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.chapter.count({
      where: {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    }),
    prisma.page.count({
      where: {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      }
    })
  ])

  const totalScripts = topics.length

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-2">
            Welcome back! Here&apos;s what&apos;s happening with your content.
          </p>
        </div>
        <Link href="/dashboard/topics/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Topic
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Topics</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalScripts}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Chapters</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalChapters}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pages</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalPages}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Scripts */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Scripts</CardTitle>
          <CardDescription>Your most recently updated scripts</CardDescription>
        </CardHeader>
        <CardContent>
          {topics.length > 0 ? (
            <div className="space-y-4">
              {topics.map((topic) => (
                <div key={topic.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Link href={`/dashboard/topics/${topic.slug}`}>
                      <h3 className="font-medium text-foreground">
                        {topic.title}
                      </h3>
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {topic.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{topic.chapters.length} chapters</span>
                      <span>
                        {topic.chapters.reduce((acc: number, ch: { pages: unknown[] }) => acc + ch.pages.length, 0)} pages
                      </span>
                      <span>
                        Updated {new Date(topic.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <BookOpen className="h-12 w-12 text-icon-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No scripts yet
              </h3>
              <p className="text-muted-foreground mb-4">
                Get started by creating your first educational script.
              </p>
              <Link href="/dashboard/topics/new">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Script
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analytics Dashboard */}
      <AnalyticsDashboard />
    </div>
  )
}
