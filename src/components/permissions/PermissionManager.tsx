'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Users, ArrowLeft, ArrowRight, Plus, X, GripVertical } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'

interface User {
  id: string
  name: string | null
  email: string | null
  image: string | null
  title: string | null
}

interface UserPermission {
  user: User
  permission: 'author' | 'viewer'
}

interface PermissionManagerProps {
  title?: string
  description?: string
  contentId: string
  contentType: 'collection' | 'skript'
  currentUserId: string
  permissions: UserPermission[]
  onPermissionChange: (userId: string, newPermission: 'author' | 'viewer') => Promise<void>
  onRemoveUser: (userId: string) => Promise<void>
  canManageAccess?: boolean
  onShareClick?: () => void
  /** When true, renders without Card wrapper for embedding in other containers */
  compact?: boolean
}

function UserCard({ 
  userPermission, 
  isCurrentUser, 
  isLastAuthor,
  onRemoveUser,
  isDragging = false,
  dragHandleProps
}: { 
  userPermission: UserPermission
  isCurrentUser: boolean
  isLastAuthor: boolean
  onRemoveUser: (userId: string) => Promise<void>
  isDragging?: boolean
  dragHandleProps?: any
}) {
  const [isRemoving, setIsRemoving] = useState(false)
  
  const isDisabled = isCurrentUser && isLastAuthor

  const handleRemoveUser = async () => {
    if (isDisabled) return
    
    setIsRemoving(true)
    try {
      await onRemoveUser(userPermission.user.id)
    } catch (error) {
      console.error('Error removing user:', error)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 p-3 border rounded-lg transition-colors ${
      isDisabled ? 'bg-muted opacity-60' : 'bg-card hover:bg-muted/50'
    } ${isDragging ? 'shadow-lg rotate-1' : ''}`}>
      {/* Drag Handle */}
      {!isDisabled && (
        <div {...dragHandleProps} className="opacity-40 hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      
      <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center flex-shrink-0">
        {userPermission.user.image ? (
          <Image 
            src={userPermission.user.image} 
            alt={userPermission.user.name || ''} 
            width={32} 
            height={32} 
            className="w-8 h-8 rounded-full" 
          />
        ) : (
          <Users className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {userPermission.user.name || 'No name'}
          {isCurrentUser && <span className="text-muted-foreground ml-2">(You)</span>}
        </div>
        <div className="text-sm text-muted-foreground truncate">{userPermission.user.email || 'No email'}</div>
        {userPermission.user.title && (
          <div className="text-xs text-muted-foreground truncate">{userPermission.user.title}</div>
        )}
      </div>

      {isDisabled ? (
        <div className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">
          Last author
        </div>
      ) : (
        <ConfirmationDialog
          title="Revoke Access?"
          description={`Revoke all rights to this collection for ${userPermission.user.name || userPermission.user.email || 'this user'}?${isCurrentUser ? ' You will no longer have access to it.' : ''}`}
          confirmText="Revoke Access"
          variant="destructive"
          onConfirm={handleRemoveUser}
          trigger={
            <Button
              size="sm"
              variant="ghost"
              disabled={isRemoving}
              className="h-8 w-8 p-0 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              title="Revoke access"
            >
              {isRemoving ? (
                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </Button>
          }
        />
      )}
    </div>
  )
}

export function PermissionManager({
  title,
  description,
  contentId,
  contentType,
  currentUserId,
  permissions,
  onPermissionChange,
  onRemoveUser,
  canManageAccess,
  onShareClick,
  compact = false
}: PermissionManagerProps) {
  const [localPermissions, setLocalPermissions] = useState<UserPermission[]>(permissions)

  useEffect(() => {
    setLocalPermissions(permissions)
  }, [permissions])

  const authorsWithWrite = localPermissions.filter(p => p.permission === 'author')
  const usersWithRead = localPermissions.filter(p => p.permission === 'viewer')

  const isLastAuthor = (userId: string) => {
    return authorsWithWrite.length === 1 && authorsWithWrite[0].user.id === userId
  }

  const handlePermissionChange = async (userId: string, newPermission: 'author' | 'viewer') => {
    try {
      await onPermissionChange(userId, newPermission)
      // Note: Local state is now updated optimistically in the drag handler
      // The useEffect will sync with the updated permissions from the parent
    } catch (error) {
      console.error('Error updating permission:', error)
      throw error
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const { draggableId, source, destination } = result

    // Extract user ID from draggable ID
    const userId = draggableId.replace('user-', '')
    const userPermission = localPermissions.find(p => p.user.id === userId)
    
    if (!userPermission) return

    // Determine new permission based on destination
    const newPermission: 'author' | 'viewer' = destination.droppableId === 'authors' ? 'author' : 'viewer'
    
    // If permission is the same, just reorder within the same section
    if (userPermission.permission === newPermission) {
      const currentAuthors = localPermissions.filter(p => p.permission === 'author')
      const currentViewers = localPermissions.filter(p => p.permission === 'viewer')
      
      if (newPermission === 'author') {
        const [moved] = currentAuthors.splice(source.index, 1)
        currentAuthors.splice(destination.index, 0, moved)
        setLocalPermissions([...currentAuthors, ...currentViewers])
      } else {
        const [moved] = currentViewers.splice(source.index, 1)
        currentViewers.splice(destination.index, 0, moved)
        setLocalPermissions([...currentAuthors, ...currentViewers])
      }
      return
    }

    // Check if this would leave no authors
    if (userPermission.permission === 'author' && authorsWithWrite.length === 1) {
      return
    }

    // For current user removing their own author access, show confirmation
    if (userId === currentUserId && userPermission.permission === 'author' && newPermission === 'viewer') {
      const confirmed = window.confirm(
        'Remove your write access?\n\nYou will no longer be able to edit this content or manage permissions. Another author will need to restore your access.'
      )
      if (!confirmed) return
    }

    // Store original state for potential rollback
    const originalPermissions = [...localPermissions]
    
    // Create new arrays with the moved user in the correct position
    const currentAuthors = localPermissions.filter(p => p.permission === 'author' && p.user.id !== userId)
    const currentViewers = localPermissions.filter(p => p.permission === 'viewer' && p.user.id !== userId)
    const updatedUser = { ...userPermission, permission: newPermission }
    
    if (newPermission === 'author') {
      currentAuthors.splice(destination.index, 0, updatedUser)
      setLocalPermissions([...currentAuthors, ...currentViewers])
    } else {
      currentViewers.splice(destination.index, 0, updatedUser)
      setLocalPermissions([...currentAuthors, ...currentViewers])
    }

    // Update permission via API
    try {
      await handlePermissionChange(userId, newPermission)
    } catch (error) {
      console.error('Failed to update permission:', error)
      // Revert optimistic update on error - restore original state
      setLocalPermissions(originalPermissions)
    }
  }

  const shareButton = canManageAccess && onShareClick && (
    <Button
      size="sm"
      variant="ghost"
      onClick={onShareClick}
      className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
      title="Share with collaborator"
    >
      <Plus className="w-3.5 h-3.5" />
      <Users className="w-3.5 h-3.5" />
    </Button>
  )

  const addCollaboratorEntry = canManageAccess && onShareClick && (
    <button
      onClick={onShareClick}
      className="flex items-center gap-2 w-full p-3 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
    >
      <Plus className="w-4 h-4 flex-shrink-0" />
      <Users className="w-4 h-4 flex-shrink-0" />
      <span>Add collaborator</span>
    </button>
  )

  const content = (
          <div className="space-y-6">
            {/* Can Read and Write */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">
                Can Read and Write ({authorsWithWrite.length})
              </h3>
              <Droppable droppableId="authors">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`space-y-2 min-h-[60px] p-2 rounded-lg border-2 border-dashed transition-all duration-200 ${
                      snapshot.isDraggingOver 
                        ? 'border-primary bg-primary/5 shadow-inner' 
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    {authorsWithWrite.map((userPermission, index) => (
                      <Draggable
                        key={userPermission.user.id}
                        draggableId={`user-${userPermission.user.id}`}
                        index={index}
                        isDragDisabled={isLastAuthor(userPermission.user.id)}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                          >
                            <UserCard
                              userPermission={userPermission}
                              isCurrentUser={userPermission.user.id === currentUserId}
                              isLastAuthor={isLastAuthor(userPermission.user.id)}
                              onRemoveUser={onRemoveUser}
                              isDragging={snapshot.isDragging}
                              dragHandleProps={provided.dragHandleProps}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {authorsWithWrite.length === 0 && (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        No users with write access
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
              {addCollaboratorEntry}
            </div>

            {/* Can Only Read */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-3">
                Can Only Read ({usersWithRead.length})
              </h3>
              <Droppable droppableId="viewers">
                {(provided, snapshot) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className={`space-y-2 min-h-[60px] p-2 rounded-lg border-2 border-dashed transition-all duration-200 ${
                      snapshot.isDraggingOver 
                        ? 'border-primary bg-primary/5 shadow-inner' 
                        : 'border-muted hover:border-muted-foreground/30'
                    }`}
                  >
                    {usersWithRead.map((userPermission, index) => (
                      <Draggable
                        key={userPermission.user.id}
                        draggableId={`user-${userPermission.user.id}`}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                          >
                            <UserCard
                              userPermission={userPermission}
                              isCurrentUser={userPermission.user.id === currentUserId}
                              isLastAuthor={false}
                              onRemoveUser={onRemoveUser}
                              isDragging={snapshot.isDragging}
                              dragHandleProps={provided.dragHandleProps}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {usersWithRead.length === 0 && (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        No users with read-only access
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
              {addCollaboratorEntry}
            </div>
          </div>
  )

  if (compact) {
    return (
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="p-3">
          {content}
        </div>
      </DragDropContext>
    )
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Card className="w-full">
        {title && (
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                <CardTitle>{title}</CardTitle>
              </div>
              {shareButton}
            </div>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent>
          {!title && shareButton && (
            <div className="flex justify-end mb-2">{shareButton}</div>
          )}
          {content}
        </CardContent>
      </Card>
    </DragDropContext>
  )
}