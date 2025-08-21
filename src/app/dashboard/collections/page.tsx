'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, BookOpen, Eye } from 'lucide-react'

interface Collection {
  id: string
  title: string
  slug: string
  description?: string
  isPublished: boolean
  updatedAt: string
  skripts: Array<{
    id: string
    pages: Array<{ id: string }>
  }>
}

export default function CollectionsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCollections = async () => {
      try {
        const response = await fetch('/api/collections')
        if (response.ok) {
          const data = await response.json()
          setCollections(data.data || [])
        }
      } catch (error) {
        console.error('Error fetching collections:', error)
      } finally {
        setLoading(false)
      }
    }

    if (session?.user?.id) {
      fetchCollections()
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
            <h1 className="text-3xl font-bold text-foreground">Collections</h1>
            <p className="text-muted-foreground mt-2">Loading your collections...</p>
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
            Collections
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage your educational collections and content
          </p>
        </div>
        <Link href="/dashboard/collections/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Collection
          </Button>
        </Link>
      </div>

      {collections.length > 0 ? (
        <div className="grid gap-6">
          {collections.map((collection) => (
            <Card 
              key={collection.id} 
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => router.push(`/dashboard/collections/${collection.slug}`)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-xl hover:text-primary transition-colors">
                      {collection.title}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      {collection.description || 'No description provided'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Link href={`/${session.user.subdomain || 'preview'}/${collection.slug}`}>
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
                    <span>{collection.skripts.length} skripts</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span>
                      {collection.skripts.reduce((acc: number, ch) => acc + ch.pages.length, 0)} pages
                    </span>
                  </div>
                  <div>
                    Status: <span className={collection.isPublished ? 'text-success' : 'text-warning'}>
                      {collection.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <div>
                    Updated {new Date(collection.updatedAt).toLocaleDateString()}
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
              No collections yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Get started by creating your first educational collection.
            </p>
            <Link href="/dashboard/collections/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Collection
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
