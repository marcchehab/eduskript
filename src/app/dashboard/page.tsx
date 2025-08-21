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
  const [collections, totalSkripts, totalPages] = await Promise.all([
    prisma.collection.findMany({
      where: {
        authors: {
          some: {
            userId: session.user.id
          }
        }
      },
      include: {
        skripts: {
          include: {
            pages: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.skript.count({
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

  const totalCollections = collections.length

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
        <Link href="/dashboard/collections/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Collection
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Collections</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCollections}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Skripts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSkripts}</div>
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

      {/* Recent Collections */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Collections</CardTitle>
          <CardDescription>Your most recently updated collections</CardDescription>
        </CardHeader>
        <CardContent>
          {collections.length > 0 ? (
            <div className="space-y-4">
              {collections.map((collection) => (
                <div key={collection.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <Link href={`/dashboard/collections/${collection.slug}`}>
                      <h3 className="font-medium text-foreground">
                        {collection.title}
                      </h3>
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {collection.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{collection.skripts.length} skripts</span>
                      <span>
                        {collection.skripts.reduce((acc: number, ch: { pages: unknown[] }) => acc + ch.pages.length, 0)} pages
                      </span>
                      <span>
                        Updated {new Date(collection.updatedAt).toLocaleDateString()}
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
                No collections yet
              </h3>
              <p className="text-muted-foreground mb-4">
                Get started by creating your first educational collection.
              </p>
              <Link href="/dashboard/collections/new">
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Collection
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
