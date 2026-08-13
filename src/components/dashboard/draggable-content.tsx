'use client'

import { Draggable } from '@hello-pangea/dnd'
import { BookOpen, FileText, Eye, Edit, GripVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PermissionIndicator } from './permission-indicator'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { CollectionTitleInlineEditor, type CollectionUpdate } from './page-builder'
import { cn } from '@/lib/utils'
import { SkriptAuthor, User } from '@prisma/client'
import Link from 'next/link'

interface BaseContentProps {
  id: string
  title: string
  description?: string
  isViewOnly?: boolean
  className?: string
  index?: number // For draggable positioning
}

interface DraggableCollectionProps extends BaseContentProps {
  type: 'collection'
  skriptCount: number
  // Hex accent colour from the collection. Tints the BookOpen icon to match
  // the page builder + public sidebar. Null/undefined keeps the default
  // primary blue.
  accentColor?: string | null
  // Delete the collection. When provided, renders a trash button mirroring
  // the skript card's edit button. Collections are owned 1:1 by a Site; the
  // library only shows yours, so we don't render co-author chips on
  // collection cards anymore.
  onDelete?: (id: string) => void
  // Rename the collection inline (shared editor with the page builder's
  // collection rows). Omit to render the title as plain, non-editable text.
  onUpdated?: (collection: CollectionUpdate) => void
}

interface DraggableSkriptProps extends BaseContentProps {
  type: 'skript'
  pageCount: number
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  currentUserId: string
  slug?: string
  // DOM id for the drag-handle element. Used by EmptyPageDragHint to anchor
  // the "drag this into your page" hint on the first skript in the library.
  dragHandleId?: string
}

export function DraggableCollection({
  id,
  title,
  description,
  skriptCount,
  isViewOnly = false,
  className,
  index = 0,
  accentColor = null,
  onDelete,
  onUpdated,
}: DraggableCollectionProps) {
  return (
    <Draggable draggableId={`library-collection-${id}`} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border border-border rounded-lg hover:shadow-xs transition-shadow",
            snapshot.isDragging && "opacity-50",
            isViewOnly && "opacity-70 bg-muted/50",
            className
          )}
        >
          <div className="flex items-start gap-3 p-3 relative">
            {/* Collections are managed via page builder - no standalone edit
                page. The delete button mirrors the page-builder item's
                remove button (same corner/size); ConfirmationDialog gates it
                with a modal rather than a browser confirm(). */}
            {onDelete && (
              <ConfirmationDialog
                title="Delete collection"
                description={`Delete the collection "${title}"? The skripts inside it won't be deleted.`}
                confirmText="Delete"
                variant="destructive"
                onConfirm={() => onDelete(id)}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 z-10 text-destructive hover:text-destructive h-5 w-5 p-0"
                    title="Delete collection"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                }
              />
            )}
            {/* Drag Handle */}
            <div
              {...provided.dragHandleProps}
              className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="relative">
              <BookOpen
                className={cn(
                  "w-5 h-5 shrink-0",
                  isViewOnly ? "text-muted-foreground" : "text-primary"
                )}
                style={accentColor ? { color: accentColor } : undefined}
              />
              {isViewOnly && (
                <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {!isViewOnly && onUpdated ? (
                <CollectionTitleInlineEditor
                  collectionId={id}
                  title={title}
                  onUpdated={onUpdated}
                />
              ) : (
                <h3 className={cn(
                  "font-medium text-sm truncate",
                  isViewOnly ? "text-muted-foreground" : "text-foreground"
                )}>
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                  {description}
                </p>
              )}
              <span className="text-xs text-muted-foreground">
                {skriptCount} skripts
              </span>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

export function DraggableSkript({
  id,
  title,
  description,
  pageCount,
  authors,
  currentUserId,
  isViewOnly = false,
  className,
  index = 0,
  slug,
  dragHandleId
}: DraggableSkriptProps) {
  // Separate authors by permission
  const editableBy = authors.filter(author => 
    author.permission === 'author' && author.userId !== currentUserId
  ).map(author => author.user)

  const viewableBy = authors.filter(author =>
    author.permission === 'viewer' && author.userId !== currentUserId
  ).map(author => author.user)

  return (
    <Draggable
      draggableId={`library-skript-${id}`}
      index={index}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "bg-card border border-border rounded-lg hover:shadow-xs transition-shadow",
            snapshot.isDragging && "opacity-50",
            isViewOnly && "opacity-70 bg-muted/50",
            className
          )}
        >
          <div className="flex items-start gap-3 p-3 relative">
            {!isViewOnly && slug && (
              <Link href={`/dashboard/skripts/${slug}`} className="absolute top-2 right-2 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={(e) => e.stopPropagation()}
                  title="Edit skript"
                >
                  <Edit className="w-4 h-4" />
                </Button>
              </Link>
            )}
            {/* Drag Handle */}
            <div
              id={dragHandleId}
              {...provided.dragHandleProps}
              className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="relative">
              <FileText className={cn(
                "w-5 h-5 shrink-0",
                isViewOnly ? "text-muted-foreground" : "text-primary"
              )} />
              {isViewOnly && (
                <Eye className="w-3 h-3 text-muted-foreground absolute -bottom-1 -right-1 bg-background rounded-full" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className={cn(
                "font-medium text-sm truncate",
                isViewOnly ? "text-muted-foreground" : "text-foreground"
              )}>
                {title}
              </h3>
              {description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                  {description}
                </p>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {pageCount} pages
                </span>
                <PermissionIndicator
                  editableBy={editableBy}
                  viewableBy={viewableBy}
                  isViewOnly={isViewOnly}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}