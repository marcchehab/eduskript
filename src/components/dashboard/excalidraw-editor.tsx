'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

  const handleSave = async () => {
    if (!excalidrawAPI || !drawingName.trim()) {
      alert.showError('Please enter a drawing name')
      return
    }

    setIsSaving(true)
    try {
      // Get the current scene data
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()

      // Create the Excalidraw data object
      const excalidrawData = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements: elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
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

      // Save all three files
      await onSave(
        drawingName.trim(),
        JSON.stringify(excalidrawData, null, 2),
        lightSvg,
        darkSvg
      )

      onClose()
    } catch (error) {
      console.error('Error saving drawing:', error)
      alert.showError('Failed to save drawing. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[1400px] h-[900px] p-0 flex flex-col">
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
              } : undefined) as never}
              theme={isDark ? 'dark' : 'light'}
            />
          )}
        </div>
      </DialogContent>
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
