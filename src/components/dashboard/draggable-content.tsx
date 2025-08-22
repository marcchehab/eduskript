'use client'

import { useDraggable } from '@dnd-kit/core'
import { BookOpen, FileText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PermissionIndicator } from './permission-indicator'
import { cn } from '@/lib/utils'
import { CollectionAuthor, SkriptAuthor, User } from '@prisma/client'

interface BaseContentProps {
  id: string
  title: string
  description?: string
  isViewOnly?: boolean
  className?: string
}

interface DraggableCollectionProps extends BaseContentProps {
  type: 'collection'
  skriptCount: number
  authors: (CollectionAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  currentUserId: string
}

interface DraggableSkriptProps extends BaseContentProps {
  type: 'skript'
  pageCount: number
  authors: (SkriptAuthor & { user: Pick<User, 'id' | 'name' | 'email'> })[]
  currentUserId: string
}

// type DraggableContentProps = DraggableCollectionProps | DraggableSkriptProps

export function DraggableCollection({ 
  id, 
  title, 
  description, 
  skriptCount, 
  authors, 
  currentUserId, 
  isViewOnly = false,
  className 
}: DraggableCollectionProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `collection-${id}`,
    data: {
      type: 'collection',
      id,
      title,
      description,
      skriptCount
    }
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined

  // Separate authors by permission
  const editableBy = authors.filter(author => 
    author.permission === 'author' && author.userId !== currentUserId
  ).map(author => author.user)

  const viewableBy = authors.filter(author => 
    author.permission === 'viewer' && author.userId !== currentUserId
  ).map(author => author.user)

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab hover:shadow-md transition-all",
        isDragging && "opacity-50 rotate-2 shadow-lg",
        isViewOnly && "opacity-70 bg-muted/50",
        className
      )}
      {...listeners}
      {...attributes}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <BookOpen className={cn(
            "w-5 h-5 mt-0.5 flex-shrink-0",
            isViewOnly ? "text-muted-foreground" : "text-primary"
          )} />
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
  className 
}: DraggableSkriptProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `skript-${id}`,
    data: {
      type: 'skript',
      id,
      title,
      description,
      pageCount
    }
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined

  // Separate authors by permission
  const editableBy = authors.filter(author => 
    author.permission === 'author' && author.userId !== currentUserId
  ).map(author => author.user)

  const viewableBy = authors.filter(author => 
    author.permission === 'viewer' && author.userId !== currentUserId
  ).map(author => author.user)

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-grab hover:shadow-md transition-all",
        isDragging && "opacity-50 rotate-2 shadow-lg",
        isViewOnly && "opacity-70 bg-muted/50",
        className
      )}
      {...listeners}
      {...attributes}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <FileText className={cn(
            "w-5 h-5 mt-0.5 flex-shrink-0",
            isViewOnly ? "text-muted-foreground" : "text-primary"
          )} />
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
  )
}