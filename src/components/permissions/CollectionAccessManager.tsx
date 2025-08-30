'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollectionWithAuthors, UserPermissions } from '@/types'
import { PermissionManager } from './PermissionManager'
import { ShareContentModal } from './ShareContentModal'

interface CollectionAccessManagerProps {
  collection: CollectionWithAuthors
  userPermissions: UserPermissions
  onPermissionChange?: () => void
}

interface User {
  id: string
  name: string | null
  email: string
  image: string | null
  title: string | null
}

interface UserPermission {
  user: User
  permission: 'author' | 'viewer'
}

export function CollectionAccessManager({ 
  collection, 
  userPermissions, 
  onPermissionChange 
}: CollectionAccessManagerProps) {
  const [permissions, setPermissions] = useState<UserPermission[]>([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Check if current user can manage access
  const canManageAccess = userPermissions.canManageAuthors

  const loadPermissions = useCallback(async () => {
    setIsLoading(true)
    try {
      // Convert collection authors to UserPermission format
      const userPermissions: UserPermission[] = collection.authors.map(author => ({
        user: {
          id: author.user.id,
          name: author.user.name,
          email: author.user.email,
          image: author.user.image,
          title: author.user.title
        },
        permission: author.permission as 'author' | 'viewer'
      }))

      setPermissions(userPermissions)
    } catch (error) {
      console.error('Error loading permissions:', error)
    }
    setIsLoading(false)
  }, [collection.authors])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  const handlePermissionChange = async (userId: string, newPermission: 'author' | 'viewer') => {
    try {
      const response = await fetch(`/api/collections/${collection.id}/authors/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: newPermission })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update permission')
      }

      // Refresh permissions
      await loadPermissions()
      onPermissionChange?.()
    } catch (error) {
      console.error('Error updating permission:', error)
      throw error
    }
  }

  const handleRemoveUser = async (userId: string) => {
    try {
      const response = await fetch(`/api/collections/${collection.id}/authors/${userId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to remove user')
      }

      // Refresh permissions
      await loadPermissions()
      onPermissionChange?.()
    } catch (error) {
      console.error('Error removing user:', error)
      throw error
    }
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading permissions...</div>
  }

  return (
    <div className="space-y-4">
      {/* Share Content Button */}
      {canManageAccess && (
        <div className="flex justify-end">
          <Button onClick={() => setShowShareModal(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Share Content
          </Button>
        </div>
      )}

      {/* Permission Manager */}
      <PermissionManager
        title="Access Management"
        description={`Manage who can access "${collection.title}"`}
        contentId={collection.id}
        contentType="collection"
        currentUserId={userPermissions.userId}
        permissions={permissions}
        onPermissionChange={handlePermissionChange}
        onRemoveUser={handleRemoveUser}
      />

      {/* Share Content Modal */}
      {showShareModal && (
        <ShareContentModal
          collection={collection}
          collaborators={[]} // We'll need to update this to get collaborators for sharing
          onClose={() => setShowShareModal(false)}
          onShare={loadPermissions}
        />
      )}
    </div>
  )
}