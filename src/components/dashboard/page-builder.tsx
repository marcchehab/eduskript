'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Layout, Trash2, Eye, BookOpen, FileText, Plus, Edit, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface PageItem {
  id: string
  type: 'collection' | 'skript'
  title: string
  description?: string
  order: number
  slug?: string
  collectionSlug?: string // For skripts
  parentId?: string // For nested skripts under collections
  skripts?: PageItem[] // For collections containing skripts
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
}

interface PageBuilderProps {
  items: PageItem[]
  onItemsChange?: (items: PageItem[]) => void
  onPreview?: () => void
}

export function PageBuilder({ 
  items, 
  onItemsChange,
  onPreview 
}: PageBuilderProps) {

  const { isOver, setNodeRef } = useDroppable({
    id: 'page-builder'
  })

  const handleRemoveItem = (id: string, parentId?: string) => {
    if (parentId) {
      // Remove skript from collection
      const updatedItems = items.map(item => {
        if (item.id === parentId && item.skripts) {
          return {
            ...item,
            skripts: item.skripts
              .filter(skript => skript.id !== id)
              .map((skript, index) => ({ ...skript, order: index }))
          }
        }
        return item
      })
      onItemsChange?.(updatedItems)
    } else {
      // Remove root level item
      const updatedItems = items
        .filter(item => item.id !== id)
        .map((item, index) => ({ ...item, order: index }))
      onItemsChange?.(updatedItems)
    }
  }


  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Layout className="w-5 h-5" />
            Your Personal Page
          </CardTitle>
          <div className="flex gap-2">
            <Link href="/dashboard/collections/new">
              <Button 
                variant="outline" 
                size="sm"
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Collection
              </Button>
            </Link>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onPreview}
              className="flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              Preview
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Drag content from the library to build your public page
        </p>
      </CardHeader>
      <CardContent>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[400px] border-2 border-dashed rounded-lg p-4 transition-colors",
            isOver ? "border-primary bg-primary/5" : "border-muted-foreground/25",
            items.length === 0 && "flex items-center justify-center"
          )}
        >
          {items.length === 0 ? (
            <div className="text-center">
              <Layout className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground mb-2">
                Start building your page
              </h3>
              <p className="text-sm text-muted-foreground">
                Drag collections and skripts from the content library to organize your public page
              </p>
            </div>
          ) : (
            <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {items
                  .sort((a, b) => a.order - b.order)
                  .map((item, index) => (
                    <SortablePageBuilderItem
                      key={item.id}
                      item={item}
                      index={index}
                      onRemove={handleRemoveItem}
                    />
                  ))}
              </div>
            </SortableContext>
          )}
        </div>
        
        {items.length > 0 && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">
              💡 <strong>Tip:</strong> You can reorder items by using the arrow buttons or remove items you no longer want on your page.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface SortablePageBuilderItemProps {
  item: PageItem
  index: number
  onRemove: (id: string, parentId?: string) => void
}

function SortablePageBuilderItem({ item, index, onRemove }: SortablePageBuilderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const Icon = item.type === 'collection' ? BookOpen : FileText

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card border border-border rounded-lg hover:shadow-sm transition-shadow",
        isDragging && "opacity-50"
      )}
    >
      {/* Main content row */}
      <div className="flex items-center gap-3 p-3">
        <div 
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        
        <span className="text-xs text-muted-foreground font-mono w-6">
          {index + 1}
        </span>
        
        <Icon className="w-5 h-5 text-primary flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{item.title}</h4>
          {item.description && (
            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
          )}
          <span className="text-xs text-muted-foreground capitalize">
            {item.type}
          </span>
        </div>
        
        <div className="flex gap-1 flex-shrink-0">
          {item.permissions?.canEdit && item.slug && (
            <Link href={
              item.type === 'collection' 
                ? `/dashboard/collections/${item.slug}`
                : item.collectionSlug 
                  ? `/dashboard/collections/${item.collectionSlug}/skripts/${item.slug}`
                  : `/dashboard/collections/${item.id}` // fallback
            }>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-8 w-8 p-0 text-primary hover:text-primary"
                title={`Edit ${item.type}`}
              >
                <Edit className="w-4 h-4" />
              </Button>
            </Link>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onRemove(item.id)}
            className="text-destructive hover:text-destructive h-8 w-8 p-0"
            title="Remove from page"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Nested skripts for collections */}
      {item.type === 'collection' && item.skripts && item.skripts.length > 0 && (
        <div className="px-3 pb-3">
          <div className="ml-6 space-y-2 border-l-2 border-muted pl-4">
            {item.skripts
              .sort((a, b) => a.order - b.order)
              .map((skript) => (
                <NestedSkriptItem
                  key={skript.id}
                  item={skript}
                  parentId={item.id}
                  onRemove={onRemove}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface NestedSkriptItemProps {
  item: PageItem
  parentId: string
  onRemove: (id: string, parentId?: string) => void
}

function NestedSkriptItem({ item, parentId, onRemove }: NestedSkriptItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `${parentId}-${item.id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-muted/30 border border-border rounded-lg hover:shadow-sm transition-shadow",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-center gap-3 p-2">
        <div 
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
          title="Drag to reorder"
        >
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
        
        <FileText className="w-4 h-4 text-primary flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <h5 className="font-medium text-xs truncate">{item.title}</h5>
          {item.description && (
            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
          )}
        </div>
        
        <div className="flex gap-1 flex-shrink-0">
          {item.permissions?.canEdit && item.slug && (
            <Link href={
              item.collectionSlug 
                ? `/dashboard/collections/${item.collectionSlug}/skripts/${item.slug}`
                : `/dashboard/collections/${item.id}` // fallback
            }>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 w-6 p-0 text-primary hover:text-primary"
                title="Edit skript"
              >
                <Edit className="w-3 h-3" />
              </Button>
            </Link>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onRemove(item.id, parentId)}
            className="text-destructive hover:text-destructive h-6 w-6 p-0"
            title="Remove from collection"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}