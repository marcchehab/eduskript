'use client'

import { Draggable } from '@hello-pangea/dnd'
import { BookOpen, FileText, Eye, Edit, GripVertical, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PermissionIndicator } from './permission-indicator'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
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
}

interface DraggableSkriptProps extends BaseContentProps {
  type: 'skript'
  pageCount: number
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  currentUserId: string
  slug?: string
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
}: DraggableCollectionProps) {
  return (
    <Draggable draggableId={`library-collection-${id}`} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "hover:shadow-md",
            snapshot.isDragging && "opacity-50 transition-none",
            !snapshot.isDragging && "transition-shadow",
            isViewOnly && "opacity-70 bg-muted/50",
            className
          )}
        >
          <CardContent className="p-4 relative">
            {/* Collections are managed via page builder - no standalone edit
                page. The delete button mirrors the skript card's edit button
                (same size/position/variant); ConfirmationDialog gates it with
                a modal rather than a browser confirm(). */}
            {onDelete && (
              <ConfirmationDialog
                title="Delete collection"
                description={`Delete the collection "${title}"? The skripts inside it won't be deleted.`}
                confirmText="Delete"
                variant="destructive"
                onConfirm={() => onDelete(id)}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-2 right-2 z-10 h-7 w-7 p-0"
                    title="Delete collection"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                }
              />
            )}
            <div className="flex items-start gap-3">
              {/* Drag Handle */}
              <div 
                {...provided.dragHandleProps}
                className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity mt-0.5"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="relative">
                <BookOpen
                  className={cn(
                    "w-5 h-5 mt-0.5 flex-shrink-0",
                    isViewOnly ? "text-muted-foreground" : "text-primary"
                  )}
                  style={accentColor ? { color: accentColor } : undefined}
                />
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
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {description}
                  </p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">
                    {skriptCount} skripts
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
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
  slug
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
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "hover:shadow-md",
            snapshot.isDragging && "opacity-50 transition-none",
            !snapshot.isDragging && "transition-shadow",
            isViewOnly && "opacity-70 bg-muted/50",
            className
          )}
        >
          <CardContent className="p-4 relative">
            {!isViewOnly && slug && (
              <Link href={`/dashboard/skripts/${slug}`} className="absolute top-2 right-2 z-10">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Edit className="w-4 h-4" />
                </Button>
              </Link>
            )}
            <div className="flex items-start gap-3">
              {/* Drag Handle */}
              <div 
                {...provided.dragHandleProps}
                className="opacity-70 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity mt-0.5"
              >
                <GripVertical className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="relative">
                <FileText className={cn(
                  "w-5 h-5 mt-0.5 flex-shrink-0",
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
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {description}
                  </p>
                )}
                <div className="flex items-center justify-between mt-2">
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
          </CardContent>
        </Card>
      )}
    </Draggable>
  )
}