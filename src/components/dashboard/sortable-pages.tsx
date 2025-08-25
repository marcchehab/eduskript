'use client'

import React, { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Button } from '@/components/ui/button'
import { EditModal } from './edit-modal'
import { PublishToggle } from './publish-toggle'
import { GripVertical, Trash2 } from 'lucide-react'
import Link from 'next/link'

interface Page {
  id: string
  title: string
  slug: string
  isPublished: boolean
  updatedAt: Date
  order: number
}

interface SortablePageItemProps {
  page: Page
  index: number
  collectionSlug: string
  skriptSlug: string
  onPageUpdated?: () => void
  canEdit?: boolean
}

function SortablePageItem({ page, index, collectionSlug, skriptSlug, onPageUpdated, canEdit = true }: SortablePageItemProps) {
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
        alert('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert('Failed to delete page')
    }
  }

  return (
    <Draggable draggableId={page.id} index={index}>
      {(provided, snapshot) => (
        <div 
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="flex items-center justify-between p-3 border rounded-md bg-background"
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
              <Link href={`/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}/pages/${page.slug}`}>
                <h4 className="text-sm font-medium hover:text-primary cursor-pointer transition-colors">
                  {page.title}
                </h4>
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
                  onToggle={onPageUpdated}
                  showText={false}
                />
                <EditModal
                  type="page"
                  item={page}
                  onItemUpdated={onPageUpdated}
                />
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleDeletePage}
                  className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-8 w-8 p-0"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Draggable>
  )
}

function StaticPageItem({ page, index, collectionSlug, skriptSlug, onPageUpdated, canEdit = true }: SortablePageItemProps) {
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
        alert('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert('Failed to delete page')
    }
  }

  return (
    <div className="flex items-center justify-between p-3 border rounded-md bg-background">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          {canEdit && <GripVertical className="w-4 h-4" />}
          <span className="text-xs font-mono w-6 text-center">
            {index + 1}
          </span>
        </div>
        <div>
          <Link href={`/dashboard/collections/${collectionSlug}/skripts/${skriptSlug}/pages/${page.slug}`}>
            <h4 className="text-sm font-medium hover:text-primary cursor-pointer transition-colors">
              {page.title}
            </h4>
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
              onToggle={onPageUpdated}
              showText={false}
            />
            <EditModal
              type="page"
              item={page}
              onItemUpdated={onPageUpdated}
            />
            <Button 
              variant="ghost" 
              size="sm"
              onClick={handleDeletePage}
              className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 h-8 w-8 p-0"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

interface SortablePagesProps {
  pages: Page[]
  skriptId: string
  collectionSlug: string
  skriptSlug: string
  onReorder: () => void
  onPageDeleted?: () => void
  canEdit?: boolean
}

export function SortablePages({ 
  pages, 
  skriptId, 
  collectionSlug, 
  skriptSlug, 
  onReorder,
  onPageDeleted,
  canEdit = true
}: SortablePagesProps) {
  const [items, setItems] = useState(pages)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  
  // Sync items with pages prop and handle hydration
  useEffect(() => {
    console.log('SortablePages received pages:', pages.map(p => ({ id: p.id, title: p.title, order: p.order })))
    setItems(pages)
    setIsMounted(true)
  }, [pages])

  const handleDragEnd = async (result: DropResult) => {
    if (!isMounted) return
    
    const { destination, source } = result
    console.log('Page drag end event:', { sourceIndex: source.index, destIndex: destination?.index })

    if (!destination || destination.index === source.index) return

    const newItems = Array.from(items)
    const [reorderedItem] = newItems.splice(source.index, 1)
    newItems.splice(destination.index, 0, reorderedItem)
    
    console.log('Reordering pages:', { oldIndex: source.index, newIndex: destination.index })
    setItems(newItems)
    
    const pageIds = newItems.map(item => item.id)
    console.log('Sending page reorder request:', { skriptId, pageIds })
    
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

      console.log('Page reorder response:', response.status, response.ok)
      
      if (response.ok) {
        const data = await response.json()
        console.log('Page reorder successful:', data)
        onReorder()
      } else {
        const errorData = await response.text()
        console.error('Page reorder failed:', response.status, errorData)
        // Revert on error
        setItems(pages)
        alert('Failed to reorder pages: ' + errorData)
      }
    } catch (error) {
      console.error('Error reordering pages:', error)
      setItems(pages)
      alert('Failed to reorder pages')
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
                    collectionSlug={collectionSlug}
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
              collectionSlug={collectionSlug}
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
              collectionSlug={collectionSlug}
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
    </div>
  )
}