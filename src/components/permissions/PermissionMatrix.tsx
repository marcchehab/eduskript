'use client'

import { useState } from 'react'
import { X, Eye, Edit, Users, AlertCircle } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { CollectionWithAuthors, Permission } from '@/types'

interface PermissionMatrixProps {
  collection: CollectionWithAuthors
  collaborators: Array<{
    id: string
    name: string | null
    email: string
    image: string | null
    hasCollectionAccess: boolean
    collectionPermission?: string
    skriptAccess: {
      skriptId: string
      skriptTitle: string
      permission: string
    }[]
  }>
  canManage: boolean
  onPermissionChange: () => void
}

export function PermissionMatrix({ 
  collection, 
  collaborators, 
  canManage, 
  onPermissionChange 
}: PermissionMatrixProps) {
  const [isUpdating, setIsUpdating] = useState<string | null>(null)

  const updateCollectionPermission = async (userId: string, permission: Permission | 'none') => {
    setIsUpdating(`collection-${userId}`)
    try {
      if (permission === 'none') {
        // Remove user from collection
        const response = await fetch(`/api/collections/${collection.id}/authors/${userId}`, {
          method: 'DELETE'
        })
        if (!response.ok) throw new Error('Failed to remove access')
      } else {
        // Check if user already has access
        const userHasAccess = collection.authors.some(author => author.userId === userId)
        
        if (userHasAccess) {
          // Update existing permission
          const response = await fetch(`/api/collections/${collection.id}/authors/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permission })
          })
          if (!response.ok) throw new Error('Failed to update permission')
        } else {
          // Add new permission
          const response = await fetch(`/api/collections/${collection.id}/authors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, permission })
          })
          if (!response.ok) throw new Error('Failed to add permission')
        }
      }
      
      onPermissionChange()
    } catch (error) {
      console.error('Error updating collection permission:', error)
      // TODO: Add toast notification
    }
    setIsUpdating(null)
  }

  const updateSkriptPermission = async (userId: string, skriptId: string, permission: Permission | 'none') => {
    setIsUpdating(`skript-${userId}-${skriptId}`)
    try {
      if (permission === 'none') {
        // Remove user from skript
        const response = await fetch(`/api/skripts/${skriptId}/authors/${userId}`, {
          method: 'DELETE'
        })
        if (!response.ok) throw new Error('Failed to remove skript access')
      } else {
        // Check if user already has skript access
        const collaborator = collaborators.find(c => c.id === userId)
        const hasSkriptAccess = collaborator?.skriptAccess.some(access => access.skriptId === skriptId)
        
        if (hasSkriptAccess) {
          // Update existing skript permission
          const response = await fetch(`/api/skripts/${skriptId}/authors/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permission })
          })
          if (!response.ok) throw new Error('Failed to update skript permission')
        } else {
          // Add new skript permission
          const response = await fetch(`/api/skripts/${skriptId}/authors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, permission })
          })
          if (!response.ok) throw new Error('Failed to add skript permission')
        }
      }
      
      onPermissionChange()
    } catch (error) {
      console.error('Error updating skript permission:', error)
      // TODO: Add toast notification
    }
    setIsUpdating(null)
  }

  const getPermissionIcon = (permission: string) => {
    switch (permission) {
      case 'author':
        return <Edit className="w-3 h-3" />
      case 'viewer':
        return <Eye className="w-3 h-3" />
      default:
        return <X className="w-3 h-3" />
    }
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'author':
        return 'bg-blue-100 text-blue-800'
      case 'viewer':
        return 'bg-green-100 text-green-800'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  // Filter to only show collaborators (users we have relationships with)
  const displayCollaborators = collaborators.filter(c => c.id !== collection.authors[0]?.userId)

  if (displayCollaborators.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p>No collaborators to show permissions for.</p>
        <p className="text-sm">Add collaborators first to manage their content access.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-blue-500" />
        <div className="text-sm text-gray-600">
          Collection access automatically grants view access to all skripts within it.
        </div>
      </div>

      {/* Permission Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-4 py-3 text-left font-medium">
                Collaborator
              </th>
              <th className="border border-gray-200 px-4 py-3 text-center font-medium">
                Collection
              </th>
              {collection.skripts?.map((skript) => (
                <th key={skript.id} className="border border-gray-200 px-4 py-3 text-center font-medium min-w-[120px]">
                  <div className="truncate" title={skript.title}>
                    {skript.title}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayCollaborators.map((collaborator) => (
              <tr key={collaborator.id} className="hover:bg-gray-50">
                <td className="border border-gray-200 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                      {collaborator.image ? (
                        <img src={collaborator.image} alt={collaborator.name || ''} className="w-8 h-8 rounded-full" />
                      ) : (
                        <Users className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{collaborator.name || 'No name'}</div>
                      <div className="text-xs text-gray-600 truncate">{collaborator.email}</div>
                    </div>
                  </div>
                </td>
                
                {/* Collection Permission */}
                <td className="border border-gray-200 px-2 py-3 text-center">
                  {canManage ? (
                    <Select
                      value={collaborator.collectionPermission || 'none'}
                      onValueChange={(value) => updateCollectionPermission(collaborator.id, value as Permission | 'none')}
                      disabled={isUpdating === `collection-${collaborator.id}`}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge className={getPermissionColor(collaborator.collectionPermission || 'none')}>
                      <div className="flex items-center gap-1">
                        {getPermissionIcon(collaborator.collectionPermission || 'none')}
                        {collaborator.collectionPermission || 'none'}
                      </div>
                    </Badge>
                  )}
                </td>

                {/* Skript Permissions */}
                {collection.skripts?.map((skript) => {
                  const skriptAccess = collaborator.skriptAccess.find(access => access.skriptId === skript.id)
                  const permission = skriptAccess?.permission || 'none'
                  
                  // If user has collection access, they inherit view access to skripts
                  const effectivePermission = collaborator.hasCollectionAccess && permission === 'none' 
                    ? 'viewer' 
                    : permission
                  
                  const isInherited = collaborator.hasCollectionAccess && permission === 'none'

                  return (
                    <td key={skript.id} className="border border-gray-200 px-2 py-3 text-center">
                      {canManage && !isInherited ? (
                        <Select
                          value={permission}
                          onValueChange={(value) => updateSkriptPermission(collaborator.id, skript.id, value as Permission | 'none')}
                          disabled={isUpdating === `skript-${collaborator.id}-${skript.id}`}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                            <SelectItem value="author">Author</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge 
                          className={`${getPermissionColor(effectivePermission)} ${isInherited ? 'opacity-75' : ''}`}
                          title={isInherited ? 'Inherited from collection access' : ''}
                        >
                          <div className="flex items-center gap-1">
                            {getPermissionIcon(effectivePermission)}
                            {effectivePermission}
                            {isInherited && <span className="text-xs">*</span>}
                          </div>
                        </Badge>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Edit className="w-4 h-4 text-blue-600" />
          <span>Author - Can edit and manage</span>
        </div>
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-green-600" />
          <span>Viewer - Can view only</span>
        </div>
        <div className="flex items-center gap-2">
          <X className="w-4 h-4 text-gray-600" />
          <span>None - No access</span>
        </div>
        <div className="text-xs text-gray-500">
          * = Inherited from collection access
        </div>
      </div>
    </div>
  )
}