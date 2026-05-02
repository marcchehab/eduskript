'use client'

import { Droppable, Draggable } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Layout, Eye, BookOpen, FileText, Plus, Edit, ChevronDown, ChevronRight, X, GripVertical, Pencil, EyeOff } from 'lucide-react'
import { PublishToggle } from './publish-toggle'
import { cn } from '@/lib/utils'
import Link from 'next/link'
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
  isPublished?: boolean // For skripts: whether the skript is published
  isUnlisted?: boolean // For skripts: whether the skript is hidden from navigation
  permissions?: {
    canEdit: boolean
    canView: boolean
  }
}

interface PageBuilderContext {
  type: 'user' | 'organization'
  organizationId?: string
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
    parentId?: string
    fromLibrary?: boolean
  } | null
  onRefresh?: () => void
  context?: PageBuilderContext
}

export function PageBuilder({
  items,
  onItemsChange,
  onPreview,
  expandedCollections = [],
  onToggleCollection,
  draggedItem,
  onRefresh,
  context = { type: 'user' }
}: PageBuilderProps) {
  // Determine the frontpage URL based on context
  const frontpageUrl = context.type === 'organization' && context.organizationId
    ? `/dashboard/org/${context.organizationId}/frontpage`
    : '/dashboard/frontpage'
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState('')
  const [seedSuccess, setSeedSuccess] = useState('')

  const handleSeedData = async () => {
    setSeeding(true)
    setSeedError('')
    setSeedSuccess('')

    try {
      const response = await fetch('/api/seed-example-content', {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create example content')
      }

      setSeedSuccess('Example content created!')
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
            Your Page
          </CardTitle>
          <div className="flex gap-2">
            <Link href={frontpageUrl}>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                Edit Main Frontpage
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={() => {
                // Collections are created via API and added to page builder
                const title = prompt('Collection name:')
                if (!title?.trim()) return
                const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
                fetch('/api/collections', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: title.trim(), slug, description: '' })
                }).then(res => {
                  if (res.ok) onRefresh?.()
                  else res.json().then(d => window.alert(d.error || 'Failed to create collection'))
                })
              }}
            >
              <Plus className="w-4 h-4" />
              New Collection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onPreview}
              className="flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              View
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Drag collections from the library to build your page. Add skripts inside collections.
        </p>
      </CardHeader>
      <CardContent>
        {/* Disable the outer droppable while reordering a skript that's already
            inside a collection. @hello-pangea/dnd's getFurthestAway picks the
            droppable whose center is furthest from drag-start when several
            overlap; with nested droppables that's always the outer one, so
            in-collection reorders would otherwise resolve to root and trigger
            the "add to a collection" dialog. Library skripts (no parentId)
            still hit this droppable, preserving that dialog. */}
        <Droppable
          droppableId="page-builder"
          isDropDisabled={draggedItem?.type === 'skript' && !!draggedItem.parentId}
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
                <div className="text-center max-w-lg mx-auto">
                  {seedError && (
                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">
                      {seedError}
                    </div>
                  )}

                  {seedSuccess && (
                    <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 mb-4">
                      {seedSuccess}
                    </div>
                  )}

                  <h3 className="text-lg font-medium text-muted-foreground mb-6">
                    How would you like to start?
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Explore with examples */}
                    <button
                      onClick={handleSeedData}
                      disabled={seeding}
                      className={cn(
                        "flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed",
                        "hover:border-primary hover:bg-primary/5 transition-colors text-left",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <BookOpen className="w-8 h-8 text-primary" />
                      <div className="text-center">
                        <p className="font-medium text-sm">
                          {seeding ? 'Creating...' : 'Explore with examples'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Get a sample collection with pages showcasing markdown, math, callouts, and interactive code
                        </p>
                      </div>
                    </button>

                    {/* Start from scratch */}
                    <button
                      onClick={() => {
                        const title = prompt('Collection name:')
                        if (!title?.trim()) return
                        const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim()
                        fetch('/api/collections', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title: title.trim(), slug, description: '' })
                        }).then(res => {
                          if (res.ok) onRefresh?.()
                          else res.json().then(d => window.alert(d.error || 'Failed to create collection'))
                        })
                      }}
                      className={cn(
                        "flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed",
                        "hover:border-primary hover:bg-primary/5 transition-colors text-left"
                      )}
                    >
                      <Plus className="w-8 h-8 text-primary" />
                      <div className="text-center">
                        <p className="font-medium text-sm">Start from scratch</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Create an empty collection and build your content step by step
                        </p>
                      </div>
                    </button>
                  </div>

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
    parentId?: string
    fromLibrary?: boolean
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
          <div className="flex items-start gap-3 p-3 relative">
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
                    href={item.type === 'collection' ? '#' : `/dashboard/skripts/${item.slug}`}
                    className="font-medium text-sm truncate hover:underline flex items-center gap-1 w-fit"
                  >
                    {item.title}
                    <Edit className="w-3 h-3 flex-shrink-0" />
                  </Link>
                ) : (
                  <h4 className="font-medium text-sm truncate">{item.title}</h4>
                )}
                {item.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-snug mt-0.5">{item.description}</p>
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
            {/* The Droppable's innerRef element owns the visible drop-zone styles
                (border, padding, min-height). If those sit on a wrapper instead,
                the Droppable's bounding rect shrinks to its content and drops in
                the visual gap fall through to the outer `page-builder` Droppable. */}
            {item.skripts && item.skripts.length > 0 ? (
              <Droppable
                droppableId={`skript-${item.id}`}
                isDropDisabled={draggedItem?.type === 'collection'}
              >
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="ml-6 space-y-2 border-l-2 border-muted pl-4 min-h-[60px]"
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
                    className="ml-6 border-l-2 border-muted pl-4 min-h-[60px] text-center py-4 text-muted-foreground text-xs"
                  >
                    <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p>No skripts in this collection</p>
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            )}
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
            "bg-muted/30 border border-border rounded-lg hover:bg-muted/50 hover:shadow-sm transition-all",
            snapshot.isDragging && "opacity-50",
            !item.permissions?.canEdit && "opacity-70 bg-muted/50",
            item.permissions?.canView === false && "border-red-200 bg-red-50"
          )}
        >
          <div className="flex items-start gap-3 p-2">
            {/* Drag Handle */}
            {item.permissions?.canView !== false && (
              <div
                {...provided.dragHandleProps}
                className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity mt-0.5"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
            )}

            <div className="relative mt-0.5">
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
                  <div className="flex items-center gap-2">
                    {item.permissions?.canEdit && item.slug ? (
                      <Link
                        href={`/dashboard/skripts/${item.slug}`}
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
                    {/* Show draft indicator for unpublished skripts */}
                    {item.isPublished === false && (
                      <span className="text-xs text-warning flex items-center gap-0.5">
                        <EyeOff className="w-3 h-3" />
                        Draft
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-snug mt-0.5">{item.description}</p>
                  )}
                </>
              )}
            </div>
            {/* Action buttons - aligned in a button bar */}
            <div className="flex items-center gap-1">
              {item.permissions?.canEdit && item.isPublished !== undefined && (
                <PublishToggle
                  type="skript"
                  itemId={item.id}
                  isPublished={item.isPublished}
                  isUnlisted={item.isUnlisted}
                  onToggle={() => {}}
                  size="sm"
                  showText={false}
                />
              )}
              {parentCanEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(item.id, parentId)}
                  className="text-destructive hover:text-destructive h-6 w-6 p-0"
                  title="Remove from collection"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}




