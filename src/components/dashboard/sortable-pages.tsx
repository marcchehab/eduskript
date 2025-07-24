'use client'

import React, { useState, useEffect } from 'react'
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
  scriptSlug: string
  chapterSlug: string
  onPageUpdated?: () => void
}

function SortablePageItem({ page, index, scriptSlug, chapterSlug, onPageUpdated }: SortablePageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: page.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleDeletePage = async () => {
    if (!confirm(`Are you sure you want to delete the page "${page.title}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'DELETE'
      })

      if (response.ok && onPageUpdated) {
        onPageUpdated()
      } else {
        alert('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert('Failed to delete page')
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center justify-between p-3 bg-card border rounded-md">
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center gap-2 text-muted-foreground cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
          <div className="w-6 h-6 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
            {index + 1}
          </div>
        </div>
        <div>
          <Link href={`/dashboard/topics/${scriptSlug}/chapters/${chapterSlug}/pages/${page.slug}/edit`}>
            <h4 className="font-medium text-foreground text-sm hover:text-primary cursor-pointer transition-colors">
              {page.title}
            </h4>
          </Link>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>
              Updated {new Date(page.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <PublishToggle
          type="page"
          itemId={page.id}
          isPublished={page.isPublished}
          onToggle={onPageUpdated || (() => {})}
          showText={false}
          size="sm"
        />
        <EditModal
          type="page"
          item={page}
          onItemUpdated={onPageUpdated || (() => {})}
        />
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/topics/${scriptSlug}/chapters/${chapterSlug}/pages/${page.slug}/edit`}>
            Edit Content
          </Link>
        </Button>
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleDeletePage}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

function StaticPageItem({ page, index, scriptSlug, chapterSlug, onPageUpdated }: SortablePageItemProps) {
  const handleDeletePage = async () => {
    if (!confirm(`Are you sure you want to delete the page "${page.title}"?`)) {
      return
    }

    try {
      const response = await fetch(`/api/pages/${page.id}`, {
        method: 'DELETE'
      })

      if (response.ok && onPageUpdated) {
        onPageUpdated()
      } else {
        alert('Failed to delete page')
      }
    } catch (error) {
      console.error('Error deleting page:', error)
      alert('Failed to delete page')
    }
  }

  return (
    <div className="flex items-center justify-between p-3 bg-card border rounded-md">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <GripVertical className="w-4 h-4" />
          <div className="w-6 h-6 bg-muted rounded flex items-center justify-center text-xs text-muted-foreground">
            {index + 1}
          </div>
        </div>
        <div>
          <Link href={`/dashboard/topics/${scriptSlug}/chapters/${chapterSlug}/pages/${page.slug}/edit`}>
            <h4 className="font-medium text-foreground text-sm hover:text-primary cursor-pointer transition-colors">
              {page.title}
            </h4>
          </Link>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>
              Updated {new Date(page.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <PublishToggle
          type="page"
          itemId={page.id}
          isPublished={page.isPublished}
          onToggle={onPageUpdated || (() => {})}
          showText={false}
          size="sm"
        />
        <EditModal
          type="page"
          item={page}
          onItemUpdated={onPageUpdated || (() => {})}
        />
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/topics/${scriptSlug}/chapters/${chapterSlug}/pages/${page.slug}/edit`}>
            Edit Content
          </Link>
        </Button>
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleDeletePage}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}

interface SortablePagesProps {
  pages: Page[]
  chapterId: string
  scriptSlug: string
  chapterSlug: string
  onReorder: () => void
  onPageDeleted?: () => void
}

export function SortablePages({ 
  pages, 
  chapterId, 
  scriptSlug, 
  chapterSlug, 
  onReorder,
  onPageDeleted 
}: SortablePagesProps) {
  const [items, setItems] = useState(pages)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  
  // Sync items with pages prop and handle hydration
  useEffect(() => {
    setItems(pages)
    setIsMounted(true)
  }, [pages])
  
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
        const response = await fetch(`/api/chapters/${chapterId}/reorder-pages`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageIds: newItems.map(item => item.id)
          })
        })

        if (response.ok) {
          onReorder()
        } else {
          // Revert on error
          setItems(pages)
          alert('Failed to reorder pages')
        }
      } catch (error) {
        console.error('Error reordering pages:', error)
        setItems(pages)
        alert('Failed to reorder pages')
      }
      setIsReordering(false)
    }
  }

  return (
    <div className="space-y-2">
      {isMounted && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map(p => p.id)} strategy={verticalListSortingStrategy}>
            {items.map((page, index) => (
              <SortablePageItem
                key={page.id}
                page={page}
                index={index}
                scriptSlug={scriptSlug}
                chapterSlug={chapterSlug}
                onPageUpdated={onPageDeleted}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {!isMounted && (
        <div>
          {items.map((page, index) => (
            <StaticPageItem
              key={page.id}
              page={page}
              index={index}
              scriptSlug={scriptSlug}
              chapterSlug={chapterSlug}
              onPageUpdated={onPageDeleted}
            />
          ))}
        </div>
      )}
      {isReordering && (
        <div className="text-sm text-muted-foreground text-center py-2">
          Updating page order...
        </div>
      )}
    </div>
  )
}
