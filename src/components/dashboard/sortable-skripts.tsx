'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
}

function SortableSkriptItem({ 
  skript, 
  index, 
  collectionSlug, 
  onSkriptUpdated,
  onSkriptDeleted 
}: SortableSkriptItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: skript.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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
        alert('Failed to delete skript')
      }
    } catch (error) {
      console.error('Error deleting skript:', error)
      alert('Failed to delete skript')
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="border rounded-lg bg-card">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div
            {...attributes}
            {...listeners}
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
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StaticSkriptItem({ 
  skript, 
  index, 
  collectionSlug, 
  onSkriptUpdated,
  onSkriptDeleted 
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
            <GripVertical className="w-4 h-4" />
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
}

export function SortableSkripts({ 
  skripts, 
  collectionId, 
  collectionSlug, 
  onReorder 
}: SortableSkriptsProps) {
  const [items, setItems] = useState(skripts)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  
  // Sync items with skripts prop and handle hydration
  useEffect(() => {
    setItems(skripts)
    setIsMounted(true)
  }, [skripts])
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!isMounted) return
    
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id)
      const newIndex = items.findIndex((item) => item.id === over.id)
      
      const newItems = arrayMove(items, oldIndex, newIndex)
      setItems(newItems)
      
      // Update order in database
      setIsReordering(true)
      try {
        const response = await fetch(`/api/collections/${collectionId}/reorder-skripts`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skriptIds: newItems.map(item => item.id)
          })
        })

        if (response.ok) {
          onReorder()
        } else {
          // Revert on error
          setItems(skripts)
          alert('Failed to reorder skripts')
        }
      } catch (error) {
        console.error('Error reordering skripts:', error)
        setItems(skripts)
        alert('Failed to reorder skripts')
      }
      setIsReordering(false)
    }
  }

  return (
    <div className="space-y-4">
      {isMounted && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {items.map((skript, index) => (
              <SortableSkriptItem
                key={skript.id}
                skript={skript}
                index={index}
                collectionSlug={collectionSlug}
                onSkriptUpdated={onReorder}
                onSkriptDeleted={onReorder}
              />
            ))}
          </SortableContext>
        </DndContext>
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
