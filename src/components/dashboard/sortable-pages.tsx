'use client'

import React, { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Button } from '@/components/ui/button'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { EditModal } from './edit-modal'
import { PublishToggle } from './publish-toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { GripVertical, Trash2, Edit } from 'lucide-react'
import Link from 'next/link'

interface Page {
  id: string
  title: string
  slug: string
  isPublished: boolean
  isUnlisted?: boolean
  updatedAt: Date
  order: number
}

interface SortablePageItemProps {
  page: Page
  index: number
  skriptSlug: string
  onPageUpdated?: () => void
  canEdit?: boolean
}

function SortablePageItem({ page, index, skriptSlug, onPageUpdated, canEdit = true }: SortablePageItemProps) {
  const alert = useAlertDialog()

  const handleDeletePage = async () => {
    if (!confirm(`Are you sure you want to delete the page "${page.title}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onPageUpdated?.()
      } else {
        alert.showError('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert.showError('Failed to delete page')
    }
  }

  return (
    <Draggable draggableId={page.id} index={index}>
      {(provided, snapshot) => (
        <div 
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="flex items-center justify-between p-3 border rounded-md bg-background hover:bg-muted/50 transition-all"
          style={{
            ...provided.draggableProps.style,
            opacity: snapshot.isDragging ? 0.5 : 1,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              {...provided.dragHandleProps}
              className="flex items-center gap-2 text-muted-foreground cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="w-4 h-4" />
              <span className="text-xs font-mono w-6 text-center">
                {index + 1}
              </span>
            </div>
            <div>
              <Link href={`/dashboard/skripts/${skriptSlug}/pages/${page.slug}/edit`} className="inline-flex items-center gap-1 hover:underline w-fit">
                <h4 className="text-sm font-medium transition-colors">
                  {page.title}
                </h4>
                {canEdit && <Edit className="w-2.5 h-2.5 flex-shrink-0" />}
              </Link>
              <p className="text-xs text-muted-foreground">
                Updated {new Date(page.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && (
              <>
                <PublishToggle
                  type="page"
                  itemId={page.id}
                  isPublished={page.isPublished}
                  isUnlisted={page.isUnlisted}
                  onToggle={() => {}} // No-op - PublishToggle manages its own state
                  showText={false}
                />
                <EditModal
                  type="page"
                  item={page}
                  onItemUpdated={onPageUpdated || (() => {})}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDeletePage}
                        className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-8 w-8 p-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Delete page</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
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

function StaticPageItem({ page, index, skriptSlug, onPageUpdated, canEdit = true }: SortablePageItemProps) {
  const alert = useAlertDialog()

  const handleDeletePage = async () => {
    if (!confirm(`Are you sure you want to delete the page "${page.title}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onPageUpdated?.()
      } else {
        alert.showError('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert.showError('Failed to delete page')
    }
  }

  return (
    <div className="flex items-center justify-between p-3 border rounded-md bg-background hover:bg-muted/50 transition-all">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          {canEdit && <GripVertical className="w-4 h-4" />}
          <span className="text-xs font-mono w-6 text-center">
            {index + 1}
          </span>
        </div>
        <div>
          <Link href={`/dashboard/skripts/${skriptSlug}/pages/${page.slug}/edit`} className="inline-flex items-center gap-1 hover:underline w-fit">
            <h4 className="text-sm font-medium transition-colors">
              {page.title}
            </h4>
            {canEdit && <Edit className="w-2.5 h-2.5 flex-shrink-0" />}
          </Link>
          <p className="text-xs text-muted-foreground">
            Updated {new Date(page.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {canEdit && (
          <>
            <PublishToggle
              type="page"
              itemId={page.id}
              isPublished={page.isPublished}
              isUnlisted={page.isUnlisted}
              onToggle={() => {}} // No-op - PublishToggle manages its own state
              showText={false}
            />
            <EditModal
              type="page"
              item={page}
              onItemUpdated={onPageUpdated || (() => {})}
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeletePage}
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-8 w-8 p-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete page</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </>
        )}
      </div>
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

interface SortablePagesProps {
  pages: Page[]
  skriptId: string
  skriptSlug: string
  onReorder: () => void
  onPageDeleted?: () => void
  canEdit?: boolean
}

export function SortablePages({
  pages,
  skriptId,
  skriptSlug,
  onReorder,
  onPageDeleted,
  canEdit = true
}: SortablePagesProps) {
  const [items, setItems] = useState(pages)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const alert = useAlertDialog()
  
  // Sync items with pages prop and handle hydration
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(pages)
     
    setIsMounted(true)
  }, [pages])

  const handleDragEnd = async (result: DropResult) => {
    if (!isMounted) return

    const { destination, source } = result

    if (!destination || destination.index === source.index) return

    const newItems = Array.from(items)
    const [reorderedItem] = newItems.splice(source.index, 1)
    newItems.splice(destination.index, 0, reorderedItem)

    setItems(newItems)

    const pageIds = newItems.map(item => item.id)

    // Update order in database
    setIsReordering(true)
    try {
      const response = await fetch(`/api/skripts/${skriptId}/reorder-pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageIds: pageIds
        })
      })

      if (response.ok) {
        await response.json()
        onReorder()
      } else {
        const errorData = await response.text()
        console.error('Page reorder failed:', response.status, errorData)
        // Revert on error
        setItems(pages)
        alert.showError('Failed to reorder pages: ' + errorData)
      }
    } catch (error) {
      console.error('Error reordering pages:', error)
      setItems(pages)
      alert.showError('Failed to reorder pages')
    }
    setIsReordering(false)
  }

  const handlePageUpdated = () => {
    onReorder() // This will refresh the data
    onPageDeleted?.() // Call both callbacks
  }

  return (
    <div className="space-y-2">
      {isMounted && canEdit && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="pages">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-2"
              >
                {items.map((page, index) => (
                  <SortablePageItem
                    key={page.id}
                    page={page}
                    index={index}
                    skriptSlug={skriptSlug}
                    onPageUpdated={handlePageUpdated}
                    canEdit={canEdit}
                  />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
      {isMounted && !canEdit && (
        <div className="space-y-2">
          {items.map((page, index) => (
            <StaticPageItem
              key={page.id}
              page={page}
              index={index}
              skriptSlug={skriptSlug}
              onPageUpdated={handlePageUpdated}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
      {!isMounted && (
        <div className="space-y-2">
          {items.map((page, index) => (
            <StaticPageItem
              key={page.id}
              page={page}
              index={index}
              skriptSlug={skriptSlug}
              onPageUpdated={handlePageUpdated}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
      {isReordering && (
        <div className="text-xs text-muted-foreground text-center py-1">
          Updating page order...
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