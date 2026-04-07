'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { EditModal } from './edit-modal'
import { PublishToggle } from './publish-toggle'
import { CreatePageModal } from './create-page-modal'
import { SortablePages } from './sortable-pages'
import { GripVertical, Trash2, Eye, Edit, Globe, ExternalLink, Loader2 } from 'lucide-react'
import { usePublicUrl } from '@/hooks/use-public-url'

interface Skript {
  id: string
  title: string
  slug: string
  description: string | null
  order: number
  updatedAt: Date
  isPublished: boolean
  isUnlisted?: boolean
  pages: Array<{
    id: string
    title: string
    slug: string
    order: number
    isPublished: boolean
    isUnlisted?: boolean
    updatedAt: Date
  }>
  authors?: Array<{
    userId: string
    permission: string
    user: {
      id: string
      name: string | null
      email: string
    }
  }>
}

interface SortableSkriptItemProps {
  skript: Skript
  index: number
  onSkriptUpdated: () => void
  onSkriptDeleted: () => void
  canEdit?: boolean
  username?: string
}

function SortableSkriptItem({
  skript,
  index,
  onSkriptUpdated,
  onSkriptDeleted,
  canEdit = true,
  currentUserId,
  username
}: SortableSkriptItemProps & { currentUserId?: string }) {
  // Check if current user can edit this specific skript
  const canEditSkript = canEdit && (!skript.authors || skript.authors.length === 0 ||
    skript.authors.some(a => a.userId === currentUserId && a.permission === 'author'))
  const isViewOnly = !canEditSkript
  const alert = useAlertDialog()
  const { buildViewUrl } = usePublicUrl(username)
  const [isPublishingAll, setIsPublishingAll] = useState(false)

  const handlePublishAll = async () => {
    setIsPublishingAll(true)
    try {
      const response = await fetch(`/api/skripts/${skript.id}/publish-all`, {
        method: 'POST'
      })

      if (response.ok) {
        const result = await response.json()
        alert.showSuccess(`Published skript and ${result.pagesPublished} pages`)
        onSkriptUpdated()
      } else {
        alert.showError('Failed to publish')
      }
    } catch {
      alert.showError('Failed to publish')
    } finally {
      setIsPublishingAll(false)
    }
  }

  const handlePreview = () => {
    if (username && skript.pages.length > 0) {
      const firstPage = skript.pages.sort((a, b) => a.order - b.order)[0]
      const isFullyPublished = skript.isPublished && firstPage.isPublished
      window.open(buildViewUrl(skript.slug, firstPage.slug, isFullyPublished), '_blank')
    }
  }

  const handleDeleteSkript = async () => {
    if (!confirm(`Are you sure you want to delete the skript "${skript.title}"? This will also delete all pages in this skript.`)) {
      return
    }

    try {
      const response = await fetch(`/api/skripts/${skript.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onSkriptDeleted()
      } else {
        alert.showError('Failed to delete skript')
      }
    } catch {
      alert.showError('Failed to delete skript')
    }
  }

  return (
    <Draggable draggableId={skript.id} index={index}>
      {(provided, snapshot) => (
        <div 
          ref={provided.innerRef} 
          {...provided.draggableProps}
          className={`border rounded-lg transition-all ${isViewOnly ? 'bg-muted/50 opacity-75' : 'bg-card hover:bg-muted/50'}`}
          style={{
            ...provided.draggableProps.style,
            opacity: snapshot.isDragging ? 0.5 : 1,
          }}
        >
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div
                {...provided.dragHandleProps}
                className="flex items-center gap-2 text-muted-foreground cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="w-4 h-4" />
                <div className={`w-8 h-8 ${isViewOnly ? 'bg-muted' : 'bg-primary/10 text-primary'} rounded-full flex items-center justify-center font-medium relative`}>
                  {index + 1}
                  {isViewOnly && (
                    <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
                  )}
                  {!isViewOnly && canEdit && (
                    <Edit className="w-3 h-3 text-primary absolute -bottom-1 -right-1 bg-background rounded-full" />
                  )}
                </div>
              </div>
              <div>
                <Link href={`/dashboard/skripts/${skript.slug}`} className="inline-flex items-center gap-1.5 hover:underline w-fit">
                  <h3 className={`font-medium ${isViewOnly ? 'text-muted-foreground' : 'text-foreground'} transition-colors`}>
                    {skript.title}
                  </h3>
                  {!isViewOnly && <Edit className="w-3 h-3 flex-shrink-0" />}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {skript.description || 'No description'}
                </p>
                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                  <span>{skript.pages.length} pages</span>
                  <span>
                    Updated {new Date(skript.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {canEditSkript && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePublishAll}
                    disabled={isPublishingAll}
                    className="text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                    title="Publish skript and all pages"
                  >
                    {isPublishingAll ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    <span className="ml-1.5">Publish All</span>
                  </Button>
                  {username && skript.pages.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handlePreview}
                      title="Preview skript"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                  <PublishToggle
                    type="skript"
                    itemId={skript.id}
                    isPublished={skript.isPublished}
                    isUnlisted={skript.isUnlisted}
                    onToggle={() => {}} // No-op - PublishToggle manages its own state
                    showText={true}
                  />
                  <EditModal
                    type="skript"
                    item={skript}
                    onItemUpdated={onSkriptUpdated}
                  />
                  <CreatePageModal
                    skriptId={skript.id}
                    onPageCreated={onSkriptUpdated}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteSkript}
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                    title="Delete skript"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
              {isViewOnly && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Eye className="w-4 h-4" />
                  <span>View only</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Pages list */}
          {skript.pages.length > 0 && (
            <div className="border-t bg-muted/50">
              <div className="p-4 space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Pages</h4>
                <SortablePages
                  pages={skript.pages}
                  skriptId={skript.id}
                  skriptSlug={skript.slug}
                  onReorder={onSkriptUpdated}
                  onPageDeleted={onSkriptUpdated}
                  canEdit={canEditSkript}
                />
              </div>
            </div>
          )}
          <AlertDialogModal
            open={alert.open}
            onOpenChange={alert.setOpen}
            type={alert.type}
            title={alert.title}
            message={alert.message}
          />
        </div>
      )}
    </Draggable>
  )
}

function StaticSkriptItem({
  skript,
  index,
  onSkriptUpdated,
  onSkriptDeleted,
  canEdit = true,
  currentUserId,
  username
}: SortableSkriptItemProps & { currentUserId?: string }) {
  // Check if current user can edit this specific skript
  const canEditSkript = canEdit && (!skript.authors || skript.authors.length === 0 ||
    skript.authors.some(a => a.userId === currentUserId && a.permission === 'author'))
  const isViewOnly = !canEditSkript
  const alert = useAlertDialog()
  const { buildViewUrl } = usePublicUrl(username)
  const [isPublishingAll, setIsPublishingAll] = useState(false)

  const handlePublishAll = async () => {
    setIsPublishingAll(true)
    try {
      const response = await fetch(`/api/skripts/${skript.id}/publish-all`, {
        method: 'POST'
      })

      if (response.ok) {
        const result = await response.json()
        alert.showSuccess(`Published skript and ${result.pagesPublished} pages`)
        onSkriptUpdated()
      } else {
        alert.showError('Failed to publish')
      }
    } catch {
      alert.showError('Failed to publish')
    } finally {
      setIsPublishingAll(false)
    }
  }

  const handlePreview = () => {
    if (username && skript.pages.length > 0) {
      const firstPage = skript.pages.sort((a, b) => a.order - b.order)[0]
      const isFullyPublished = skript.isPublished && firstPage.isPublished
      window.open(buildViewUrl(skript.slug, firstPage.slug, isFullyPublished), '_blank')
    }
  }

  const handleDeleteSkript = async () => {
    if (!confirm(`Are you sure you want to delete the skript "${skript.title}"? This will also delete all pages in this skript.`)) {
      return
    }

    try {
      const response = await fetch(`/api/skripts/${skript.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onSkriptDeleted()
      } else {
        alert.showError('Failed to delete skript')
      }
    } catch {
      alert.showError('Failed to delete skript')
    }
  }

  return (
    <div className={`border rounded-lg transition-all ${isViewOnly ? 'bg-muted/50 opacity-75' : 'bg-card hover:bg-muted/50'}`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            {canEdit && <GripVertical className="w-4 h-4" />}
            <div className={`w-8 h-8 ${isViewOnly ? 'bg-muted' : 'bg-primary/10 text-primary'} rounded-full flex items-center justify-center font-medium relative`}>
              {index + 1}
              {isViewOnly && (
                <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
              {!isViewOnly && canEdit && (
                <Edit className="w-3 h-3 text-primary absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
            </div>
          </div>
          <div>
            <Link href={`/dashboard/skripts/${skript.slug}`} className="inline-flex items-center gap-1.5 hover:underline w-fit">
              <h3 className={`font-medium ${isViewOnly ? 'text-muted-foreground' : 'text-foreground'} transition-colors`}>
                {skript.title}
              </h3>
              {!isViewOnly && <Edit className="w-3 h-3 flex-shrink-0" />}
            </Link>
            <p className="text-sm text-muted-foreground">
              {skript.description || 'No description'}
            </p>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{skript.pages.length} pages</span>
              <span>
                Updated {new Date(skript.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {canEditSkript && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePublishAll}
                disabled={isPublishingAll}
                className="text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                title="Publish skript and all pages"
              >
                {isPublishingAll ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Globe className="w-4 h-4" />
                )}
                <span className="ml-1.5">Publish All</span>
              </Button>
              {username && skript.pages.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePreview}
                  title="Preview skript"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
              <PublishToggle
                type="skript"
                itemId={skript.id}
                isPublished={skript.isPublished}
                isUnlisted={skript.isUnlisted}
                onToggle={() => {}} // No-op - PublishToggle manages its own state
                showText={true}
              />
              <EditModal
                type="skript"
                item={skript}
                onItemUpdated={onSkriptUpdated}
              />
              <CreatePageModal
                skriptId={skript.id}
                onPageCreated={onSkriptUpdated}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteSkript}
                className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                title="Delete skript"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
          {isViewOnly && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Eye className="w-4 h-4" />
              <span>View only</span>
            </div>
          )}
        </div>
      </div>

      {/* Pages list */}
      {skript.pages.length > 0 && (
        <div className="border-t bg-muted/50">
          <div className="p-4 space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Pages</h4>
            <SortablePages
              pages={skript.pages}
              skriptId={skript.id}
              skriptSlug={skript.slug}
              onReorder={onSkriptUpdated}
              onPageDeleted={onSkriptUpdated}
              canEdit={canEditSkript}
            />
          </div>
        </div>
      )}
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </div>
  )
}

interface SortableSkriptsProps {
  skripts: Skript[]
  collectionId: string
  onReorder: () => void
  onSkriptUpdated?: () => void
  onSkriptDeleted?: () => void
  canEdit?: boolean
  currentUserId?: string
  username?: string
}

export function SortableSkripts({
  skripts,
  collectionId,
  onReorder,
  onSkriptUpdated,
  onSkriptDeleted,
  canEdit = true,
  currentUserId,
  username
}: SortableSkriptsProps) {
  const [items, setItems] = useState(skripts)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const alert = useAlertDialog()
  
  // Sync items with skripts prop and handle hydration
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(skripts)
    setIsMounted(true)
  }, [skripts])

  const handleDragEnd = async (result: DropResult) => {
    if (!isMounted) return

    const { destination, source } = result
    if (!destination || destination.index === source.index) return

    const newItems = Array.from(items)
    const [reorderedItem] = newItems.splice(source.index, 1)
    newItems.splice(destination.index, 0, reorderedItem)
    setItems(newItems)

    const skriptIds = newItems.map(item => item.id)

    // Update order in database
    setIsReordering(true)
    try {
      const response = await fetch(`/api/collections/${collectionId}/reorder-skripts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skriptIds })
      })

      if (response.ok) {
        onReorder()
      } else {
        // Revert on error
        setItems(skripts)
        alert.showError('Failed to reorder skripts')
      }
    } catch {
      setItems(skripts)
      alert.showError('Failed to reorder skripts')
    }
    setIsReordering(false)
  }

  return (
    <div className="space-y-4">
      {isMounted && canEdit && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="skripts">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-4"
              >
                {items.map((skript, index) => (
                  <SortableSkriptItem
                    key={skript.id}
                    skript={skript}
                    index={index}
                    onSkriptUpdated={onSkriptUpdated || onReorder}
                    onSkriptDeleted={onSkriptDeleted || onReorder}
                    canEdit={canEdit}
                    currentUserId={currentUserId}
                    username={username}
                  />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
      {isMounted && !canEdit && (
        <div className="space-y-4">
          {items.map((skript, index) => (
            <StaticSkriptItem
              key={skript.id}
              skript={skript}
              index={index}
              onSkriptUpdated={onSkriptUpdated || onReorder}
              onSkriptDeleted={onSkriptDeleted || onReorder}
              canEdit={canEdit}
              currentUserId={currentUserId}
              username={username}
            />
          ))}
        </div>
      )}
      {!isMounted && (
        <div>
          {items.map((skript, index) => (
            <StaticSkriptItem
              key={skript.id}
              skript={skript}
              index={index}
              onSkriptUpdated={onSkriptUpdated || onReorder}
              onSkriptDeleted={onSkriptDeleted || onReorder}
              canEdit={canEdit}
              currentUserId={currentUserId}
              username={username}
            />
          ))}
        </div>
      )}
      {isReordering && (
        <div className="text-sm text-muted-foreground text-center py-2">
          Updating skript order...
        </div>
      )}
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </div>
  )
}