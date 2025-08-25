'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, FileText, Plus, Settings } from 'lucide-react'
import { SortablePages } from './sortable-pages'
import { EditModal } from './edit-modal'
import { PublishToggle } from './publish-toggle'
import { CreatePageModal } from './create-page-modal'
import { Skript, Page, SkriptAuthor, PageAuthor, User, Collection, CollectionSkript } from '@prisma/client'

interface SkriptWithData extends Skript {
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  pages: (Page & {
    authors: (PageAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  })[]
  collectionSkripts: (CollectionSkript & { collection: Collection })[]
}

interface SkriptEditorProps {
  skript: SkriptWithData
  collectionSlug: string
  canEdit: boolean
}

export function SkriptEditor({ skript, collectionSlug, canEdit }: SkriptEditorProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSkriptUpdated = () => {
    router.refresh()
  }

  const handleDeleteSkript = async () => {
    if (!confirm(`Are you sure you want to delete the skript "${skript.title}"? This will also delete all pages in this skript.`)) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/skripts/${skript.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        router.push(`/dashboard/collections/${collectionSlug}`)
      } else {
        alert('Failed to delete skript')
      }
    } catch (error) {
      console.error('Error deleting skript:', error)
      alert('Failed to delete skript')
    } finally {
      setIsLoading(false)
    }
  }

  const collection = skript.collectionSkripts[0]?.collection

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/collections/${collectionSlug}`}>
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to {collection?.title || 'Collection'}
            </Button>
          </Link>
        </div>
      </div>

      {/* Skript Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-primary" />
              <div>
                <CardTitle className="text-2xl">{skript.title}</CardTitle>
                {skript.description && (
                  <p className="text-muted-foreground mt-1">{skript.description}</p>
                )}
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <PublishToggle
                  type="skript"
                  itemId={skript.id}
                  isPublished={skript.isPublished}
                  onToggle={handleSkriptUpdated}
                  showText={true}
                />
                <EditModal
                  type="skript"
                  item={skript}
                  onItemUpdated={handleSkriptUpdated}
                  triggerClassName="gap-2"
                  buttonText="Edit Skript"
                />
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={handleDeleteSkript}
                  disabled={isLoading}
                >
                  Delete Skript
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <span>Slug: <code className="text-xs bg-muted px-1 py-0.5 rounded">{skript.slug}</code></span>
            <span>{skript.pages.length} pages</span>
            <span>Updated {new Date(skript.updatedAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pages Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Pages
            </CardTitle>
            {canEdit && (
              <CreatePageModal 
                skriptId={skript.id} 
                onPageCreated={handleSkriptUpdated}
                buttonVariant="default"
                buttonText="Add Page"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {skript.pages.length > 0 ? (
            <SortablePages
              pages={skript.pages}
              collectionSlug={collectionSlug}
              skriptSlug={skript.slug}
              onPagesReordered={handleSkriptUpdated}
              canEdit={canEdit}
            />
          ) : (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No pages yet</p>
              {canEdit && (
                <CreatePageModal 
                  skriptId={skript.id} 
                  onPageCreated={handleSkriptUpdated}
                  buttonVariant="default"
                  buttonText="Create First Page"
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}