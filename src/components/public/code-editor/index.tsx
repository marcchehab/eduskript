"use client"

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Annotation } from '@codemirror/state'
import { indentWithTab, undo } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { sql } from '@codemirror/lang-sql'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { pythonCompletions } from './python-completions'
import { Button } from '@/components/ui/button'
import { Play, Square, RotateCcw, Maximize2, Minimize2, Camera, X, Plus, FileText, ZoomIn, ZoomOut, Save, History } from 'lucide-react'
import { useUserData, useCreateVersion, useVersionHistory, useRestoreVersion, useDeleteVersion, useUpdateVersionLabel } from '@/lib/userdata/hooks'
import type { CodeEditorData } from '@/lib/userdata/types'
import {
  RunState,
  OutputLevel,
  OutputEntry,
  PythonFile,
  SkulptError,
  SkulptConfig,
  SqlResultSet
} from './types'

interface CodeEditorProps {
  id?: string
  pageId?: string
  language?: 'python' | 'javascript' | 'sql'
  initialCode?: string
  showCanvas?: boolean
  db?: string // Path to SQL database for SQL language
  schemaImage?: string // Optional schema image for SQL
  singleFile?: boolean // Hide file tabs for simple single-file examples
}

// Custom annotation to mark programmatic changes (defined once outside component)
const programmaticChange = Annotation.define<boolean>()

export const CodeEditor = memo(function CodeEditor({
  id = 'code-editor',
  pageId,
  language = 'python',
  initialCode = '# Write your code here\nprint("Hello, World!")',
  showCanvas = true,
  db = '/sql/netflixdb.sqlite',
  schemaImage,
  singleFile = false
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [runState, setRunState] = useState<RunState>(RunState.STOPPED)
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [fullscreen, setFullscreen] = useState(false)

  // User data persistence - only if pageId is provided
  const componentId = `code-editor-${id}`
  const { data: savedData, updateData: savePersistentData, isLoading } = useUserData<CodeEditorData>(
    pageId || 'no-page', // Fallback if no pageId
    componentId,
    null
  )

  // Version history hooks
  const createVersion = useCreateVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { versions, isLoading: versionsLoading, refresh: refreshVersions } = useVersionHistory(pageId || 'no-page', componentId)
  const { restore, isRestoring } = useRestoreVersion<CodeEditorData>(pageId || 'no-page', componentId)
  const { deleteVersion, isDeleting } = useDeleteVersion(pageId || 'no-page', componentId)
  const updateLabel = useUpdateVersionLabel(pageId || 'no-page', componentId)

  // Output/History panel state
  const [activePanel, setActivePanel] = useState<'output' | 'history'>('output')
  const [panelVisible, setPanelVisible] = useState(false)
  const [highlightedVersion, setHighlightedVersion] = useState<number | null>(null)
  const [editingVersion, setEditingVersion] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState<string>('')
  const [confirmDeletion, setConfirmDeletion] = useState(false)
  const [showAutosaves, setShowAutosaves] = useState(false)

  // Keystroke counter for version creation
  const keystrokeCountRef = useRef(0)

  // Helper to get file extension based on language
  const getFileExtension = (lang: 'python' | 'javascript' | 'sql'): string => {
    switch (lang) {
      case 'python': return '.py'
      case 'javascript': return '.js'
      case 'sql': return '.sql'
    }
  }

  // Initialize default data
  const defaultData: CodeEditorData = {
    files: [{ name: `main${getFileExtension(language)}`, content: initialCode }],
    activeFileIndex: 0,
    fontSize: 14,
    editorWidth: 50,
  }

  // Resizable panel state (horizontal splitter between editor and graphics)
  const [editorWidth, setEditorWidth] = useState<number>(defaultData.editorWidth ?? 50)
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const MIN_VISIBLE_WIDTH = 100 // pixels

  // Resizable output panel state (vertical splitter between main content and output)
  const [outputPanelHeight, setOutputPanelHeight] = useState(220) // default height in pixels
  const [isDraggingHorizontalSplitter, setIsDraggingHorizontalSplitter] = useState(false)
  const MIN_OUTPUT_HEIGHT = 0 // allow collapsing completely
  const MAX_OUTPUT_HEIGHT = 400 // maximum output panel height

  // Run button success flash state
  const [showSuccessFlash, setShowSuccessFlash] = useState(false)

  // Python kernel state
  const [activeKernel, setActiveKernel] = useState<'skulpt' | 'pyodide' | null>(null)
  const [kernelLoading, setKernelLoading] = useState(false)
  const [showKernelMenu, setShowKernelMenu] = useState(false)
  const [kernelMenuPosition, setKernelMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const kernelButtonRef = useRef<HTMLButtonElement>(null)
  const kernelMenuRef = useRef<HTMLDivElement>(null)

  // Close kernel menu when clicking outside
  useEffect(() => {
    if (!showKernelMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (kernelMenuRef.current && !kernelMenuRef.current.contains(e.target as Node)) {
        setShowKernelMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showKernelMenu])

  // Manual resize handle state (bottom-right corner)
  const [manualHeight, setManualHeight] = useState<number | null>(null) // null = use auto-height
  const [isDraggingResize, setIsDraggingResize] = useState(false)

  // Auto-height constants
  const LINE_HEIGHT = 20 // approximate line height in pixels
  const MIN_EDITOR_HEIGHT = 200 // minimum height for the editor component
  const MAX_EDITOR_HEIGHT = 600 // maximum height before scrolling

  // Multi-file support
  const [files, setFiles] = useState<PythonFile[]>(defaultData.files)
  const [activeFileIndex, setActiveFileIndex] = useState(defaultData.activeFileIndex)
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Calculate visibility based on width and detect graphics modules (turtle or matplotlib) or SQL schema
  const currentCode = files[activeFileIndex]?.content || initialCode
  const hasTurtleModule = language === 'python' && /import\s+turtle|from\s+turtle/.test(currentCode)
  const hasMatplotlib = language === 'python' && /import\s+matplotlib|from\s+matplotlib/.test(currentCode)
  // SQL schema: provided via schemaImage prop (auto-detected in markdown renderer)
  const hasSqlSchema = language === 'sql' && !!schemaImage
  const hasGraphics = hasTurtleModule || hasMatplotlib || hasSqlSchema
  const showEditor = containerRef.current ? (editorWidth / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const showGraphics = containerRef.current ? ((100 - editorWidth) / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const [canvasVisible, setCanvasVisible] = useState(false) // Start hidden, show only when graphics detected

  // Calculate auto-height based on number of lines in the code (editor area only, output adds separately)
  const lineCount = currentCode.split('\n').length
  const fileTabsHeight = singleFile ? 0 : 36 // height of file tabs row
  const calculatedEditorHeight = Math.max(
    MIN_EDITOR_HEIGHT,
    Math.min(MAX_EDITOR_HEIGHT, lineCount * LINE_HEIGHT + fileTabsHeight + 60) // 60px for controls
  )
  // User-adjusted editor height (set when dragging horizontal splitter, keeps total constant)
  const [userEditorHeight, setUserEditorHeight] = useState<number | null>(null)
  const editorHeight = userEditorHeight ?? calculatedEditorHeight
  // Output panel adds to total height when visible
  const totalHeight = editorHeight + (panelVisible ? outputPanelHeight + 4 : 0) // +4 for horizontal splitter

  // Font size state
  const [fontSize, setFontSize] = useState<number>(defaultData.fontSize ?? 14)

  // Canvas pan and zoom state
  const [canvasTransform, setCanvasTransform] = useState(defaultData.canvasTransform ?? { x: 0, y: 0, scale: 1 })

  // Store the original initial code for reset functionality
  // This is the source of truth from the markdown and should never change
  const originalInitialCode = useRef(initialCode)
  const hasLoadedData = useRef(false)

  // Update original code when initialCode prop changes (markdown was edited)
  useEffect(() => {
    originalInitialCode.current = initialCode
  }, [initialCode])

  useEffect(() => {
    // Only restore once when data first loads
    if (!isLoading && savedData && !hasLoadedData.current) {
      hasLoadedData.current = true

      // Check if the markdown content has changed since the data was saved
      // If the first file's content from saved data matches the original initialCode,
      // it's safe to restore. Otherwise, prefer the new markdown content.
      const savedFirstFileContent = savedData.files?.[0]?.content
      const markdownHasChanged = savedFirstFileContent && savedFirstFileContent !== initialCode

      if (markdownHasChanged) {
        // Markdown was updated - don't restore old saved content
        // But do restore other settings like fontSize, editorWidth, etc.
        console.log('Markdown content changed - using new content from page')
        if (savedData.fontSize !== undefined) setFontSize(savedData.fontSize)
        if (savedData.editorWidth !== undefined) setEditorWidth(savedData.editorWidth)
        if (savedData.canvasTransform) setCanvasTransform(savedData.canvasTransform)
      } else {
        // Markdown unchanged - safe to restore everything
        if (savedData.files) setFiles(savedData.files)
        if (savedData.activeFileIndex !== undefined) setActiveFileIndex(savedData.activeFileIndex)
        if (savedData.fontSize !== undefined) setFontSize(savedData.fontSize)
        if (savedData.editorWidth !== undefined) setEditorWidth(savedData.editorWidth)
        if (savedData.canvasTransform) setCanvasTransform(savedData.canvasTransform)
      }
    }
  }, [isLoading, savedData, componentId, pageId, initialCode])
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // Refs
  const editorRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const outputPanelRef = useRef<HTMLDivElement>(null)

  // Update canvas visibility based on graphics module detection
  useEffect(() => {
    setCanvasVisible(hasGraphics)
  }, [hasGraphics])

  // Debounced auto-save for code content changes
  const contentSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const debouncedSaveContent = useCallback(() => {
    if (!editorViewRef.current) return

    const content = editorViewRef.current.state.doc.toString()
    setFiles(prev => prev.map((file, idx) =>
      idx === activeFileIndex ? { ...file, content } : file
    ))
  }, [activeFileIndex])

  // Save data to IndexedDB when anything changes
  // Files changes are debounced via the update listener, settings changes are immediate
  useEffect(() => {
    // Only save if pageId is provided (not in fallback mode)
    if (!pageId) return

    // Don't save during initial load - wait until data has been loaded/restored
    if (isLoading) {
      return
    }

    const dataToSave: CodeEditorData = {
      files,
      activeFileIndex,
      fontSize,
      editorWidth,
      canvasTransform,
    }

    // Save immediately (debouncing already happened at the update listener level for content)
    savePersistentData(dataToSave, { immediate: true })
  }, [activeFileIndex, fontSize, editorWidth, canvasTransform, pageId, savePersistentData, files, componentId, isLoading])

  // Helper function to create a version snapshot
  const createVersionSnapshot = useCallback(async (isManualSave = false) => {
    if (!pageId) return

    const dataToVersion: CodeEditorData = {
      files,
      activeFileIndex,
      fontSize,
      editorWidth,
      canvasTransform,
    }

    // Don't create version if content matches initial/default code
    const currentContent = files.map(f => f.content).join('\n')
    const isDefaultContent = currentContent === initialCode || currentContent.trim() === ''
    if (isDefaultContent) {
      keystrokeCountRef.current = 0
      return
    }

    // Note: Duplicate detection is handled by the service layer via SHA-256 hashing
    // If the data is identical to a previous version, it will reuse the same blob
    const version = await createVersion(dataToVersion, { isManualSave })
    await refreshVersions()
    keystrokeCountRef.current = 0 // Reset counter after creating version

    // Only open history tab for manual saves
    if (isManualSave) {
      setActivePanel('history')
      setHighlightedVersion(version.versionNumber)
      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedVersion(null), 2000)
    }
  }, [pageId, files, activeFileIndex, fontSize, editorWidth, canvasTransform, createVersion, refreshVersions, initialCode])

  // Handle splitter dragging
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingSplitter) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newEditorWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Clamp between 5% and 95%
      setEditorWidth(Math.max(5, Math.min(95, newEditorWidth)))
    }

    const handleMouseUp = () => {
      setIsDraggingSplitter(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingSplitter])

  // Handle horizontal splitter dragging (between main content and output panel)
  const handleHorizontalSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingHorizontalSplitter(true)
  }

  useEffect(() => {
    if (!isDraggingHorizontalSplitter) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!wrapperRef.current) return

      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      const currentTotalHeight = wrapperRect.height

      // Calculate new output height from cursor position
      const newOutputHeight = Math.max(MIN_OUTPUT_HEIGHT, Math.min(MAX_OUTPUT_HEIGHT, wrapperRect.bottom - e.clientY))

      // Calculate new editor height to keep total constant
      const splitterHeight = 4
      const newEditorHeight = currentTotalHeight - newOutputHeight - splitterHeight

      // Only apply if editor height is reasonable
      if (newEditorHeight >= MIN_EDITOR_HEIGHT) {
        setOutputPanelHeight(newOutputHeight)
        setUserEditorHeight(newEditorHeight)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingHorizontalSplitter(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingHorizontalSplitter])

  // Handle resize handle dragging (bottom-right corner)
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingResize(true)
  }

  useEffect(() => {
    if (!isDraggingResize) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!wrapperRef.current) return

      const wrapperRect = wrapperRef.current.getBoundingClientRect()
      // Calculate new height based on mouse position relative to wrapper top
      const newHeight = e.clientY - wrapperRect.top

      // Clamp between min and a reasonable max
      setManualHeight(Math.max(MIN_EDITOR_HEIGHT, Math.min(800, newHeight)))
    }

    const handleMouseUp = () => {
      setIsDraggingResize(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingResize])

  // Wait for theme to hydrate
  useEffect(() => {
    setMounted(true)
  }, [])

  // Load SQL database when in SQL mode
  useEffect(() => {
    if (language === 'sql' && db && mounted) {
      // Dynamic import to avoid SSR issues
      import('@/lib/sql-executor.client').then(({ loadDatabase }) => {
        loadDatabase(db).catch((error) => {
          addOutput(`Failed to load database: ${error.message}`, OutputLevel.ERROR)
        })
      })
    }
  }, [language, db, mounted])

  // Display schema image in graphics pane for SQL mode (if provided)
  // Note: Schemas are now Excalidraw drawings stored with databases in the file system
  // Users create schemas via the "Create Schema" button in the file browser
  useEffect(() => {
    if (language === 'sql' && mounted && canvasRef.current && schemaImage) {
      // Check if schema image exists
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return

        canvas.innerHTML = '' // Clear any existing content

        // Create and append the schema image
        const schemaImg = document.createElement('img')
        schemaImg.src = schemaImage
        schemaImg.alt = 'Database Schema'
        schemaImg.style.width = '100%'
        schemaImg.style.height = 'auto'
        schemaImg.style.display = 'block'
        schemaImg.style.pointerEvents = 'none' // Prevent image from capturing drag events
        schemaImg.draggable = false // Disable browser's default image drag
        schemaImg.className = 'sql-schema-image'

        canvas.appendChild(schemaImg)

        // Make the graphics pane visible (only set width on first show)
        setCanvasVisible(prev => {
          if (!prev) {
            // First time showing canvas - set 50/50 split
            setEditorWidth(50)
          }
          return true
        })
      }

      img.onerror = () => {
        // Schema image doesn't exist, hide graphics pane
        setCanvasVisible(false)
      }

      img.src = schemaImage
    }
  }, [language, schemaImage, mounted])

  // Lazy load Pyodide on first run
  const ensurePyodideLoaded = async () => {
    // Return existing promise if already loading/loaded
    if ((window as any).__pyodidePromise) {
      setActiveKernel('pyodide')
      return (window as any).__pyodidePromise
    }

    // Start loading
    setKernelLoading(true)

    try {
      // Load Pyodide script if not already present
      if (!document.querySelector('script[src*="pyodide.js"]')) {
        const script = document.createElement('script')
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/pyodide.js'

        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load Pyodide'))
          document.body.appendChild(script)
        })
      }

      // Initialize Pyodide
      if (!(window as any).__pyodidePromise) {
        ;(window as any).__pyodidePromise = (window as any).loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/'
        })
      }

      const pyodide = await (window as any).__pyodidePromise
      console.log('[Pyodide] Loaded successfully', pyodide.version)
      setActiveKernel('pyodide')
      setKernelLoading(false)
      return pyodide
    } catch (error) {
      console.error('[Pyodide] Failed to load:', error)
      setKernelLoading(false)
      addOutput('Failed to load Python runtime', OutputLevel.ERROR)
      throw error
    }
  }

  // Lazy load Skulpt on first run
  const ensureSkulptLoaded = async () => {
    // Check if already loaded
    if (window.Sk) {
      setActiveKernel('skulpt')
      return
    }

    // Global promise cache to prevent loading scripts multiple times
    const scriptPromises = (window as any).__skulptPromises || {}
    if (!(window as any).__skulptPromises) {
      (window as any).__skulptPromises = scriptPromises
    }

    const loadScript = (src: string): Promise<void> => {
      // Return existing promise if already loading/loaded
      if (scriptPromises[src]) {
        return scriptPromises[src]
      }

      // Create new loading promise
      scriptPromises[src] = new Promise<void>((resolve, reject) => {
        // Check if script already exists in DOM
        const existing = document.querySelector(`script[src="${src}"]`)
        if (existing) {
          // Script tag exists, assume it's loaded (or will be)
          setTimeout(() => resolve(), 10)
          return
        }

        const script = document.createElement('script')
        script.src = src
        script.onload = () => resolve()
        script.onerror = () => {
          console.error(`[Skulpt] Failed to load ${src}`)
          delete scriptPromises[src] // Allow retry on error
          reject(new Error(`Failed to load ${src}`))
        }
        document.body.appendChild(script)
      })

      return scriptPromises[src]
    }

    setKernelLoading(true)

    try {
      await loadScript('/js/skulpt.min.js')
      await loadScript('/js/skulpt-stdlib.js')
      console.log('[Skulpt] Loaded successfully')
      setActiveKernel('skulpt')
      setKernelLoading(false)
    } catch (error) {
      console.error('[Skulpt] Failed to load:', error)
      setKernelLoading(false)
      addOutput('Failed to load Python runtime', OutputLevel.ERROR)
      throw error
    }
  }

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current || !mounted) return

    const isDark = resolvedTheme === 'dark'

    // Select language extension
    const langExtension = language === 'python'
      ? python()
      : language === 'sql'
      ? sql()
      : javascript()

    const extensions = [
      basicSetup,
      keymap.of([
        indentWithTab, // Enable Tab/Shift+Tab for indentation
        { key: 'Mod-z', run: undo }, // Enable Ctrl+Z (Cmd+Z on Mac) for undo
      ]),
      langExtension,
      EditorView.theme({
        '&': {
          height: '100%',
          width: '100%'
        },
        '.cm-scroller': {
          overflow: 'auto'
        },
        '.cm-content': {
          fontSize: `${fontSize}px`
        }
      }, { dark: isDark }),
    ]

    // Add Python autocomplete for Python files
    if (language === 'python') {
      extensions.push(
        autocompletion({
          override: [pythonCompletions],
          activateOnTyping: true,
          maxRenderedOptions: 20,
          // Trigger completion on dot for attribute access
          activateOnCompletion: (completion) => /^[a-zA-Z_]/.test(completion.label),
        })
      )
    }

    // Add VSCode theme (light or dark)
    extensions.push(isDark ? vsCodeDark : vsCodeLight)

    // Add update listener for auto-save
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Check if any transaction is marked as programmatic
          const isProgrammatic = update.transactions.some(tr => tr.annotation(programmaticChange))

          // Only trigger save and version creation on user input (not programmatic changes)
          if (!isProgrammatic) {
            // Increment keystroke counter
            keystrokeCountRef.current++

            // Create version every 5 keystrokes
            if (keystrokeCountRef.current >= 5) {
              createVersionSnapshot()
            }

            // Clear existing timeout
            if (contentSaveTimeoutRef.current) {
              clearTimeout(contentSaveTimeoutRef.current)
            }

            // Debounce save by 2 seconds after typing stops
            contentSaveTimeoutRef.current = setTimeout(() => {
              debouncedSaveContent()
            }, 2000)
          }
        }
      })
    )

    // Clean up previous editor
    if (editorViewRef.current) {
      editorViewRef.current.destroy()
    }

    const state = EditorState.create({
      doc: files[activeFileIndex]?.content || initialCode,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    editorViewRef.current = view

    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
      // Clear any pending auto-save
      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current)
      }
    }
  }, [mounted, resolvedTheme, language, initialCode, fontSize, debouncedSaveContent, activeFileIndex, createVersionSnapshot, files])

  // Attach non-passive wheel event listener to prevent page scroll
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.max(0.1, Math.min(5, canvasTransform.scale * delta))

      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const canvasX = (mouseX - canvasTransform.x) / canvasTransform.scale
      const canvasY = (mouseY - canvasTransform.y) / canvasTransform.scale

      const newX = mouseX - canvasX * newScale
      const newY = mouseY - canvasY * newScale

      setCanvasTransform({
        x: newX,
        y: newY,
        scale: newScale
      })
    }

    // Add listener with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [canvasTransform])

  // Prevent editor scroll from propagating to page
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    // Find the CodeMirror scroller element (the actual scrollable container)
    const scroller = editor.querySelector('.cm-scroller') as HTMLElement
    if (!scroller) return

    const handleWheel = (e: WheelEvent) => {
      // Only stop propagation if we're not at the scroll boundary
      const { scrollTop, scrollHeight, clientHeight } = scroller
      const isAtTop = scrollTop === 0 && e.deltaY < 0
      const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0

      // Stop propagation unless we're at a boundary and trying to scroll further
      if (!isAtTop && !isAtBottom) {
        e.stopPropagation()
      }
    }

    scroller.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      scroller.removeEventListener('wheel', handleWheel)
    }
  }, [mounted])

  // Handle output panel wheel scroll explicitly
  // CSS overscroll-behavior alone doesn't work when parent handlers use passive: false
  useEffect(() => {
    const outputPanel = outputPanelRef.current
    if (!outputPanel) return

    const handleWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = outputPanel
      const isScrollable = scrollHeight > clientHeight

      if (!isScrollable) return // Let page scroll if content doesn't need scrolling

      // Manually scroll the output panel
      outputPanel.scrollTop += e.deltaY

      // Prevent page scroll when output is scrollable
      e.preventDefault()
      e.stopPropagation()
    }

    outputPanel.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      outputPanel.removeEventListener('wheel', handleWheel)
    }
  }, [output.length, activePanel]) // Re-attach when output changes or panel switches

  // Add output helper
  const addOutput = (message: string, level: OutputLevel = OutputLevel.OUTPUT) => {
    setOutput((prev) => [...prev, { message, level, timestamp: Date.now() }])
    setPanelVisible(true)
    setActivePanel('output')
  }

  // Save current file content
  const saveCurrentFile = () => {
    if (editorViewRef.current) {
      const content = editorViewRef.current.state.doc.toString()
      setFiles(prev => prev.map((file, idx) =>
        idx === activeFileIndex ? { ...file, content } : file
      ))
    }
  }

  // Switch to a different file
  const switchToFile = (index: number) => {
    saveCurrentFile()
    setActiveFileIndex(index)
  }

  // Add a new file
  const addNewFile = () => {
    const fileNumber = files.length + 1
    const ext = getFileExtension(language)
    const newFile: PythonFile = {
      name: `file${fileNumber}${ext}`,
      content: language === 'sql' ? '-- New file\n' : '# New file\n'
    }
    setFiles(prev => [...prev, newFile])
    setActiveFileIndex(files.length)
  }

  // Remove a file
  const removeFile = (index: number) => {
    if (files.length === 1) {
      addOutput('Cannot remove the last file', OutputLevel.WARNING)
      return
    }
    setFiles(prev => prev.filter((_, idx) => idx !== index))
    if (activeFileIndex >= index && activeFileIndex > 0) {
      setActiveFileIndex(prev => prev - 1)
    }
  }

  // Start renaming a file
  const startRename = (index: number) => {
    setRenamingIndex(index)
    const ext = getFileExtension(language)
    const extPattern = new RegExp(`\\${ext}$`)
    setRenameValue(files[index].name.replace(extPattern, ''))
  }

  // Confirm rename
  const confirmRename = (index: number) => {
    if (!renameValue.trim()) {
      setRenamingIndex(null)
      return
    }

    const ext = getFileExtension(language)
    const newName = renameValue.trim().endsWith(ext)
      ? renameValue.trim()
      : renameValue.trim() + ext

    // Check for duplicate names
    if (files.some((f, idx) => idx !== index && f.name === newName)) {
      addOutput('A file with that name already exists', OutputLevel.WARNING)
      return
    }

    setFiles(prev => prev.map((file, idx) =>
      idx === index ? { ...file, name: newName } : file
    ))
    setRenamingIndex(null)
  }

  // Cancel rename
  const cancelRename = () => {
    setRenamingIndex(null)
    setRenameValue('')
  }

  // Font size controls
  const increaseFontSize = () => {
    setFontSize(prev => Math.min(prev + 2, 32)) // Max 32px
  }

  const decreaseFontSize = () => {
    setFontSize(prev => Math.max(prev - 2, 8)) // Min 8px
  }

  // Update editor when active file changes
  useEffect(() => {
    if (editorViewRef.current && files[activeFileIndex]) {
      const content = files[activeFileIndex].content
      const view = editorViewRef.current
      const transaction = view.state.update({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content
        },
        annotations: programmaticChange.of(true)
      })
      view.dispatch(transaction)
    }
  }, [activeFileIndex, files])

  // Run code
  const runCode = () => {
    if (!editorViewRef.current) return

    // Save current file before running
    saveCurrentFile()

    const code = editorViewRef.current.state.doc.toString()

    if (language === 'python') {
      // Decide which runtime to use based on current editor content (not saved state)
      // This allows switching between Skulpt and Pyodide when code changes
      const hasTurtle = /import\s+turtle|from\s+turtle/.test(code)

      if (hasTurtle) {
        runPythonCode(code) // Use Skulpt for turtle
      } else {
        runPyodideCode(code) // Use Pyodide for everything else (including matplotlib)
      }
    } else if (language === 'sql') {
      runSqlQuery(code)
    } else if (language === 'javascript') {
      // TODO: Implement JavaScript execution
      addOutput('JavaScript execution not yet implemented', OutputLevel.ERROR)
    }
  }

  // Run SQL query
  const runSqlQuery = async (query: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output

    try {
      // Ensure database is loaded
      if (!db) {
        addOutput('No database configured for this SQL editor', OutputLevel.ERROR)
        return
      }

      // Dynamic import to avoid SSR issues
      const { executeSqlQuery } = await import('@/lib/sql-executor.client')
      const result = await executeSqlQuery(query, db)

      if (result.success && result.results) {
        // Check if query returned any rows
        const hasRows = result.results.length > 0 && result.results[0].values.length > 0

        if (hasRows) {
          // Add output with SQL results
          const message = `Query executed successfully in ${result.executionTime?.toFixed(2)}ms`
          setOutput([{
            message,
            level: OutputLevel.OUTPUT,
            timestamp: Date.now(),
            sqlResults: result.results
          }])
        } else {
          // Query succeeded but returned no rows
          const message = `Query executed successfully in ${result.executionTime?.toFixed(2)}ms\nNo rows returned.`
          setOutput([{
            message,
            level: OutputLevel.WARNING,
            timestamp: Date.now()
          }])
        }
      } else {
        addOutput(result.error || 'Unknown error occurred', OutputLevel.ERROR)
      }
    } catch (error: any) {
      addOutput(error.message || 'Failed to execute SQL query', OutputLevel.ERROR)
    } finally {
      setRunState(RunState.STOPPED)
    }
  }

  // Run Python code with Skulpt
  const runPythonCode = async (code: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output

    try {
      // Ensure Skulpt is loaded
      await ensureSkulptLoaded()

      if (!window.Sk) {
        addOutput('Python runtime not loaded yet', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      const canvas = canvasRef.current
      if (canvas) {
        canvas.innerHTML = '' // Clear previous turtle graphics
      }

      const Sk = window.Sk

      Sk.configure({
        output: (text: string) => {
          addOutput(text, OutputLevel.OUTPUT)
        },
        read: (filename: string) => {
          // Extract just the base filename (remove directory paths)
          const baseName = filename.split('/').pop() || filename
          const ext = getFileExtension(language)
          const extPattern = new RegExp(`\\${ext}$`)

          // Try to match with or without extension
          const userFile = files.find(f => {
            // Direct match
            if (f.name === baseName || f.name === filename) return true

            // Try adding extension
            if (f.name === baseName + ext || f.name === filename + ext) return true

            // Try removing extension
            const nameWithoutExt = f.name.replace(extPattern, '')
            if (nameWithoutExt === baseName || nameWithoutExt === filename) return true

            return false
          })

          if (userFile) {
            return userFile.content
          }

          // Read Python modules from the stdlib
          if (Sk.builtinFiles && Sk.builtinFiles['files'][filename]) {
            return Sk.builtinFiles['files'][filename]
          }
          // Skulpt tries multiple paths when loading modules, so we don't log every attempt
          throw new Error(`File not found: ${filename}`)
        },
        inputfunTakesPrompt: true,
        __future__: Sk.python3,
        python3: true,
        execLimit: Number.POSITIVE_INFINITY,
      } as SkulptConfig)

      // Configure turtle graphics if canvas exists
      if (canvas) {
        ;(Sk.TurtleGraphics ||= {
          width: canvas.clientWidth || 500,
          height: canvas.clientHeight || 400,
        }).target = canvas

        // Center the canvas after Skulpt creates it
        // Wait for the canvas element to be created
        setTimeout(() => {
          const turtleCanvas = canvas.querySelector('canvas')
          const container = canvasContainerRef.current
          if (turtleCanvas && container) {
            const containerRect = container.getBoundingClientRect()
            const canvasWidth = turtleCanvas.width
            const canvasHeight = turtleCanvas.height
            const centerX = (containerRect.width - canvasWidth) / 2
            const centerY = (containerRect.height - canvasHeight) / 2
            setCanvasTransform({ x: centerX, y: centerY, scale: 1 })
          }
        }, 100)
      }

      const promise = Sk.misceval.asyncToPromise(() => {
        return Sk.importMainWithBody('<stdin>', false, code, true)
      })

      promise.then(
        () => {
          // Show success flash on Run button
          setShowSuccessFlash(true)
          setTimeout(() => setShowSuccessFlash(false), 1500)
          setRunState(RunState.STOPPED)
        },
        (err: SkulptError) => {
          if (err.tp$name === 'TimeoutError' && Sk.execLimit === 1) {
            addOutput('Program stopped', OutputLevel.WARNING)
          } else {
            addOutput(err.toString(), OutputLevel.ERROR)
          }
          setRunState(RunState.STOPPED)
        }
      )
    } catch (error) {
      addOutput(`Error: ${error}`, OutputLevel.ERROR)
      setRunState(RunState.STOPPED)
    }
  }

  // Run Python code with Pyodide (for matplotlib, numpy, etc.)
  const runPyodideCode = async (code: string) => {
    setRunState(RunState.RUNNING)
    setOutput([]) // Clear previous output

    // Clear previous matplotlib plots
    if (canvasRef.current) {
      canvasRef.current.querySelectorAll('.matplotlib-plot').forEach(el => el.remove())
    }

    try {
      // Ensure Pyodide is loaded
      const pyodide = await ensurePyodideLoaded()

      if (!pyodide) {
        addOutput('Pyodide runtime not loaded yet', OutputLevel.ERROR)
        setRunState(RunState.STOPPED)
        return
      }

      // Detect and load required packages
      const packagesToLoad: string[] = []
      const packageMap: Record<string, string> = {
        'matplotlib': 'matplotlib',
        'numpy': 'numpy',
        'pandas': 'pandas',
        'scipy': 'scipy',
        'sympy': 'sympy',
        'scikit-learn': 'scikit-learn',
        'sklearn': 'scikit-learn',
      }

      // Parse imports from code
      const importRegex = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
      let match
      while ((match = importRegex.exec(code)) !== null) {
        const moduleName = match[1]
        if (packageMap[moduleName]) {
          packagesToLoad.push(packageMap[moduleName])
        }
      }

      // Remove duplicates
      const uniquePackages = [...new Set(packagesToLoad)]

      // Load packages if needed (silently)
      if (uniquePackages.length > 0) {
        try {
          await pyodide.loadPackage(uniquePackages)
        } catch (err) {
          addOutput(`Warning: Failed to load some packages: ${err}\n`, OutputLevel.WARNING)
        }
      }

      // Configure matplotlib to use non-interactive backend
      if (uniquePackages.includes('matplotlib')) {
        // Prevent matplotlib from appending to DOM
        ;(document as any).pyodideMplTarget = null

        await pyodide.runPythonAsync(`
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
# Prevent matplotlib from creating interactive dialogs
plt.ioff()
# Make plt.show() a no-op (we capture figures directly)
plt.show = lambda: None
`)
      }

      // Capture stdout
      let stdoutBuffer: string[] = []
      pyodide.setStdout({
        batched: (text: string) => {
          stdoutBuffer.push(text)
          addOutput(text, OutputLevel.OUTPUT)
        }
      })

      // Capture stderr
      pyodide.setStderr({
        batched: (text: string) => {
          addOutput(text, OutputLevel.ERROR)
        }
      })

      // Write all files to Pyodide's virtual filesystem (for multi-file support)
      if (files.length > 1) {
        for (const file of files) {
          const fileName = file.name
          const fileContent = file.content

          // Write file to Pyodide's filesystem
          pyodide.FS.writeFile(fileName, fileContent)
        }
      }

      // Run the code
      const result = await pyodide.runPythonAsync(code)

      // Clean up any matplotlib UI elements that might have been created
      const cleanupMatplotlibUI = () => {
        // Target the outermost container that matplotlib creates
        document.querySelectorAll('body > div[style*="display: inline-block"]').forEach(el => {
          // Check if it contains matplotlib elements
          if (el.querySelector('.mpl-canvas, .mpl-toolbar, .ui-dialog-titlebar')) {
            el.remove()
          }
        })
        // Also clean up any standalone elements
        document.querySelectorAll('.ui-dialog, .mpl-message, .mpl-toolbar').forEach(el => el.remove())
      }

      cleanupMatplotlibUI()
      // Run cleanup again after a short delay to catch async UI creation
      setTimeout(cleanupMatplotlibUI, 100)
      setTimeout(cleanupMatplotlibUI, 500)

      // Check if matplotlib plots were created and capture them
      try {
        const plotScript = `
import sys
import io
import base64

plots = []
try:
    import matplotlib
    import matplotlib.pyplot as plt

    # Get all figures
    figures = [plt.figure(num) for num in plt.get_fignums()]

    for fig in figures:
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
        buf.seek(0)
        img_str = 'data:image/png;base64,' + base64.b64encode(buf.read()).decode('UTF-8')
        plots.append(img_str)
        plt.close(fig)
except ImportError:
    pass  # matplotlib not loaded
except Exception as e:
    print(f"Error capturing plots: {e}", file=sys.stderr)

plots
`
        const plotsData = await pyodide.runPythonAsync(plotScript)

        // Display plots in the graphics pane
        if (plotsData && plotsData.length > 0 && canvasRef.current) {
          // Clear previous matplotlib plots (but keep turtle graphics)
          const canvas = canvasRef.current
          // Remove existing matplotlib images
          canvas.querySelectorAll('.matplotlib-plot').forEach(el => el.remove())

          // Add new plots
          for (let i = 0; i < plotsData.length; i++) {
            const imgData = plotsData[i]
            const img = document.createElement('img')
            img.src = imgData
            img.alt = `Plot ${i + 1}`
            img.className = 'matplotlib-plot'
            img.draggable = false // Prevent browser image drag behavior
            img.style.cssText = 'max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 4px; user-select: none;'
            canvas.appendChild(img)
          }

        }
      } catch (plotError) {
        console.error('[Pyodide] Error capturing plots:', plotError)
      }

      if (result !== undefined && result !== null) {
        addOutput(String(result), OutputLevel.OUTPUT)
      }

      // Show success flash on Run button
      setShowSuccessFlash(true)
      setTimeout(() => setShowSuccessFlash(false), 1500)
      setRunState(RunState.STOPPED)
    } catch (error: any) {
      const errorMessage = error.message || String(error)
      addOutput(errorMessage, OutputLevel.ERROR)
      setRunState(RunState.STOPPED)
    }
  }

  // Stop running code
  const stopCode = () => {
    if (window.Sk) {
      window.Sk.execLimit = 1
    }
    setRunState(RunState.STOPPED)
    addOutput('Program stopped', OutputLevel.WARNING)
  }

  // Restart Python kernel
  const restartKernel = () => {
    if (activeKernel === 'pyodide') {
      // Clear Pyodide state
      delete (window as any).__pyodidePromise
      setActiveKernel(null)
    } else if (activeKernel === 'skulpt') {
      // Clear Skulpt state - it will reload on next run
      delete (window as any).Sk
      delete (window as any).__skulptPromises
      setActiveKernel(null)
    }
    setShowKernelMenu(false)
  }

  // Force switch kernel
  const switchKernel = (kernel: 'skulpt' | 'pyodide') => {
    // Clear both kernels
    delete (window as any).__pyodidePromise
    delete (window as any).Sk
    delete (window as any).__skulptPromises
    setActiveKernel(null)
    setShowKernelMenu(false)
    // The kernel will auto-select based on imports on next run
  }

  // Reset code to original markdown content
  const resetCode = () => {
    // Reset to the original markdown content
    const originalContent = originalInitialCode.current

    // Update files state
    setFiles([{ name: `main${getFileExtension(language)}`, content: originalContent }])
    setActiveFileIndex(0)

    // Update editor view
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: editorViewRef.current.state.doc.length,
          insert: originalContent,
        },
      })
    }

    setOutput([])
    // Only clear canvas for Python graphics (not SQL schemas)
    if (canvasRef.current && language !== 'sql') {
      canvasRef.current.innerHTML = ''
    }
    // Reset to center position
    resetCanvasView()

    console.log('Reset to original markdown content')
  }

  // Canvas pan and zoom handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return // Only left click
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - canvasTransform.x,
      y: e.clientY - canvasTransform.y
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return
    setCanvasTransform(prev => ({
      ...prev,
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    }))
  }

  const handleCanvasMouseUp = () => {
    setIsDragging(false)
  }

  const resetCanvasView = () => {
    // Reset to centered position
    const canvas = canvasRef.current
    const container = canvasContainerRef.current
    if (canvas && container) {
      const turtleCanvas = canvas.querySelector('canvas')
      if (turtleCanvas) {
        const containerRect = container.getBoundingClientRect()
        const canvasWidth = turtleCanvas.width
        const canvasHeight = turtleCanvas.height
        const centerX = (containerRect.width - canvasWidth) / 2
        const centerY = (containerRect.height - canvasHeight) / 2
        setCanvasTransform({ x: centerX, y: centerY, scale: 1 })
        return
      }
    }
    // Fallback if canvas not found
    setCanvasTransform({ x: 0, y: 0, scale: 1 })
  }

  // Screenshot turtle canvas
  const screenshotCanvas = () => {
    // TODO: Implement canvas screenshot functionality
    console.log('Screenshot not yet implemented')
  }

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen()
      setFullscreen(true)
    } else if (document.fullscreenElement) {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col w-full border rounded-lg overflow-hidden bg-background relative"
      style={{ height: fullscreen ? '100vh' : `${manualHeight ?? totalHeight}px` }}
    >
      {/* Main content area */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
        {/* Code Editor Panel */}
        {showEditor && (
          <div
            className="flex flex-col border-r relative"
            style={{
              width: canvasVisible && showGraphics ? `${editorWidth}%` : '100%',
              display: showEditor ? 'flex' : 'none'
            }}
          >
            {/* Floating Toolbar - Top Right (zoom controls + kernel indicator) */}
            <div ref={kernelMenuRef} className="absolute top-1 right-1 z-30 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded px-1 py-0.5">
              {/* Zoom Controls */}
              <Button
                size="sm"
                variant="ghost"
                onClick={decreaseFontSize}
                className="h-6 w-6 p-0"
                title="Decrease font size"
              >
                <ZoomOut className="w-3 h-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={increaseFontSize}
                className="h-6 w-6 p-0"
                title="Increase font size"
              >
                <ZoomIn className="w-3 h-3" />
              </Button>

              {/* Python Kernel Indicator */}
              {language === 'python' && (
                <>
                  <div className="w-px h-4 bg-border mx-1" />
                  <button
                    ref={kernelButtonRef}
                    onClick={() => {
                      if (!showKernelMenu && kernelButtonRef.current) {
                        const rect = kernelButtonRef.current.getBoundingClientRect()
                        setKernelMenuPosition({
                          top: rect.bottom + 4,
                          left: rect.right - 160 // 160px is menu width
                        })
                      }
                      setShowKernelMenu(!showKernelMenu)
                    }}
                    className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                      kernelLoading
                        ? 'bg-yellow-500/20 animate-pulse'
                        : activeKernel
                        ? 'hover:bg-muted'
                        : ''
                    }`}
                    title={activeKernel ? `Python (${activeKernel})` : 'Python kernel not loaded'}
                  >
                    <svg
                      viewBox="0 0 256 255"
                      className={`w-4 h-4 ${
                        kernelLoading
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : activeKernel
                          ? 'text-muted-foreground hover:text-foreground'
                          : 'text-muted-foreground/40'
                      }`}
                      fill="currentColor"
                    >
                      <path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" />
                      <path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" />
                    </svg>
                  </button>

                  {/* Kernel Menu Dropdown - Rendered via Portal */}
                  {showKernelMenu && kernelMenuPosition && typeof document !== 'undefined' && createPortal(
                    <div
                      className="fixed bg-popover border rounded-lg shadow-lg p-2 min-w-[160px] z-[9999]"
                      style={{
                        top: `${kernelMenuPosition.top}px`,
                        left: `${kernelMenuPosition.left}px`
                      }}
                    >
                      <div className="text-xs text-muted-foreground mb-2 px-2">
                        {activeKernel ? (
                          <span>Kernel: <strong className="text-foreground capitalize">{activeKernel}</strong></span>
                        ) : (
                          <span>No kernel loaded</span>
                        )}
                      </div>
                      <div className="border-t my-1" />
                      <button
                        onClick={restartKernel}
                        disabled={!activeKernel}
                        className="w-full text-left px-2 py-1 text-sm rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Restart kernel
                      </button>
                      <div className="border-t my-1" />
                      <div className="text-xs text-muted-foreground px-2 mb-1">Switch to:</div>
                      <button
                        onClick={() => switchKernel('skulpt')}
                        className={`w-full text-left px-2 py-1 text-sm rounded hover:bg-muted ${activeKernel === 'skulpt' ? 'bg-muted' : ''}`}
                      >
                        Skulpt <span className="text-xs text-muted-foreground">(turtle)</span>
                      </button>
                      <button
                        onClick={() => switchKernel('pyodide')}
                        className={`w-full text-left px-2 py-1 text-sm rounded hover:bg-muted ${activeKernel === 'pyodide' ? 'bg-muted' : ''}`}
                      >
                        Pyodide <span className="text-xs text-muted-foreground">(numpy, etc)</span>
                      </button>
                    </div>,
                    document.body
                  )}
                </>
              )}
            </div>

            {/* File Tabs - hidden in single-file mode */}
            {!singleFile && (
              <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/10 pr-24">
                  <div className="flex items-center gap-1 overflow-x-auto flex-1">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center">
                        {renamingIndex === index ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => confirmRename(index)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                confirmRename(index)
                              } else if (e.key === 'Escape') {
                                cancelRename()
                              }
                            }}
                            autoFocus
                            className="h-7 px-2 text-xs border rounded bg-background"
                            style={{ width: '120px' }}
                          />
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant={activeFileIndex === index ? 'secondary' : 'ghost'}
                              onClick={() => switchToFile(index)}
                              onDoubleClick={() => startRename(index)}
                              className="h-7 px-2 text-xs gap-1"
                              title="Double-click to rename"
                            >
                              <FileText className="w-3 h-3" />
                              {file.name}
                            </Button>
                            {files.length > 1 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeFile(index)
                                }}
                                className="h-6 w-6 p-0 ml-1"
                                title="Remove file"
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={addNewFile}
                      className="h-7 px-2 text-xs"
                      title="Add new file"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
              </div>
            )}

            {/* CodeMirror Editor */}
            <div ref={editorRef} className="flex-1 overflow-auto w-full h-full relative">
              {/* Floating Control Buttons - Bottom Left */}
              <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                {runState === RunState.STOPPED ? (
                  <Button
                    onClick={runCode}
                    size="sm"
                    variant={showSuccessFlash ? 'default' : 'default'}
                    className={`h-7 px-2 shadow-lg transition-colors ${
                      showSuccessFlash ? 'bg-green-600 hover:bg-green-600 text-white' : ''
                    }`}
                  >
                    <Play className="w-3 h-3 mr-1" />
                    {showSuccessFlash ? '✓' : 'Run'}
                  </Button>
                ) : (
                  <Button onClick={stopCode} size="sm" variant="destructive" className="h-7 px-2 shadow-lg">
                    <Square className="w-3 h-3 mr-1" />
                    Stop
                  </Button>
                )}
              </div>
              {/* Floating Control Buttons - Bottom Right */}
              {pageId && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10">
                  <Button
                    onClick={resetCode}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shadow-lg"
                    title="Reset to default content"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                  <Button
                    onClick={() => {
                      setActivePanel('history')
                      setPanelVisible(true)
                    }}
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 shadow-lg"
                    title="Version history"
                  >
                    <History className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Draggable Splitter */}
        {showEditor && showGraphics && canvasVisible && (
          <div
            onMouseDown={handleSplitterMouseDown}
            className={`w-1 bg-border hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-colors relative flex items-center justify-center ${
              isDraggingSplitter ? 'bg-primary/30' : ''
            }`}
          >
            {/* Drag indicator */}
            <div className="text-muted-foreground/40 text-xs select-none pointer-events-none">
              ⋮
            </div>
          </div>
        )}

        {/* Graphics Panel (Turtle Graphics & Matplotlib for Python) */}
        {canvasVisible && showGraphics && (
          <div
            className="flex flex-col relative"
            style={{ width: showEditor ? `${100 - editorWidth}%` : '100%' }}
          >
            <div
              ref={canvasContainerRef}
              className="flex-1 relative overflow-hidden"
              style={{
                backgroundColor: resolvedTheme === 'dark' ? '#111827' : '#ffffff',
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                overscrollBehavior: 'contain'
              }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            >
              {/* Floating Control Buttons */}
              <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
                <Button onClick={screenshotCanvas} size="sm" variant="outline" className="h-7 w-7 p-0 shadow-lg" title="Screenshot">
                  <Camera className="w-3 h-3" />
                </Button>
                <Button onClick={toggleFullscreen} size="sm" variant="outline" className="h-7 w-7 p-0 shadow-lg" title="Fullscreen">
                  {fullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </Button>
              </div>
              <div
                ref={canvasRef}
                className="absolute inset-0"
                style={{
                  transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`,
                  transformOrigin: '0 0',
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Horizontal Divider (between main content and output) */}
      {panelVisible && (
        <div
          onMouseDown={handleHorizontalSplitterMouseDown}
          className="h-1 bg-border hover:bg-primary/20 cursor-row-resize flex-shrink-0 transition-colors"
        />
      )}

      {/* Output/History Panel - fixed height */}
      {panelVisible && (
        <div
          className="flex flex-col overflow-hidden"
          style={{ height: `${outputPanelHeight}px` }}
        >
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 border-b bg-muted/30">
          <Button
            onClick={() => setActivePanel('output')}
            size="sm"
            variant={activePanel === 'output' ? 'secondary' : 'ghost'}
            className="h-7"
          >
            Output
          </Button>
          {pageId && (
            <Button
              onClick={() => setActivePanel('history')}
              size="sm"
              variant={activePanel === 'history' ? 'secondary' : 'ghost'}
              className="h-7"
            >
              History
            </Button>
          )}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Close button */}
          <Button
            onClick={() => setPanelVisible(false)}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            title="Close panel"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>

        {/* Panel Content */}
        {activePanel === 'output' ? (
          <div ref={outputPanelRef} className="flex-1 overflow-auto p-2 font-mono text-sm" style={{ overscrollBehaviorY: 'contain' }}>
            {output.map((entry, index) => (
                <div key={index} className="mb-2">
                  {/* Text message */}
                  <div
                    className={`${entry.isHtml ? '' : 'whitespace-pre-wrap'} ${
                      entry.level === OutputLevel.ERROR
                        ? 'text-red-600 dark:text-red-400'
                        : entry.level === OutputLevel.WARNING
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-foreground'
                    }`}
                  >
                    {entry.isHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: entry.message }} />
                    ) : (
                      entry.message
                    )}
                  </div>

                  {/* SQL Results Table */}
                  {entry.sqlResults && entry.sqlResults.length > 0 && (
                    <div className="mt-2 overflow-x-auto">
                      {entry.sqlResults.map((resultSet, rsIndex) => (
                        <div key={rsIndex} className="mb-4">
                          <div className="text-xs text-muted-foreground mb-1">
                            {resultSet.values.length} row{resultSet.values.length !== 1 ? 's' : ''}
                          </div>
                          <table className="min-w-full border-collapse border border-border text-xs">
                            <thead className="bg-muted">
                              <tr>
                                {resultSet.columns.map((column, colIdx) => (
                                  <th
                                    key={colIdx}
                                    className="border border-border px-2 py-1 text-left font-semibold"
                                  >
                                    {column}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {resultSet.values.map((row, rowIdx) => (
                                <tr key={rowIdx} className="hover:bg-muted/50">
                                  {row.map((cell, cellIdx) => (
                                    <td
                                      key={cellIdx}
                                      className="border border-border px-2 py-1"
                                    >
                                      {cell === null ? (
                                        <span className="text-muted-foreground italic">NULL</span>
                                      ) : (
                                        String(cell)
                                      )}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-hidden p-2">
            {/* Controls row: Save button + toggles */}
            <div className="flex items-center gap-4 px-2 pb-2 text-xs border-b mb-2">
              <Button
                onClick={() => createVersionSnapshot(true)}
                size="sm"
                variant="outline"
                className="h-7 px-2"
                title="Save version"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-foreground">Confirm deletion</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={confirmDeletion}
                  onClick={() => setConfirmDeletion(!confirmDeletion)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    confirmDeletion ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      confirmDeletion ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-foreground">Show autosaves</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showAutosaves}
                  onClick={() => setShowAutosaves(!showAutosaves)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    showAutosaves ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showAutosaves ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            {versionsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current" />
                <span className="ml-2">Loading versions...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="text-muted-foreground italic px-2">No saved versions yet. Click "Save" to create one.</div>
            ) : (
              <>
                {/* Version timeline */}
                <div className="flex gap-2 px-2 py-2 overflow-x-auto">
                {versions
                  .filter(v => showAutosaves || v.isManualSave)
                  .map((version) => {
                  const date = new Date(version.createdAt)
                  const now = Date.now()
                  const diff = now - version.createdAt
                  const seconds = Math.floor(diff / 1000)
                  const minutes = Math.floor(seconds / 60)
                  const hours = Math.floor(minutes / 60)
                  const days = Math.floor(hours / 24)

                  const timeAgo =
                    seconds < 60 ? 'now' :
                    minutes < 60 ? `${minutes}m` :
                    hours < 24 ? `${hours}h` :
                    days < 7 ? `${days}d` :
                    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

                  const isHighlighted = highlightedVersion === version.versionNumber
                  const isEditing = editingVersion === version.versionNumber

                  return (
                    <div
                      key={version.versionNumber}
                      className={`group relative flex-shrink-0 w-24 min-h-28 max-h-40 border rounded-lg p-3 transition-all flex flex-col items-center justify-center gap-1 ${
                        isHighlighted ? 'bg-primary/20 border-primary ring-2 ring-primary/50' : 'hover:bg-accent/50'
                      }`}
                    >
                      {/* Delete button - appears on hover */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (!confirmDeletion || confirm(`Delete version ${version.versionNumber}?`)) {
                            await deleteVersion(version.versionNumber)
                            await refreshVersions()
                          }
                        }}
                        disabled={isDeleting}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex hover:bg-destructive/90"
                        title="Delete version"
                      >
                        <X className="w-3 h-3" />
                      </button>

                      {/* Click to restore */}
                      <button
                        disabled={isRestoring || isEditing}
                        onClick={async () => {
                          const data = await restore(version.versionNumber)
                          if (data) {
                            // Restore the data to component state
                            if (data.files) setFiles(data.files)
                            if (data.activeFileIndex !== undefined) setActiveFileIndex(data.activeFileIndex)
                            if (data.fontSize !== undefined) setFontSize(data.fontSize)
                            if (data.editorWidth !== undefined) setEditorWidth(data.editorWidth)
                            if (data.canvasTransform) setCanvasTransform(data.canvasTransform)
                            await refreshVersions()

                            // Highlight the restored version
                            setHighlightedVersion(version.versionNumber)
                            setTimeout(() => setHighlightedVersion(null), 2000)
                          }
                        }}
                        className="absolute inset-0 rounded-lg disabled:cursor-default"
                      />

                      {/* Editable version name */}
                      {isEditing ? (
                        <div className="flex flex-col items-center gap-1 w-full relative z-10">
                          <input
                            type="text"
                            value={editingLabel}
                            onChange={(e) => setEditingLabel(e.target.value)}
                            onBlur={async () => {
                              await updateLabel(version.versionNumber, editingLabel)
                              await refreshVersions()
                              setEditingVersion(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur()
                              } else if (e.key === 'Escape') {
                                setEditingVersion(null)
                              }
                            }}
                            autoFocus
                            placeholder={`v${version.versionNumber}`}
                            className="w-full text-xs text-center bg-background border rounded px-1 py-0.5 font-bold"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="text-xs text-muted-foreground">{timeAgo}</div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 w-full">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingVersion(version.versionNumber)
                              setEditingLabel(version.label || '')
                            }}
                            className="relative z-10 font-bold text-sm text-foreground w-full text-center px-1 hover:text-primary transition-colors line-clamp-2"
                            title="Click to rename version"
                          >
                            {version.label || `v${version.versionNumber}`}
                          </button>
                          <div className="text-xs text-muted-foreground pointer-events-none">{timeAgo}</div>
                        </div>
                      )}
                    </div>
                  )
                })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      )}

      {/* Resize Handle (bottom-right corner) */}
      {!fullscreen && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
          title="Drag to resize"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
          >
            <path d="M9 1v8H1" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </div>
  )
})
