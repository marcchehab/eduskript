'use client'

import { Droppable, Draggable } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Layout, Eye, BookOpen, FileText, Plus, Edit, ChevronDown, ChevronRight, X, GripVertical, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useState } from 'react'

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
  isInLayout?: boolean // For skripts: whether they're explicitly in the page layout
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
}

interface PageBuilderProps {
  items: PageItem[]
  onItemsChange?: (items: PageItem[], changedCollectionIds?: Set<string>) => void
  onPreview?: () => void
  expandedCollections?: string[]
  onToggleCollection?: (collectionId: string) => void
  draggedItem?: {
    type: 'collection' | 'skript'
    id: string
    title: string
    description?: string
  } | null
  onRefresh?: () => void
}

export function PageBuilder({
  items,
  onItemsChange,
  onPreview,
  expandedCollections = [],
  onToggleCollection,
  draggedItem,
  onRefresh
}: PageBuilderProps) {
  const { data: session } = useSession()
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState('')
  const [seedSuccess, setSeedSuccess] = useState('')

  const handleSeedData = async () => {
    if (!confirm('This will create example collections and content. Continue?')) {
      return
    }

    setSeeding(true)
    setSeedError('')
    setSeedSuccess('')

    try {
      const response = await fetch('/api/admin/seed-example-data', {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to seed data')
      }

      setSeedSuccess(`Example data seeded! Created ${data.data.skripts} skripts with ${data.data.pages} pages.`)

      // Trigger refresh of content library
      onRefresh?.()
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSeeding(false)
    }
  }


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
      const changedCollectionIds = new Set([parentId])
      onItemsChange?.(updatedItems, changedCollectionIds)
    } else {
      // Remove root level item
      const updatedItems = items
        .filter(item => item.id !== id)
        .map((item, index) => ({ ...item, order: index }))
      onItemsChange?.(updatedItems)
    }
  }


  return (
    <Card className="min-h-[400px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Layout className="w-5 h-5" />
            Your Personal Page
          </CardTitle>
          <div className="flex gap-2">
            <Link href="/dashboard/frontpage">
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                Edit Main Frontpage
              </Button>
            </Link>
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
          Drag collections from the library to build your page. Add skripts inside collections.
        </p>
      </CardHeader>
      <CardContent>
        <Droppable 
          droppableId="page-builder" 
          isDropDisabled={draggedItem?.type === 'skript'}
        >
          {(provided) => (
            <div
              {...provided.droppableProps}
              ref={provided.innerRef}
              className={cn(
                "min-h-[400px] border-2 border-dashed rounded-lg p-4 transition-colors",
                "border-muted-foreground/25",
                items.length === 0 && "flex items-center justify-center"
              )}
            >
              {items.length === 0 ? (
                <div className="text-center">
                  <Layout className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground mb-2">
                    Start building your page
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Drag collections from the content library to organize your public page
                  </p>

                  {session?.user?.isAdmin && (
                    <div className="mt-6 space-y-3">
                      <div className="border-t border-border pt-4">
                        <p className="text-xs text-muted-foreground mb-3">
                          Need some example content to get started?
                        </p>
                        <Button
                          onClick={handleSeedData}
                          disabled={seeding}
                          variant="outline"
                          size="sm"
                        >
                          {seeding ? 'Seeding...' : 'Insert Example Data'}
                        </Button>
                      </div>

                      {seedError && (
                        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {seedError}
                        </div>
                      )}

                      {seedSuccess && (
                        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">
                          {seedSuccess}
                        </div>
                      )}
                    </div>
                  )}

                  {provided.placeholder}
                </div>
              ) : (
                <div className="space-y-3">
                  {items
                    .sort((a, b) => a.order - b.order)
                    .map((item, index) => (
                      <PageBuilderItem
                        key={item.id}
                        item={item}
                        index={index}
                        onRemove={handleRemoveItem}
                        expandedCollections={expandedCollections}
                        onToggleCollection={onToggleCollection}
                        draggedItem={draggedItem}
                      />
                    ))}
                  {provided.placeholder}
                </div>
              )}
            </div>
          )}
        </Droppable>
        
        {items.length > 0 && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">
              💡 <strong>Tip:</strong> You can reorder items by dragging them.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface PageBuilderItemProps {
  item: PageItem
  index: number
  onRemove: (id: string, parentId?: string) => void
  expandedCollections: string[]
  onToggleCollection?: (collectionId: string) => void
  draggedItem?: {
    type: 'collection' | 'skript'
    id: string
    title: string
    description?: string
  } | null
}

function PageBuilderItem({ item, index, onRemove, expandedCollections, onToggleCollection, draggedItem }: PageBuilderItemProps) {
  const Icon = item.type === 'collection' ? BookOpen : FileText


  return (
    <Draggable 
      draggableId={`collection-${item.id}`} 
      index={index}
      isDragDisabled={item.permissions?.canView === false}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border border-border rounded-lg hover:shadow-sm transition-shadow",
            !item.permissions?.canEdit && "opacity-60 bg-muted/50",
            item.permissions?.canView === false && "border-red-200 bg-red-50",
            snapshot.isDragging && "opacity-50"
          )}
        >
          {/* Main content row */}
          <div className="flex items-center gap-3 p-3 relative">
            {/* Drag Handle */}
            {item.permissions?.canView !== false && (
              <div 
                {...provided.dragHandleProps}
                className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            {/* Remove button - positioned in top-right corner */}
            <div className="absolute top-2 right-2 z-10">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemove(item.id)}
                className="text-destructive hover:text-destructive h-5 w-5 p-0"
                title="Remove from page"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          <span className="text-xs text-muted-foreground font-mono w-6">
            {index + 1}
          </span>
          
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon className="w-5 h-5 text-primary flex-shrink-0" />
              {!item.permissions?.canEdit && (
                <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
            </div>
            {item.type === 'collection' && (
              <button
                onClick={() => onToggleCollection?.(item.id)}
                className="hover:bg-muted rounded p-1"
                title={expandedCollections.includes(item.id) ? 'Collapse' : 'Expand'}
              >
                {expandedCollections.includes(item.id) ? (
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            {item.permissions?.canView === false ? (
              <div className="space-y-1">
                <h4 className="font-medium text-sm text-red-600 truncate">Access Revoked</h4>
                <p className="text-xs text-red-500 truncate">Your access was revoked. This content can no longer be displayed on your page.</p>
              </div>
            ) : (
              <>
                {item.permissions?.canEdit && item.slug ? (
                  <Link
                    href={item.type === 'collection' ? `/dashboard/collections/${item.slug}` : `/dashboard/collections/${item.collectionSlug}/skripts/${item.slug}`}
                    className="font-medium text-sm truncate hover:underline flex items-center gap-1 w-fit"
                  >
                    {item.title}
                    <Edit className="w-3 h-3 flex-shrink-0" />
                  </Link>
                ) : (
                  <h4 className="font-medium text-sm truncate">{item.title}</h4>
                )}
                {item.description && (
                  <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                )}
              </>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground capitalize">
                {item.type}
              </span>
              {item.type === 'collection' && (
                <span className="text-xs text-muted-foreground">
                  • {item.skripts?.length || 0} skripts
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Nested skripts for collections - only show when expanded */}
        {item.type === 'collection' && expandedCollections.includes(item.id) && (
          <div className="px-3 pb-3">
            <div className="ml-6 space-y-2 border-l-2 border-muted pl-4 min-h-[60px]">
              {item.skripts && item.skripts.length > 0 ? (
                <Droppable 
                  droppableId={`skript-${item.id}`}
                  isDropDisabled={draggedItem?.type === 'collection'}
                >
                  {(provided) => (
                    <div 
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="space-y-2"
                    >
                      {item.skripts!
                        .sort((a, b) => a.order - b.order)
                        .map((skript, skriptIndex) => (
                          <SimpleSkriptItem
                            key={skript.id}
                            item={skript}
                            index={skriptIndex}
                            parentId={item.id}
                            parentCanEdit={item.permissions?.canEdit}
                            onRemove={onRemove}
                          />
                        ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              ) : (
                <Droppable 
                  droppableId={`empty-${item.id}`}
                  isDropDisabled={draggedItem?.type === 'collection'}
                >
                  {(provided) => (
                    <div 
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="text-center py-4 text-muted-foreground text-xs"
                    >
                      <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p>No skripts in this collection</p>
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )}
            </div>
          </div>
        )}
        </div>
      )}
    </Draggable>
  )
}

interface SimpleSkriptItemProps {
  item: PageItem
  index: number
  parentId: string
  parentCanEdit?: boolean
  onRemove: (id: string, parentId?: string) => void
}

function SimpleSkriptItem({ item, index, parentId, parentCanEdit = true, onRemove }: SimpleSkriptItemProps) {

  return (
    <Draggable 
      draggableId={`${parentId}-skript-${item.id}`} 
      index={index}
      isDragDisabled={item.permissions?.canView === false}
    >
      {(provided, snapshot) => (
        <div 
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-muted/30 border border-border rounded-lg hover:shadow-sm transition-shadow",
            snapshot.isDragging && "opacity-50",
            !item.permissions?.canEdit && "opacity-70 bg-muted/50",
            item.permissions?.canView === false && "border-red-200 bg-red-50"
          )}
        >
          <div className="flex items-center gap-3 p-2 relative">
            {/* Drag Handle */}
            {item.permissions?.canView !== false && (
              <div 
                {...provided.dragHandleProps}
                className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            {/* Remove button - positioned in top-right corner */}
            {parentCanEdit && (
              <div className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(item.id, parentId)}
                  className="text-destructive hover:text-destructive h-4 w-4 p-0"
                  title="Remove from collection"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
            
            <div className="relative">
              <FileText className={cn(
                "w-4 h-4 flex-shrink-0",
                !item.permissions?.canEdit ? "text-muted-foreground" : "text-primary"
              )} />
              {!item.permissions?.canEdit && (
                <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              {item.permissions?.canView === false ? (
                <div className="space-y-1">
                  <h5 className="font-medium text-xs text-red-600 truncate">Access Revoked</h5>
                  <p className="text-xs text-red-500 truncate">Your access was revoked. This content can no longer be displayed on your page.</p>
                </div>
              ) : (
                <>
                  {item.permissions?.canEdit && item.slug ? (
                    <Link
                      href={
                        item.collectionSlug && item.slug
                          ? `/dashboard/collections/${item.collectionSlug}/skripts/${item.slug}`
                          : `/dashboard/collections/${item.collectionSlug || item.id}` // fallback to collection
                      }
                      className={cn(
                        "font-medium text-xs truncate hover:underline flex items-center gap-1 w-fit",
                        !item.permissions?.canEdit ? "text-muted-foreground" : "text-foreground"
                      )}
                    >
                      {item.title}
                      <Edit className="w-2.5 h-2.5 flex-shrink-0" />
                    </Link>
                  ) : (
                    <h5 className={cn(
                      "font-medium text-xs truncate",
                      !item.permissions?.canEdit ? "text-muted-foreground" : "text-foreground"
                    )}>{item.title}</h5>
                  )}
                  {item.description && (
                    <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}




