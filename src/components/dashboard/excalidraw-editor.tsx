'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AlertDialogModal } from '@/components/ui/alert-dialog-modal'
import { useAlertDialog } from '@/hooks/use-alert-dialog'
import { Dialog, DialogPortal, DialogOverlay, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X, Save, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import '@excalidraw/excalidraw/index.css'

// Types from Excalidraw - using minimal interface to avoid complex type imports
interface ExcalidrawImperativeAPI {
  getSceneElements: () => readonly unknown[]
  getFiles: () => Record<string, unknown>
  getAppState: () => Record<string, unknown>
  updateScene: (data: { elements?: readonly unknown[] }) => void
  addFiles: (files: unknown[]) => void
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
  onSave: (
    name: string,
    excalidrawData: string,
    lightSvg: string,
    darkSvg: string,
    /** Original filename the drawing was loaded as, or undefined for new drawings.
     *  The server uses this to detect overwrite intent vs accidental name collisions. */
    originalName: string | undefined,
  ) => Promise<void>
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
  // AI prompt panel state. Hidden until the user clicks "Generate with AI".
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [aiPrompt, setAIPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

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
      setShowAIPanel(false)
      setAIPrompt('')
    }
  }, [open, initialData])

  const handleGenerate = useCallback(async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || !excalidrawAPI) return

    // Replace-confirm if there's already content on the canvas. Mermaid output
    // overwrites the scene wholesale; there's no merge.
    const existing = excalidrawAPI.getSceneElements()
    if (existing.length > 0) {
      const ok = window.confirm(
        'This will replace the current drawing with an AI-generated one. Continue?'
      )
      if (!ok) return
    }

    setIsGenerating(true)
    try {
      const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
        import('@excalidraw/mermaid-to-excalidraw'),
        import('@excalidraw/excalidraw'),
      ])

      type RetryWith = { mermaid: string; error: string } | undefined
      const requestMermaid = async (retryWith: RetryWith): Promise<string> => {
        const res = await fetch('/api/ai/excalidraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, ...(retryWith ? { retryWith } : {}) }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Request failed (${res.status})`)
        }
        const { mermaid } = (await res.json()) as { mermaid: string }
        if (!mermaid) throw new Error('AI returned no diagram')
        return mermaid
      }

      let mermaid = await requestMermaid(undefined)
      let parsed: Awaited<ReturnType<typeof parseMermaidToExcalidraw>>
      try {
        parsed = await parseMermaidToExcalidraw(mermaid)
      } catch (firstErr) {
        // One retry with the failed diagram + parser error so the model can fix it.
        // If the retry itself fails (empty response, second parse error, network),
        // surface the ORIGINAL Mermaid parse error — that's the actionable one.
        const firstErrMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
        console.warn('Mermaid parse failed; retrying with error feedback', firstErrMsg)
        try {
          mermaid = await requestMermaid({ mermaid, error: firstErrMsg })
          parsed = await parseMermaidToExcalidraw(mermaid)
        } catch (retryErr) {
          console.warn('Retry also failed', retryErr)
          throw new Error(`Diagram syntax error (and AI couldn't fix it): ${firstErrMsg}`)
        }
      }

      const elements = convertToExcalidrawElements(parsed.elements)
      excalidrawAPI.updateScene({ elements })
      if (parsed.files) {
        const fileArray = Object.values(parsed.files)
        if (fileArray.length > 0) excalidrawAPI.addFiles(fileArray)
      }
      setShowAIPanel(false)
    } catch (error) {
      console.error('AI generate error:', error)
      const msg = error instanceof Error ? error.message : 'Failed to generate diagram'
      alert.showError(msg)
    } finally {
      setIsGenerating(false)
    }
  }, [aiPrompt, excalidrawAPI, alert])

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
        darkSvg,
        initialData?.name,
      )
    } catch (error) {
      console.error('Error saving drawing:', error)
      const msg = error instanceof Error ? error.message : 'Failed to save drawing. Please try again.'
      alert.showError(msg)
    } finally {
      setIsSaving(false)
    }
  }, [excalidrawAPI, drawingName, alert, onSave, initialData?.name])

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
              <div className="mt-4">
                <Label htmlFor="drawing-name">Drawing Name</Label>
                <div className="flex items-start gap-4 mt-1">
                  <div className="flex-1">
                    <Input
                      id="drawing-name"
                      value={drawingName}
                      onChange={(e) => setDrawingName(e.target.value)}
                      placeholder="my-drawing"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Will be saved as: {drawingName || 'my-drawing'}.excalidraw
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowAIPanel(v => !v)}
                    title="Generate a diagram from a prompt"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate with AI
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving || !drawingName.trim()}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {isSaving ? 'Saving...' : 'Save Drawing'}
                  </Button>
                </div>
              </div>
              {showAIPanel && (
                <div className="mt-4 p-3 border border-border rounded-md bg-muted/30">
                  <Label htmlFor="ai-prompt">Describe the diagram</Label>
                  <Textarea
                    id="ai-prompt"
                    value={aiPrompt}
                    onChange={(e) => setAIPrompt(e.target.value)}
                    placeholder="e.g. flowchart for user signup; ER diagram for blog (users, posts, comments); sequence diagram for OAuth login. Works best for flowcharts, sequence/class/state/ER diagrams, mind maps."
                    rows={3}
                    className="mt-1"
                    disabled={isGenerating}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      size="sm"
                      onClick={handleGenerate}
                      disabled={isGenerating || !aiPrompt.trim() || !excalidrawAPI}
                    >
                      {isGenerating ? 'Generating...' : 'Generate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAIPanel(false)}
                      disabled={isGenerating}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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
