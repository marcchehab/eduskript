'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateSkriptModal } from './create-skript-modal'
import { CollectionSettingsModal } from './collection-settings-modal'
import { SortableSkripts } from './sortable-skripts'
import { ArrowLeft, BookOpen, FileText } from 'lucide-react'

interface CollectionEditorProps {
  collection: {
    id: string
    title: string
    description: string | null
    slug: string
    isPublished: boolean
    skripts: Array<{
      id: string
      title: string
      slug: string
      description: string | null
      order: number
      isPublished: boolean
      updatedAt: Date
      pages: Array<{
        id: string
        title: string
        slug: string
        order: number
        isPublished: boolean
        updatedAt: Date
      }>
    }>
  }
}

export function CollectionEditor({ collection }: CollectionEditorProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPublished, setIsPublished] = useState(collection.isPublished)
  const router = useRouter()

  const handleSkriptCreated = () => {
    // Force a complete page refresh to ensure data is updated
    window.location.reload()
  }

  const handleCollectionUpdated = (updatedCollection?: {
    id: string
    title: string
    description: string | null
    slug: string
  }) => {
    if (updatedCollection && updatedCollection.slug !== collection.slug) {
      // If slug changed, redirect to new URL
      router.push(`/dashboard/collections/${updatedCollection.slug}`)
    } else {
      // Force a complete page refresh to ensure data is updated
      window.location.reload()
    }
  }

  const handlePublish = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/collections/${collection.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isPublished: !isPublished
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update collection')
      }

      const updatedCollection = await response.json()
      setIsPublished(updatedCollection.isPublished)
      
      // Optionally show success message or refresh
      window.location.reload()
    } catch (error) {
      console.error('Error publishing collection:', error)
      // You might want to show an error toast here
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/collections">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Collections
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground">
            {collection.title}
          </h1>
          <p className="text-muted-foreground mt-2">
            {collection.description || 'No description'}
          </p>
        </div>
        <div className="flex gap-2">
          <CollectionSettingsModal 
            collection={collection}
            onCollectionUpdated={handleCollectionUpdated}
          />
          <Button 
            onClick={handlePublish}
            disabled={isLoading}
          >
            {isLoading ? 'Publishing...' : (isPublished ? 'Unpublish' : 'Publish')}
          </Button>
        </div>
      </div>

      {/* Collection Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Skripts</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{collection.skripts.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pages</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {collection.skripts.reduce((acc: number, ch) => acc + ch.pages.length, 0)}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isPublished ? 'text-success' : 'text-warning'}`}>
              {isPublished ? 'Published' : 'Draft'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Skripts */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Skripts</CardTitle>
              <CardDescription>Organize your content into skripts</CardDescription>
            </div>
            <CreateSkriptModal 
              collectionId={collection.id} 
              onSkriptCreated={handleSkriptCreated}
            />
          </div>
        </CardHeader>
        <CardContent>
          {collection.skripts.length > 0 ? (
            <SortableSkripts
              skripts={collection.skripts}
              collectionId={collection.id}
              collectionSlug={collection.slug}
              onReorder={handleSkriptCreated}
            />
          ) : (
            <div className="text-center py-8">
              <BookOpen className="h-12 w-12 text-icon-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No skripts yet
              </h3>
              <p className="text-muted-foreground mb-4">
                Start organizing your content by creating your first skript.
              </p>
              <CreateSkriptModal 
                collectionId={collection.id} 
                onSkriptCreated={handleSkriptCreated}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
