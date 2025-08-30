'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Users, ArrowLeft, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

interface PermissionManagerProps {
  title: string
  description: string
  contentId: string
  contentType: 'collection' | 'skript'
  currentUserId: string
  permissions: UserPermission[]
  onPermissionChange: (userId: string, newPermission: 'author' | 'viewer') => Promise<void>
  onRemoveUser: (userId: string) => Promise<void>
}

function UserCard({ 
  userPermission, 
  isCurrentUser, 
  isLastAuthor,
  onPermissionChange
}: { 
  userPermission: UserPermission
  isCurrentUser: boolean
  isLastAuthor: boolean
  onPermissionChange: (userId: string, newPermission: 'author' | 'viewer') => Promise<void>
}) {
  const [isChanging, setIsChanging] = useState(false)
  
  const isDisabled = isCurrentUser && isLastAuthor

  const handlePermissionToggle = async () => {
    if (isDisabled) return
    
    setIsChanging(true)
    try {
      const newPermission = userPermission.permission === 'author' ? 'viewer' : 'author'
      await onPermissionChange(userPermission.user.id, newPermission)
    } catch (error) {
      console.error('Error changing permission:', error)
    } finally {
      setIsChanging(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 p-3 border rounded-lg ${
      isDisabled ? 'bg-gray-50 opacity-60' : 'bg-white hover:bg-gray-50'
    }`}>
      <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
        {userPermission.user.image ? (
          <Image 
            src={userPermission.user.image} 
            alt={userPermission.user.name || ''} 
            width={32} 
            height={32} 
            className="w-8 h-8 rounded-full" 
          />
        ) : (
          <Users className="w-4 h-4 text-gray-500" />
        )}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {userPermission.user.name || 'No name'}
          {isCurrentUser && <span className="text-gray-500 ml-2">(You)</span>}
        </div>
        <div className="text-sm text-gray-600 truncate">{userPermission.user.email}</div>
        {userPermission.user.title && (
          <div className="text-xs text-gray-500 truncate">{userPermission.user.title}</div>
        )}
      </div>

      {isDisabled ? (
        <div className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded">
          Last author
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={handlePermissionToggle}
          disabled={isChanging}
          className="flex items-center gap-1"
        >
          {isChanging ? (
            'Changing...'
          ) : userPermission.permission === 'author' ? (
            <>
              <ArrowRight className="w-3 h-3" />
              Make viewer
            </>
          ) : (
            <>
              <ArrowLeft className="w-3 h-3" />
              Make author
            </>
          )}
        </Button>
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
  onRemoveUser
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
      
      // Update local state
      setLocalPermissions(prev => 
        prev.map(p => 
          p.user.id === userId 
            ? { ...p, permission: newPermission }
            : p
        )
      )
    } catch (error) {
      console.error('Error updating permission:', error)
      throw error
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Can Read and Write */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              Can Read and Write ({authorsWithWrite.length})
            </h3>
            <div className="space-y-2">
              {authorsWithWrite.map((userPermission) => (
                <UserCard
                  key={userPermission.user.id}
                  userPermission={userPermission}
                  isCurrentUser={userPermission.user.id === currentUserId}
                  isLastAuthor={isLastAuthor(userPermission.user.id)}
                  onPermissionChange={handlePermissionChange}
                />
              ))}
              {authorsWithWrite.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                  No users with write access
                </div>
              )}
            </div>
          </div>

          {/* Can Only Read */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              Can Only Read ({usersWithRead.length})
            </h3>
            <div className="space-y-2">
              {usersWithRead.map((userPermission) => (
                <UserCard
                  key={userPermission.user.id}
                  userPermission={userPermission}
                  isCurrentUser={userPermission.user.id === currentUserId}
                  isLastAuthor={false}
                  onPermissionChange={handlePermissionChange}
                />
              ))}
              {usersWithRead.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                  No users with read-only access
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}