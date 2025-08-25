'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Button } from '@/components/ui/button'
import { EditModal } from './edit-modal'
import { PublishToggle } from './publish-toggle'
import { CreatePageModal } from './create-page-modal'
import { SortablePages } from './sortable-pages'
import { GripVertical, Trash2 } from 'lucide-react'

interface Skript {
  id: string
  title: string
  slug: string
  description: string | null
  order: number
  updatedAt: Date
  isPublished: boolean
  pages: Array<{
    id: string
    title: string
    slug: string
    order: number
    isPublished: boolean
    updatedAt: Date
  }>
}

interface SortableSkriptItemProps {
  skript: Skript
  index: number
  collectionSlug: string
  onSkriptUpdated: () => void
  onSkriptDeleted: () => void
  canEdit?: boolean
}

function SortableSkriptItem({ 
  skript, 
  index, 
  collectionSlug, 
  onSkriptUpdated,
  onSkriptDeleted,
  canEdit = true
}: SortableSkriptItemProps) {
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
        alert('Failed to delete skript')
      }
    } catch (error) {
      console.error('Error deleting skript:', error)
      alert('Failed to delete skript')
    }
  }

  return (
    <Draggable draggableId={skript.id} index={index}>
      {(provided, snapshot) => (
        <div 
          ref={provided.innerRef} 
          {...provided.draggableProps}
          className="border rounded-lg bg-card"
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
                <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center font-medium">
                  {index + 1}
                </div>
              </div>
              <div>
                <Link href={`/dashboard/collections/${collectionSlug}/skripts/${skript.slug}`}>
                  <h3 className="font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                    {skript.title}
                  </h3>
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
              {canEdit && (
                <>
                  <PublishToggle
                    type="skript"
                    itemId={skript.id}
                    isPublished={skript.isPublished}
                    onToggle={onSkriptUpdated}
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
                    variant="outline" 
                    size="sm"
                    onClick={handleDeleteSkript}
                    className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
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
                  collectionSlug={collectionSlug}
                  skriptSlug={skript.slug}
                  onReorder={onSkriptUpdated}
                  onPageDeleted={onSkriptUpdated}
                  canEdit={canEdit}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}

function StaticSkriptItem({ 
  skript, 
  index, 
  collectionSlug, 
  onSkriptUpdated,
  onSkriptDeleted,
  canEdit = true
}: SortableSkriptItemProps) {
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
        alert('Failed to delete skript')
      }
    } catch (error) {
      console.error('Error deleting skript:', error)
      alert('Failed to delete skript')
    }
  }

  return (
    <div className="border rounded-lg">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            {canEdit && <GripVertical className="w-4 h-4" />}
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 font-medium">
              {index + 1}
            </div>
          </div>
          <div>
            <Link href={`/dashboard/collections/${collectionSlug}/skripts/${skript.slug}`}>
              <h3 className="font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                {skript.title}
              </h3>
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
          {canEdit && (
            <>
              <PublishToggle
                type="skript"
                itemId={skript.id}
                isPublished={skript.isPublished}
                onToggle={onSkriptUpdated}
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
                variant="outline" 
                size="sm"
                onClick={handleDeleteSkript}
                className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
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
              collectionSlug={collectionSlug}
              skriptSlug={skript.slug}
              onReorder={onSkriptUpdated}
              onPageDeleted={onSkriptUpdated}
              canEdit={canEdit}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface SortableSkriptsProps {
  skripts: Skript[]
  collectionId: string
  collectionSlug: string
  onReorder: () => void
  canEdit?: boolean
}

export function SortableSkripts({ 
  skripts, 
  collectionId, 
  collectionSlug, 
  onReorder,
  canEdit = true
}: SortableSkriptsProps) {
  const [items, setItems] = useState(skripts)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  
  // Sync items with skripts prop and handle hydration
  useEffect(() => {
    console.log('SortableSkripts received skripts:', skripts.map(s => ({ id: s.id, title: s.title, order: s.order })))
    setItems(skripts)
    setIsMounted(true)
  }, [skripts])

  const handleDragEnd = async (result: DropResult) => {
    if (!isMounted) return
    
    const { destination, source } = result
    console.log('Drag end event:', { sourceIndex: source.index, destIndex: destination?.index })

    if (!destination || destination.index === source.index) return

    const newItems = Array.from(items)
    const [reorderedItem] = newItems.splice(source.index, 1)
    newItems.splice(destination.index, 0, reorderedItem)
    
    console.log('Reordering:', { oldIndex: source.index, newIndex: destination.index })
    setItems(newItems)
    
    const skriptIds = newItems.map(item => item.id)
    console.log('Sending reorder request:', { collectionId, skriptIds })
    
    // Update order in database
    setIsReordering(true)
    try {
      const response = await fetch(`/api/collections/${collectionId}/reorder-skripts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skriptIds: skriptIds
        })
      })

      console.log('Reorder response:', response.status, response.ok)
      
      if (response.ok) {
        const data = await response.json()
        console.log('Reorder successful:', data)
        onReorder()
      } else {
        const errorData = await response.text()
        console.error('Reorder failed:', response.status, errorData)
        // Revert on error
        setItems(skripts)
        alert('Failed to reorder skripts: ' + errorData)
      }
    } catch (error) {
      console.error('Error reordering skripts:', error)
      setItems(skripts)
      alert('Failed to reorder skripts')
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
                    collectionSlug={collectionSlug}
                    onSkriptUpdated={onReorder}
                    onSkriptDeleted={onReorder}
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
        <div className="space-y-4">
          {items.map((skript, index) => (
            <StaticSkriptItem
              key={skript.id}
              skript={skript}
              index={index}
              collectionSlug={collectionSlug}
              onSkriptUpdated={onReorder}
              onSkriptDeleted={onReorder}
              canEdit={canEdit}
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
              collectionSlug={collectionSlug}
              onSkriptUpdated={onReorder}
              onSkriptDeleted={onReorder}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
      {isReordering && (
        <div className="text-sm text-muted-foreground text-center py-2">
          Updating skript order...
        </div>
      )}
    </div>
  )
}