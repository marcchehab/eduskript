'use client'

import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ImageLightboxProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

// Portals to document.body so the overlay escapes the public reader's
// `transform: scale()` zoom on `#paper` — without this, `position: fixed`
// is contained by the transformed ancestor and the overlay covers the
// scaled paper instead of the real viewport.
export function ImageLightbox({ open, onClose, children }: ImageLightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, handleKeyDown])

  if (!open || typeof window === 'undefined') return null

  const overlay = (
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center p-4 sm:p-8 cursor-zoom-out"
      onClick={onClose}
      style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(0,0,0,0.75)' }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="w-full h-full flex items-center justify-center pointer-events-none">
        {children}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
