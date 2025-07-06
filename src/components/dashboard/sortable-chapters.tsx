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

interface Chapter {
  id: string
  title: string
  slug: string
  description: string | null
  order: number
  updatedAt: string
  isPublished: boolean
  pages: any[]
}

interface SortableChapterItemProps {
  chapter: Chapter
  index: number
  scriptSlug: string
  onChapterUpdated: () => void
  onChapterDeleted: () => void
}

function SortableChapterItem({ 
  chapter, 
  index, 
  scriptSlug, 
  onChapterUpdated,
  onChapterDeleted 
}: SortableChapterItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleDeleteChapter = async () => {
    if (!confirm(`Are you sure you want to delete the chapter "${chapter.title}"? This will also delete all pages in this chapter.`)) {
      return
    }

    try {
      const response = await fetch(`/api/chapters/${chapter.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onChapterDeleted()
      } else {
        alert('Failed to delete chapter')
      }
    } catch (error) {
      console.error('Error deleting chapter:', error)
      alert('Failed to delete chapter')
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
            <Link href={`/dashboard/scripts/${scriptSlug}/chapters/${chapter.slug}`}>
              <h3 className="font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                {chapter.title}
              </h3>
            </Link>
            <p className="text-sm text-muted-foreground">
              {chapter.description || 'No description'}
            </p>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{chapter.pages.length} pages</span>
              <span>
                Updated {new Date(chapter.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <PublishToggle
            type="chapter"
            itemId={chapter.id}
            isPublished={chapter.isPublished}
            onToggle={onChapterUpdated}
            showText={true}
          />
          <EditModal
            type="chapter"
            item={chapter}
            onItemUpdated={onChapterUpdated}
          />
          <CreatePageModal 
            chapterId={chapter.id} 
            onPageCreated={onChapterUpdated}
          />
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleDeleteChapter}
            className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Pages list */}
      {chapter.pages.length > 0 && (
        <div className="border-t bg-muted/50">
          <div className="p-4 space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Pages</h4>
            <SortablePages
              pages={chapter.pages}
              chapterId={chapter.id}
              scriptSlug={scriptSlug}
              chapterSlug={chapter.slug}
              onReorder={onChapterUpdated}
              onPageDeleted={onChapterUpdated}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StaticChapterItem({ 
  chapter, 
  index, 
  scriptSlug, 
  onChapterUpdated,
  onChapterDeleted 
}: SortableChapterItemProps) {
  const handleDeleteChapter = async () => {
    if (!confirm(`Are you sure you want to delete the chapter "${chapter.title}"? This will also delete all pages in this chapter.`)) {
      return
    }

    try {
      const response = await fetch(`/api/chapters/${chapter.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        onChapterDeleted()
      } else {
        alert('Failed to delete chapter')
      }
    } catch (error) {
      console.error('Error deleting chapter:', error)
      alert('Failed to delete chapter')
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
            <Link href={`/dashboard/scripts/${scriptSlug}/chapters/${chapter.slug}`}>
              <h3 className="font-medium text-foreground hover:text-primary cursor-pointer transition-colors">
                {chapter.title}
              </h3>
            </Link>
            <p className="text-sm text-muted-foreground">
              {chapter.description || 'No description'}
            </p>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{chapter.pages.length} pages</span>
              <span>
                Updated {new Date(chapter.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <PublishToggle
            type="chapter"
            itemId={chapter.id}
            isPublished={chapter.isPublished}
            onToggle={onChapterUpdated}
            showText={true}
          />
          <EditModal
            type="chapter"
            item={chapter}
            onItemUpdated={onChapterUpdated}
          />
          <CreatePageModal 
            chapterId={chapter.id} 
            onPageCreated={onChapterUpdated}
          />
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleDeleteChapter}
            className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      {/* Pages list */}
      {chapter.pages.length > 0 && (
        <div className="border-t bg-muted/50">
          <div className="p-4 space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Pages</h4>
            <SortablePages
              pages={chapter.pages}
              chapterId={chapter.id}
              scriptSlug={scriptSlug}
              chapterSlug={chapter.slug}
              onReorder={onChapterUpdated}
              onPageDeleted={onChapterUpdated}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface SortableChaptersProps {
  chapters: Chapter[]
  scriptId: string
  scriptSlug: string
  onReorder: () => void
}

export function SortableChapters({ 
  chapters, 
  scriptId, 
  scriptSlug, 
  onReorder 
}: SortableChaptersProps) {
  const [items, setItems] = useState(chapters)
  const [isReordering, setIsReordering] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  
  // Sync items with chapters prop and handle hydration
  useEffect(() => {
    setItems(chapters)
    setIsMounted(true)
  }, [chapters])
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
        const response = await fetch(`/api/scripts/${scriptId}/reorder-chapters`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapterIds: newItems.map(item => item.id)
          })
        })

        if (response.ok) {
          onReorder()
        } else {
          // Revert on error
          setItems(chapters)
          alert('Failed to reorder chapters')
        }
      } catch (error) {
        console.error('Error reordering chapters:', error)
        setItems(chapters)
        alert('Failed to reorder chapters')
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
            {items.map((chapter, index) => (
              <SortableChapterItem
                key={chapter.id}
                chapter={chapter}
                index={index}
                scriptSlug={scriptSlug}
                onChapterUpdated={onReorder}
                onChapterDeleted={onReorder}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {!isMounted && (
        <div>
          {items.map((chapter, index) => (
            <StaticChapterItem
              key={chapter.id}
              chapter={chapter}
              index={index}
              scriptSlug={scriptSlug}
              onChapterUpdated={onReorder}
              onChapterDeleted={onReorder}
            />
          ))}
        </div>
      )}
      {isReordering && (
        <div className="text-sm text-muted-foreground text-center py-2">
          Updating chapter order...
        </div>
      )}
    </div>
  )
}
