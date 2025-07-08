import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Plus, BookOpen, Eye, Edit } from 'lucide-react'

export default async function ScriptsPage() {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return null
  }

  const scripts = await prisma.script.findMany({
    where: { authorId: session.user.id },
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
            Scripts
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your educational scripts and content
          </p>
        </div>
        <Link href="/dashboard/scripts/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Script
          </Button>
        </Link>
      </div>

      {scripts.length > 0 ? (
        <div className="grid gap-6">
          {scripts.map((script) => (
            <Card key={script.id}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <Link href={`/dashboard/scripts/${script.slug}`}>
                      <CardTitle className="text-xl hover:text-primary cursor-pointer transition-colors">
                        {script.title}
                      </CardTitle>
                    </Link>
                    <CardDescription className="mt-2">
                      {script.description || 'No description provided'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/dashboard/scripts/${script.slug}`}>
                      <Button variant="outline" size="sm">
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </Link>
                    <Link href={`/${session.user.subdomain || 'preview'}/${script.slug}`}>
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
                    <span>{script.chapters.length} chapters</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span>
                      {script.chapters.reduce((acc: number, ch) => acc + ch.pages.length, 0)} pages
                    </span>
                  </div>
                  <div>
                    Status: <span className={script.isPublished ? 'text-success' : 'text-warning'}>
                      {script.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <div>
                    Updated {new Date(script.updatedAt).toLocaleDateString()}
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
              No scripts yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Get started by creating your first educational script.
            </p>
            <Link href="/dashboard/scripts/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Script
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
