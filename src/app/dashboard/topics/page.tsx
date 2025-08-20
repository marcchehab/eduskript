'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, BookOpen, Eye } from 'lucide-react'

interface Topic {
  id: string
  title: string
  slug: string
  description?: string
  isPublished: boolean
  updatedAt: string
  chapters: Array<{
    id: string
    pages: Array<{ id: string }>
  }>
}

export default function TopicsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const response = await fetch('/api/topics')
        if (response.ok) {
          const data = await response.json()
          setTopics(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching topics:', error)
      } finally {
        setLoading(false)
      }
    }

    if (session?.user?.id) {
      fetchTopics()
    }
  }, [session?.user?.id])

  if (!session?.user?.id) {
    return null
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Topics</h1>
            <p className="text-muted-foreground mt-2">Loading your topics...</p>
          </div>
        </div>
      </div>
    )
  }

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
            <Card 
              key={topic.id} 
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => router.push(`/dashboard/topics/${topic.slug}`)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-xl hover:text-primary transition-colors">
                      {topic.title}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {topic.description || 'No description provided'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
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
