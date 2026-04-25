'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Dialog, DialogPortal, DialogOverlay, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Save } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import '@excalidraw/excalidraw/index.css'

// Types from Excalidraw - using minimal interface to avoid complex type imports
interface ExcalidrawImperativeAPI {
  getSceneElements: () => readonly unknown[]
  getFiles: () => Record<string, unknown>
  getAppState: () => Record<string, unknown>
}

// Dynamically import Excalidraw to avoid SSR issues
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(mod => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading Excalidraw...</div>
      </div>
    )
  }
)

interface ExcalidrawEditorProps {
  open: boolean
  onClose: () => void
  onSave: (name: string, excalidrawData: string, lightSvg: string, darkSvg: string) => Promise<void>
  skriptId?: string
  initialData?: {
    name: string
    elements: readonly unknown[]
    appState?: unknown
    files?: Record<string, unknown>  // Embedded images/files
  }
}

export function ExcalidrawEditor({
  open,
  onClose,
  onSave,
  initialData
}: ExcalidrawEditorProps) {
  const [drawingName, setDrawingName] = useState(initialData?.name || '')
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const { theme, systemTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [editorKey, setEditorKey] = useState(Date.now()) // Force remount on open
  const alert = useAlertDialog()

  // Get the actual theme (resolve 'system' to actual theme)
  const resolvedTheme = theme === 'system' ? systemTheme : theme
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    setMounted(true)
  }, [])

  // Reset editor key and drawing name when modal opens or initialData changes
  useEffect(() => {
    if (open) {
      setEditorKey(Date.now())
      setDrawingName(initialData?.name || '')
      setExcalidrawAPI(null) // Clear old API reference to prevent using stale API
    }
  }, [open, initialData])

  const handleSave = useCallback(async () => {
    if (!excalidrawAPI || !drawingName.trim()) {
      alert.showError('Please enter a drawing name')
      return
    }

    setIsSaving(true)
    try {
      // Get the current scene data
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()

      // Get embedded files (images, etc.)
      const files = excalidrawAPI.getFiles()

      // Create the Excalidraw data object (including embedded files)
      const excalidrawData = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements: elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
        files: files,  // Include embedded images
      }

      // Export to SVG for both light and dark themes
      const { exportToSvg } = await import('@excalidraw/excalidraw')

      // Light theme SVG
      const lightSvgElement = await exportToSvg({
        elements: elements,
        appState: {
          ...appState,
          exportBackground: false,
          exportWithDarkMode: false,
        },
        files: excalidrawAPI.getFiles(),
      })
      const lightSvg = lightSvgElement.outerHTML

      // Dark theme SVG
      const darkSvgElement = await exportToSvg({
        elements: elements,
        appState: {
          ...appState,
          exportBackground: false,
          exportWithDarkMode: true,
        },
        files: excalidrawAPI.getFiles(),
      })
      const darkSvg = darkSvgElement.outerHTML

      // Save all three files. The modal intentionally stays open after a
      // successful save so the user can keep iterating; only the X button
      // closes it (see DialogPrimitive.Content interactOutside/escape blocks).
      await onSave(
        drawingName.trim(),
        JSON.stringify(excalidrawData, null, 2),
        lightSvg,
        darkSvg
      )
    } catch (error) {
      console.error('Error saving drawing:', error)
      alert.showError('Failed to save drawing. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }, [excalidrawAPI, drawingName, alert, onSave, onClose])

  // Capture Ctrl+S to save the drawing instead of downloading the file
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        e.stopPropagation()
        // Only save if we have an API and a drawing name
        if (excalidrawAPI && drawingName.trim() && !isSaving) {
          handleSave()
        }
      }
    }

    // Use capture phase to intercept before Excalidraw handles it
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [open, excalidrawAPI, drawingName, isSaving, handleSave])

  if (!mounted) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* Use flexbox centering instead of CSS transform centering.
         Transforms create a new coordinate space that shifts Excalidraw's
         pointer events by ~100px, causing cursor offset issues. */}
      <DialogPortal>
        <DialogOverlay className="flex items-center justify-center">
          <DialogPrimitive.Content
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            className="z-50 w-[1400px] h-[900px] max-w-[95vw] max-h-[95vh] border bg-background shadow-lg sm:rounded-lg p-0 flex flex-col relative"
          >
            <DialogHeader className="p-4 border-b border-border shrink-0">
              <DialogTitle>Edit Drawing</DialogTitle>
              <div className="flex items-center gap-4 mt-4">
                <div className="flex-1">
                  <Label htmlFor="drawing-name">Drawing Name</Label>
                  <Input
                    id="drawing-name"
                    value={drawingName}
                    onChange={(e) => setDrawingName(e.target.value)}
                    placeholder="my-drawing"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Will be saved as: {drawingName || 'my-drawing'}.excalidraw
                  </p>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !drawingName.trim()}
                  className="mt-6"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Drawing'}
                </Button>
              </div>
            </DialogHeader>

            <div className="flex-1 min-h-0">
              {open && (
                <Excalidraw
                  key={editorKey} // Force remount with latest data on every open
                  excalidrawAPI={(api) => setExcalidrawAPI(api as ExcalidrawImperativeAPI)}
                  initialData={(initialData ? {
                    elements: initialData.elements,
                    appState: initialData.appState,
                    files: initialData.files,  // Include embedded images
                  } : undefined) as never}
                  theme={isDark ? 'dark' : 'light'}
                />
              )}
            </div>

            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogOverlay>
      </DialogPortal>
      <AlertDialogModal
        open={alert.open}
        onOpenChange={alert.setOpen}
        type={alert.type}
        title={alert.title}
        message={alert.message}
      />
    </Dialog>
  )
}
