'use client'

import { Edit, Eye } from 'lucide-react'
import { User } from '@prisma/client'
import { cn } from '@/lib/utils'

interface PermissionIndicatorProps {
  editableBy?: Pick<User, 'id' | 'name' | 'email'>[]
  viewableBy?: Pick<User, 'id' | 'name' | 'email'>[]
  isViewOnly?: boolean
  className?: string
}

export function PermissionIndicator({ 
  editableBy = [], 
  viewableBy = [], 
  isViewOnly = false,
  className 
}: PermissionIndicatorProps) {
  const hasEditableBy = editableBy.length > 0
  const hasViewableBy = viewableBy.length > 0
  
  // Don't show anything if no special permissions
  if (!hasEditableBy && !hasViewableBy && !isViewOnly) {
    return null
  }

  const formatUserNames = (users: Pick<User, 'id' | 'name' | 'email'>[], maxShow = 3) => {
    if (users.length === 0) return null
    
    const names = users.slice(0, maxShow).map(user => user.name || user.email.split('@')[0])
    const remaining = users.length - maxShow
    
    if (remaining > 0) {
      return `${names.join(', ')} et al.`
    }
    
    return names.join(', ')
  }

  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {/* View-only indicator */}
      {isViewOnly && (
        <div className="flex items-center gap-1 text-muted-foreground">
          <Eye className="w-3 h-3" />
          <span>You can only view this</span>
        </div>
      )}
      
      {/* Editable by others */}
      {hasEditableBy && (
        <div className="flex items-center gap-1">
          <Edit className="w-3 h-3" />
          <span>{formatUserNames(editableBy)}</span>
        </div>
      )}
      
      {/* Viewable by others */}
      {hasViewableBy && (
        <div className="flex items-center gap-1">
          <Eye className="w-3 h-3" />
          <span>{formatUserNames(viewableBy)}</span>
        </div>
      )}
    </div>
  )
}