'use client'

import { Fragment, useEffect, useRef } from 'react'
import { Droppable, Draggable } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Layout, Eye, BookOpen, FileText, Plus, Edit, ChevronDown, ChevronRight, X, GripVertical, Pencil, EyeOff } from 'lucide-react'
import { Sketch } from '@uiw/react-color'
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
  parentId?: string // For nested skripts under collections
  skripts?: PageItem[] // For collections containing skripts
  isInLayout?: boolean // For skripts: whether they're explicitly in the page layout
  isPublished?: boolean // For skripts: whether the skript is published
  isUnlisted?: boolean // For skripts: whether the skript is hidden from navigation
  accentColor?: string | null // For collections: hex color for sidebar letter markers
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
  // Called when the user saves the collection edit modal (rename + colour).
  // Receives the full updated collection record from the API; the parent
  // should merge it into local state. Null `accentColor` means "no tint,
  // use default".
  onCollectionUpdate?: (collection: { id: string; title: string; accentColor?: string | null }) => void
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
  onCollectionUpdate,
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
  const dialog = useAlertDialog()
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false)
  const [newCollectionTitle, setNewCollectionTitle] = useState('')
  const [creatingCollection, setCreatingCollection] = useState(false)

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

  // Create a collection from the "New Collection" / "Start from scratch"
  // dialog, then refresh so it shows up in the builder + library.
  const handleCreateCollection = async () => {
    const title = newCollectionTitle.trim()
    if (!title) return
    setCreatingCollection(true)
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: '' }),
      })
      if (res.ok) {
        setCreateCollectionOpen(false)
        setNewCollectionTitle('')
        onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        dialog.showError(data.error || 'Failed to create collection')
      }
    } catch {
      dialog.showError('Failed to create collection')
    } finally {
      setCreatingCollection(false)
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
    <>
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
              onClick={() => setCreateCollectionOpen(true)}
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
        {/* Outer droppable only accepts drops in the empty state — the very
            first item dropped onto a blank page builder. Once items exist
            we disable it so it stops shadowing nested droppables: root drops
            then happen via explicit RootGap strips between items, and
            collection-internal drops resolve to the per-collection droppables
            without competing with this wrapper. @hello-pangea/dnd picks the
            outer droppable when a drag overlaps a nested one, so we have to
            structurally remove the outer from the candidate set rather than
            rely on z-index/priority. */}
        <Droppable droppableId="page-builder" isDropDisabled={items.length > 0}>
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
                      onClick={() => setCreateCollectionOpen(true)}
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
                <div className="flex flex-col">
                  <RootGap index={0} />
                  {items
                    .sort((a, b) => a.order - b.order)
                    .map((item, index) => (
                      <Fragment key={item.id}>
                        <PageBuilderItem
                          item={item}
                          index={index}
                          onRemove={handleRemoveItem}
                          expandedCollections={expandedCollections}
                          onToggleCollection={onToggleCollection}
                          onCollectionUpdate={onCollectionUpdate}
                          draggedItem={draggedItem}
                        />
                        <RootGap index={index + 1} />
                      </Fragment>
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

    {/* New-collection prompt (replaces window.prompt). Both "New Collection"
        and the empty-state "Start from scratch" open this. */}
    <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Collection name"
          value={newCollectionTitle}
          onChange={(e) => setNewCollectionTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleCreateCollection()
            }
          }}
          disabled={creatingCollection}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setCreateCollectionOpen(false)}
            disabled={creatingCollection}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateCollection}
            disabled={creatingCollection || !newCollectionTitle.trim()}
          >
            {creatingCollection ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialogModal
      open={dialog.open}
      onOpenChange={dialog.setOpen}
      type={dialog.type}
      title={dialog.title}
      message={dialog.message}
      onConfirm={dialog.onConfirm}
      showCancel={dialog.showCancel}
      confirmText={dialog.confirmText}
      cancelText={dialog.cancelText}
      destructive={dialog.destructive}
    />
    </>
  )
}

// Slim drop strip between root items. The whole point is to give root drops
// (insert here at the root level) their own droppable so they no longer
// compete with collection-internal droppables. Index encodes the insertion
// position (0..items.length). Visually invisible until something is dragged
// over it, at which point the placeholder pushes neighbours apart.
function RootGap({ index }: { index: number }) {
  return (
    <Droppable droppableId={`root-gap-${index}`} type="DEFAULT">
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn(
            // Fixed height, always. The strip must NOT change size as a side
            // effect of a drag: @hello-pangea/dnd captures element positions
            // at drag-start, so a reactive size change shifts the layout and
            // throws the drag clone's offset off by the shift amount. h-8 is
            // a comfortable target on its own; while a drag is over it, dnd's
            // own placeholder (skript-sized) makes the zone obvious.
            // isDraggingOver only changes colour — not the box.
            "h-8 rounded transition-colors",
            snapshot.isDraggingOver && "bg-primary/20 ring-1 ring-primary/40"
          )}
        >
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  )
}

interface PageBuilderItemProps {
  item: PageItem
  index: number
  onRemove: (id: string, parentId?: string) => void
  expandedCollections: string[]
  onToggleCollection?: (collectionId: string) => void
  onCollectionUpdate?: (collection: { id: string; title: string; accentColor?: string | null }) => void
  draggedItem?: {
    type: 'collection' | 'skript'
    id: string
    title: string
    description?: string
    parentId?: string
    fromLibrary?: boolean
  } | null
}

function PageBuilderItem({ item, index, onRemove, expandedCollections, onToggleCollection, onCollectionUpdate, draggedItem }: PageBuilderItemProps) {
  const Icon = item.type === 'collection' ? BookOpen : FileText
  // Root-level skripts use a distinct draggable prefix so the drag-end parser
  // can tell them apart from collections (both render through this component).
  const draggableId = item.type === 'collection'
    ? `collection-${item.id}`
    : `root-skript-${item.id}`

  return (
    <Draggable
      draggableId={draggableId}
      index={index}
      isDragDisabled={item.permissions?.canView === false}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border border-border rounded-lg hover:shadow-xs transition-shadow",
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
            {/* Remove button + publish toggle - top-right corner */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              {item.type === 'skript' && item.permissions?.canEdit && item.isPublished !== undefined && (
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
              <Icon
                className="w-5 h-5 shrink-0 text-primary"
                style={
                  item.type === 'collection' && item.accentColor
                    ? { color: item.accentColor }
                    : undefined
                }
              />
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
                {item.permissions?.canEdit && item.type === 'collection' ? (
                  <div className="flex items-center gap-1.5">
                    <CollectionTitleInlineEditor
                      collectionId={item.id}
                      title={item.title}
                      onUpdated={onCollectionUpdate}
                    />
                    <CollectionColorButton
                      collectionId={item.id}
                      accentColor={item.accentColor ?? null}
                      onUpdated={onCollectionUpdate}
                    />
                  </div>
                ) : item.permissions?.canEdit && item.slug ? (
                  <Link
                    href={`/dashboard/skripts/${item.slug}`}
                    className="font-medium text-sm truncate hover:underline flex items-center gap-1 w-fit"
                  >
                    {item.title}
                    <Edit className="w-3 h-3 shrink-0" />
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
              {item.type === 'skript' && item.isPublished === false && (
                <span className="text-xs text-warning flex items-center gap-0.5">
                  <EyeOff className="w-3 h-3" />
                  Draft
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
                          parentAccentColor={item.accentColor ?? null}
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
  // Hex colour from the owning collection. When null we keep the default
  // primary-blue icon (same as root skripts).
  parentAccentColor?: string | null
  onRemove: (id: string, parentId?: string) => void
}

function SimpleSkriptItem({ item, index, parentId, parentCanEdit = true, parentAccentColor = null, onRemove }: SimpleSkriptItemProps) {

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
            "bg-muted/30 border border-border rounded-lg hover:bg-muted/50 hover:shadow-xs transition-all",
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
              <FileText
                className={cn(
                  "w-4 h-4 shrink-0",
                  !item.permissions?.canEdit
                    ? "text-muted-foreground"
                    : !parentAccentColor && "text-primary"
                )}
                style={
                  item.permissions?.canEdit && parentAccentColor
                    ? { color: parentAccentColor }
                    : undefined
                }
              />
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
                        <Edit className="w-2.5 h-2.5 shrink-0" />
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

// Curated palette shown at the bottom of the Sketch picker. Tailwind-500
// hues — same family the public sidebar already uses for letter markers.
const PRESET_ACCENT_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
]

interface CollectionUpdate {
  id: string
  title: string
  accentColor?: string | null
}

// Inline rename: title shows as text + small pencil. Click pencil (or the
// title) → input replaces text, autofocus, save on Enter / blur, cancel on
// Escape. PATCHes the API itself, then notifies the parent so local state
// can refresh.
function CollectionTitleInlineEditor({
  collectionId,
  title,
  onUpdated,
}: {
  collectionId: string
  title: string
  onUpdated?: (collection: CollectionUpdate) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset draft whenever the canonical title changes (e.g. successful save
  // from elsewhere) and we're not actively editing.
  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  // Autofocus + select on entry.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = async () => {
    const next = draft.trim()
    if (!next || next === title) {
      setEditing(false)
      setDraft(title)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      onUpdated?.(updated)
      setEditing(false)
    } catch (err) {
      console.error('Failed to rename collection:', err)
      // Roll back the visible draft so the user isn't left with an
      // unsavable input. They can click the pencil again to retry.
      setDraft(title)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(title)
            setEditing(false)
          }
        }}
        disabled={saving}
        className="font-medium text-sm bg-transparent border-b border-primary outline-hidden w-fit min-w-[10ch] max-w-full"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="font-medium text-sm truncate hover:underline flex items-center gap-1 w-fit"
      title="Rename collection"
    >
      {title}
      <Edit className="w-3 h-3 shrink-0" />
    </button>
  )
}

// Small coloured circle that opens a Sketch popover. The picker change fires
// the PATCH immediately (no separate save step); reset clears accentColor
// to null which the API treats as "no tint".
function CollectionColorButton({
  collectionId,
  accentColor,
  onUpdated,
}: {
  collectionId: string
  accentColor: string | null
  onUpdated?: (collection: CollectionUpdate) => void
}) {
  const [open, setOpen] = useState(false)
  const displayColor = accentColor || '#9ca3af' // muted gray when no colour set

  const save = async (color: string | null) => {
    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accentColor: color }),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      onUpdated?.(updated)
    } catch (err) {
      console.error('Failed to update collection accent colour:', err)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full border border-border w-4 h-4 hover:scale-110 transition-transform shrink-0"
          style={{ backgroundColor: displayColor }}
          title={accentColor ? `Accent: ${accentColor}` : 'Set accent colour'}
          aria-label="Set collection accent colour"
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2 color-picker-themed" align="start">
        <Sketch
          color={accentColor ?? '#9ca3af'}
          presetColors={PRESET_ACCENT_COLORS}
          disableAlpha
          style={{ background: 'transparent', boxShadow: 'none' }}
          onChange={(c) => save(c.hex)}
        />
        {accentColor && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full mt-2 text-xs h-7"
            onClick={() => {
              save(null)
              setOpen(false)
            }}
          >
            Reset to default
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}


