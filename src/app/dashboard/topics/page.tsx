import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Plus, BookOpen, Eye, Edit } from 'lucide-react'

export default async function TopicsPage() {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return null
  }

  const topics = await prisma.topic.findMany({
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
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Topics
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your educational topics and content
          </p>
        </div>
        <Link href="/dashboard/topics/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Topic
          </Button>
        </Link>
      </div>

      {topics.length > 0 ? (
        <div className="grid gap-6">
          {topics.map((topic) => (
            <Card key={topic.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <Link href={`/dashboard/topics/${topic.slug}`}>
                      <CardTitle className="text-xl hover:text-primary cursor-pointer transition-colors">
                        {topic.title}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-2">
                      {topic.description || 'No description provided'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/dashboard/topics/${topic.slug}`}>
                      <Button variant="outline" size="sm">
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </Link>
                    <Link href={`/${session.user.subdomain || 'preview'}/${topic.slug}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        Preview
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    <span>{topic.chapters.length} chapters</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span>
                      {topic.chapters.reduce((acc: number, ch) => acc + ch.pages.length, 0)} pages
                    </span>
                  </div>
                  <div>
                    Status: <span className={topic.isPublished ? 'text-success' : 'text-warning'}>
                      {topic.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <div>
                    Updated {new Date(topic.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <BookOpen className="h-12 w-12 text-icon-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No topics yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Get started by creating your first educational topic.
            </p>
            <Link href="/dashboard/topics/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Topic
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
