'use client'

import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Wrench, Trash2, Loader2 } from 'lucide-react'
import { userDataService } from '@/lib/userdata'

interface AdminToolboxProps {
  pageId?: string
}

export function AdminToolbox({ pageId }: AdminToolboxProps) {
  const { data: session, status } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Only render after hydration to avoid mismatch
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setShowConfirm(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleClearPageData = async () => {
    if (!pageId) return

    if (!showConfirm) {
      setShowConfirm(true)
      setTimeout(() => setShowConfirm(false), 3000)
      return
    }

    setIsClearing(true)
    setShowConfirm(false)

    try {
      // Clear IndexedDB data for this page
      await userDataService.deleteAllForPage(pageId)
      console.log('[Admin] Cleared IndexedDB data for page:', pageId)

      // Clear server-side data
      const response = await fetch(`/api/dev/clear-page-data?pageId=${pageId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        const result = await response.json()
        console.log('[Admin] Cleared server data:', result)
      } else {
        console.error('[Admin] Failed to clear server data:', await response.text())
      }

      // Reload to reset state
      window.location.reload()
    } catch (error) {
      console.error('[Admin] Failed to clear data:', error)
      setIsClearing(false)
    }
  }

  // Don't render during SSR or until session is loaded, to avoid hydration mismatch
  if (!isMounted || status === 'loading') {
    return null
  }

  // Only show for admins
  if (!session?.user?.isAdmin) {
    return null
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Admin Tools"
      >
        <Wrench className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="py-1">
            <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
              Admin Tools
            </div>

            {pageId && (
              <button
                onClick={handleClearPageData}
                disabled={isClearing}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors
                  ${showConfirm
                    ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                {isClearing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Clearing...</span>
                  </>
                ) : showConfirm ? (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>Click again to confirm</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>Clear Page Data</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
