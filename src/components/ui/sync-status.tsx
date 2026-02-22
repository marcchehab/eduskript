'use client'

/**
 * Sync Status Indicator
 *
 * A subtle square icon button that shows sync status.
 * Click to open a modal with operation history and current status.
 */

import { useState } from 'react'
import { Cloud, CloudOff, Loader2, AlertCircle, Check, X, RefreshCw } from 'lucide-react'
import { useSyncStatus, useUserDataContext } from '@/lib/userdata/provider'
import { syncEngine, type SyncOperation } from '@/lib/userdata/sync-engine'
import { cn } from '@/lib/utils'

/**
 * Compact square sync status button for sidebar
 * Shows icon only - spinner for syncing, check for synced, alert for error
 */
export function SyncStatusButton({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const status = useSyncStatus()
  const { isAuthenticated, annotationVersionMismatch } = useUserDataContext()

  const hasError = !!status.error
  const isSyncing = status.syncing
  const hasPending = status.pending > 0
  const isOffline = !status.online
  const hasVersionMismatch = annotationVersionMismatch

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-md transition-colors',
          hasVersionMismatch
            ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
            : hasError
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          className
        )}
        title={hasVersionMismatch ? 'Annotations may not align - page content changed' : getStatusTitle(status, isAuthenticated)}
      >
        <SyncIcon
          syncing={isSyncing}
          error={hasError}
          pending={hasPending}
          offline={isOffline}
          authenticated={isAuthenticated}
          versionMismatch={hasVersionMismatch}
        />
      </button>

      {isOpen && (
        <SyncStatusModal onClose={() => setIsOpen(false)} />
      )}
    </>
  )
}

function SyncIcon({
  syncing,
  error,
  pending,
  offline,
  authenticated,
  versionMismatch,
}: {
  syncing: boolean
  error: boolean
  pending: boolean
  offline: boolean
  authenticated: boolean
  versionMismatch?: boolean
}) {
  // Version mismatch takes priority - show warning
  if (versionMismatch) {
    return <AlertCircle className="w-4 h-4" />
  }

  // Not authenticated - show cloud off (no sync available)
  if (!authenticated) {
    return <CloudOff className="w-4 h-4 opacity-50" />
  }

  if (offline) {
    return <CloudOff className="w-4 h-4" />
  }

  if (error) {
    return <AlertCircle className="w-4 h-4 text-destructive" />
  }

  if (syncing || pending) {
    return <Loader2 className={`w-4 h-4 ${syncing ? 'animate-spin' : 'animate-spin opacity-50'}`} />
  }

  return <Check className="w-4 h-4" />
}

function getStatusTitle(status: ReturnType<typeof useSyncStatus>, isAuthenticated: boolean): string {
  if (!isAuthenticated) return 'Sign in to sync across devices'
  if (!status.online) return 'Offline - changes saved locally'
  if (status.error) return `Sync error: ${status.error}`
  if (status.syncing) return 'Syncing...'
  if (status.pending > 0) return `${status.pending} changes pending`
  return `Synced${status.lastSync ? ` at ${new Date(status.lastSync).toLocaleTimeString()}` : ''}`
}

/**
 * Modal showing sync status and operation history
 */
function SyncStatusModal({ onClose }: { onClose: () => void }) {
  const status = useSyncStatus()
  const { forceSync, isAuthenticated, annotationVersionMismatch, onClearAnnotations, setAnnotationVersionMismatch } = useUserDataContext()

  const handleForceSync = async () => {
    await forceSync()
  }

  const handleClearHistory = () => {
    syncEngine.clearOperations()
  }

  const handleClearAnnotations = () => {
    if (onClearAnnotations) {
      onClearAnnotations()
      setAnnotationVersionMismatch(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Sync Status</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Version Mismatch Warning */}
        {annotationVersionMismatch && (
          <div className="px-4 py-3 border-b border-border bg-amber-500/10">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Page content has changed. Your annotations may not align correctly.
                </p>
                {onClearAnnotations && (
                  <button
                    onClick={handleClearAnnotations}
                    className="mt-2 px-3 py-1.5 text-xs rounded-md bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
                  >
                    Clear annotations
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Status Summary */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge status={status} />
          </div>

          {status.lastSync && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last sync</span>
              <span title={new Date(status.lastSync).toLocaleString()}>{getTimeAgo(new Date(status.lastSync))}</span>
            </div>
          )}

          {status.pending > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pending</span>
              <span>{status.pending} item{status.pending > 1 ? 's' : ''}</span>
            </div>
          )}

          {status.error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded px-2 py-1">
              {status.error}
            </div>
          )}

          {!isAuthenticated && (
            <div className="text-sm text-muted-foreground bg-muted rounded px-2 py-1">
              Sign in to sync your data across devices
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-2 border-b border-border flex gap-2">
          <button
            onClick={handleForceSync}
            disabled={!isAuthenticated || status.syncing || !status.online}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', status.syncing && 'animate-spin')} />
            Sync Now
          </button>
          {status.operations.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted"
            >
              Clear History
            </button>
          )}
        </div>

        {/* Operations List */}
        <div className="flex-1 overflow-auto">
          {status.operations.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No recent operations
            </div>
          ) : (
            <div className="divide-y divide-border">
              {status.operations.map((op) => (
                <OperationRow key={op.id} operation={op} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ReturnType<typeof useSyncStatus> }) {
  if (!status.online) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
        <CloudOff className="w-3 h-3" />
        Offline
      </span>
    )
  }

  if (status.error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-destructive/10 text-destructive">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    )
  }

  if (status.syncing) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
        <Loader2 className="w-3 h-3 animate-spin" />
        Syncing
      </span>
    )
  }

  if (status.pending > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Cloud className="w-3 h-3" />
        Pending
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-600 dark:text-green-400">
      <Check className="w-3 h-3" />
      Synced
    </span>
  )
}

function OperationRow({ operation }: { operation: SyncOperation }) {
  const getTypeLabel = (type: SyncOperation['type']) => {
    switch (type) {
      case 'sync': return 'Sync'
      case 'fetch': return 'Fetch'
      case 'merge': return 'Merge'
      case 'conflict': return 'Conflict'
      case 'error': return 'Error'
    }
  }

  const getStatusIcon = (status: SyncOperation['status']) => {
    switch (status) {
      case 'pending':
        return <Loader2 className="w-3 h-3 animate-spin text-primary" />
      case 'success':
        return <Check className="w-3 h-3 text-green-500" />
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-destructive" />
    }
  }

  const timeAgo = getTimeAgo(operation.timestamp)

  return (
    <div className="px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        {getStatusIcon(operation.status)}
        <span className="font-medium">{getTypeLabel(operation.type)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground truncate flex-1">{operation.adapter}</span>
        <span className="text-xs text-muted-foreground" title={new Date(operation.timestamp).toLocaleString()}>{timeAgo}</span>
      </div>
      {operation.message && (
        <div className="mt-0.5 text-xs text-muted-foreground pl-5 truncate">
          {operation.message}
        </div>
      )}
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)

  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Legacy exports for backwards compatibility
 */
export function SyncStatusIndicator({ className, alwaysShow = false }: { className?: string; alwaysShow?: boolean }) {
  const status = useSyncStatus()

  if (!alwaysShow && status.pending === 0 && !status.error && !status.syncing) {
    return null
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-lg transition-all',
        status.error
          ? 'bg-destructive/10 text-destructive border border-destructive/20'
          : status.syncing
            ? 'bg-primary/10 text-primary border border-primary/20'
            : !status.online
              ? 'bg-muted text-muted-foreground border border-border'
              : status.pending > 0
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                : 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20',
        className
      )}
    >
      <SyncIcon
        syncing={status.syncing}
        error={!!status.error}
        pending={status.pending > 0}
        offline={!status.online}
        authenticated={true}
      />
      <span>
        {!status.online ? 'Offline' :
         status.error ? 'Sync error' :
         status.syncing ? 'Syncing...' :
         status.pending > 0 ? `${status.pending} pending` : 'Synced'}
      </span>
    </div>
  )
}

export function SyncStatusDot({ className }: { className?: string }) {
  const status = useSyncStatus()

  const getColor = () => {
    if (!status.online) return 'bg-muted-foreground'
    if (status.error) return 'bg-destructive'
    if (status.syncing) return 'bg-primary animate-pulse'
    if (status.pending > 0) return 'bg-amber-500'
    return 'bg-green-500'
  }

  return (
    <div
      className={cn('h-2 w-2 rounded-full', getColor(), className)}
      title={getStatusTitle(status, true)}
    />
  )
}
