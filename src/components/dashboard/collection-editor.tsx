'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateSkriptModal } from './create-skript-modal'
import { CollectionSettingsModal } from './collection-settings-modal'
import { SortableSkripts } from './sortable-skripts'
import { CollectionAccessManager } from '@/components/permissions/CollectionAccessManager'
import { CollapsibleDrawer } from '@/components/ui/collapsible-drawer'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { ArrowLeft, BookOpen, ExternalLink, FileText, Users } from 'lucide-react'
import { UserPermissions, CollectionWithAuthors } from '@/types'

interface CollectionEditorProps {
  currentUserId: string
  username: string
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
    authors: Array<{
      id: string
      collectionId: string
      userId: string
      permission: string
      createdAt: Date
      user: {
        id: string
        name: string | null
        email: string | null
        image: string | null
        title: string | null
      }
    }>
  }
  userPermissions: UserPermissions
}

export function CollectionEditor({ collection, userPermissions, currentUserId, username }: CollectionEditorProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPublished, setIsPublished] = useState(collection.isPublished)
  const router = useRouter()
  const alert = useAlertDialog()

  const handleSkriptCreated = () => {
    // Force a complete page refresh to ensure data is updated
    window.location.reload()
  }

  const handleSkriptReordered = () => {
    // For reordering, we don't need to refresh since the UI is already updated optimistically
    // Only refresh for actual content changes like creating new skripts
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

  const handleDeleteCollection = async () => {
    if (!confirm(`Are you sure you want to delete the collection "${collection.title}"? Skripts in this collection will not be deleted, but will lose their association with this collection.`)) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/collections/${collection.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        router.push('/dashboard/collections')
      } else {
        alert.showError('Failed to delete collection')
      }
    } catch (error) {
      console.error('Error deleting collection:', error)
      alert.showError('Failed to delete collection')
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
          <Link href={`/${username}/${collection.slug}`} target="_blank">
            <Button variant="outline">
              <ExternalLink className="w-4 h-4 mr-2" />
              Preview
            </Button>
          </Link>
          {userPermissions.canEdit && (
            <>
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
              <Button
                variant="destructive"
                onClick={handleDeleteCollection}
                disabled={isLoading}
              >
                Delete Collection
              </Button>
            </>
          )}
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

      {/* Access Management */}
      <CollapsibleDrawer
        title="Access Management"
        icon={<Users className="w-5 h-5 text-muted-foreground" />}
        defaultOpen={false}
      >
        <div className="p-4">
          <CollectionAccessManager
            collection={collection as CollectionWithAuthors}
            userPermissions={userPermissions}
            currentUserId={currentUserId}
            onPermissionChange={() => {
              // No need to reload - the CollectionAccessManager handles state updates internally
            }}
          />
        </div>
      </CollapsibleDrawer>

      {/* Skripts */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Skripts</CardTitle>
              <CardDescription>Organize your content into skripts</CardDescription>
            </div>
            {userPermissions.canEdit && (
              <CreateSkriptModal 
                collectionId={collection.id} 
                onSkriptCreated={handleSkriptCreated}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {collection.skripts.length > 0 ? (
            <SortableSkripts
              skripts={collection.skripts}
              collectionId={collection.id}
              collectionSlug={collection.slug}
              onReorder={handleSkriptReordered}
              onSkriptUpdated={handleSkriptCreated}
              onSkriptDeleted={handleSkriptCreated}
              canEdit={userPermissions.canEdit}
              currentUserId={currentUserId}
              username={username}
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
