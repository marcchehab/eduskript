'use client'

/**
 * Quick Undo Button Component
 *
 * Provides a single-click undo to restore the previous version.
 * Displays inline near the component toolbar.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'

import { useRestoreVersion } from '@/lib/userdata/hooks'
import { Undo2 } from 'lucide-react'

interface QuickUndoProps {
  pageId: string
  componentId: string
  onUndo?: () => void
  disabled?: boolean
  size?: 'sm' | 'default' | 'lg'
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
}

export function QuickUndo({
  pageId,
  componentId,
  onUndo,
  disabled = false,
  size = 'sm',
  variant = 'ghost',
}: QuickUndoProps) {
  const { restorePrevious, isRestoring } = useRestoreVersion(pageId, componentId)
  const [justRestored, setJustRestored] = useState(false)

  const handleUndo = async () => {
    try {
      const data = await restorePrevious()
      if (data) {
        setJustRestored(true)
        if (onUndo) {
          onUndo()
        }
        setTimeout(() => setJustRestored(false), 2000)
      }
    } catch (error) {
      console.error('Failed to undo:', error)
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      disabled={disabled || isRestoring}
      onClick={handleUndo}
      className="flex items-center gap-1"
      title="Undo to previous version"
    >
      {isRestoring ? (
        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
      ) : (
        <Undo2 className="h-3 w-3" />
      )}
      {justRestored && size !== 'sm' && (
        <span className="text-xs text-green-600">Restored</span>
      )}
    </Button>
  )
}

interface VersionActionsProps {
  pageId: string
  componentId: string
  onUndo?: () => void
  onViewHistory?: () => void
  disabled?: boolean
}

/**
 * Combined version actions component with undo and history buttons
 */
export function VersionActions({
  pageId,
  componentId,
  onUndo,
  onViewHistory,
  disabled = false,
}: VersionActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <QuickUndo
        pageId={pageId}
        componentId={componentId}
        onUndo={onUndo}
        disabled={disabled}
      />
      {onViewHistory && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onViewHistory}
          className="flex items-center gap-1"
          title="View full version history"
        >
          <span className="text-xs">History</span>
        </Button>
      )}
    </div>
  )
}
