"use client"

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { autocompletion } from '@codemirror/autocomplete'
import { pythonCompletions } from './python-completions'
import { Button } from '@/components/ui/button'
import { Play, Square, RotateCcw, Maximize2, Minimize2, Camera, X, Plus, FileText, Palette, ZoomIn, ZoomOut } from 'lucide-react'
import {
  RunState,
  OutputLevel,
  OutputEntry,
  PythonFile,
  SkulptError,
  SkulptConfig
} from './types'

interface CodeEditorProps {
  id?: string
  language?: 'python' | 'javascript'
  initialCode?: string
  showCanvas?: boolean
}

export function CodeEditor({
  id = 'code-editor',
  language = 'python',
  initialCode = '# Write your code here\nprint("Hello, World!")',
  showCanvas = true
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [runState, setRunState] = useState<RunState>(RunState.STOPPED)
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [fullscreen, setFullscreen] = useState(false)

  // Resizable panel state
  const [editorWidth, setEditorWidth] = useState(50) // Percentage
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const MIN_VISIBLE_WIDTH = 100 // pixels

  // Multi-file support
  const [files, setFiles] = useState<PythonFile[]>([
    { name: 'main.py', content: initialCode }
  ])
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Calculate visibility based on width and detect graphics modules (turtle or matplotlib)
  const currentCode = files[activeFileIndex]?.content || initialCode
  const hasTurtleModule = language === 'python' && /import\s+turtle|from\s+turtle/.test(currentCode)
  const hasMatplotlib = language === 'python' && /import\s+matplotlib|from\s+matplotlib/.test(currentCode)
  const hasGraphics = hasTurtleModule || hasMatplotlib
  const showEditor = containerRef.current ? (editorWidth / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const showGraphics = containerRef.current ? ((100 - editorWidth) / 100) * containerRef.current.offsetWidth >= MIN_VISIBLE_WIDTH : true
  const [canvasVisible, setCanvasVisible] = useState(false) // Start hidden, show only when graphics detected

  // Font size state
  const [fontSize, setFontSize] = useState(14) // Default 14px

  // Canvas pan and zoom state
  const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 })
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

  // Wait for theme to hydrate
  useEffect(() => {
    setMounted(true)
  }, [])

  // Lazy load Pyodide on first run
  const ensurePyodideLoaded = async () => {
    // Return existing promise if already loading/loaded
    if ((window as any).__pyodidePromise) {
      return (window as any).__pyodidePromise
    }

    // Start loading
    addOutput('Loading Python runtime (Pyodide)...', OutputLevel.OUTPUT)

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
      addOutput('✓ Python runtime ready\n', OutputLevel.OUTPUT)
      return pyodide
    } catch (error) {
      console.error('[Pyodide] Failed to load:', error)
      addOutput('Failed to load Python runtime (Pyodide)', OutputLevel.ERROR)
      throw error
    }
  }

  // Lazy load Skulpt on first run
  const ensureSkulptLoaded = async () => {
    // Check if already loaded
    if (window.Sk) {
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

    addOutput('Loading Python runtime (Skulpt)...', OutputLevel.OUTPUT)

    try {
      await loadScript('/js/skulpt.min.js')
      await loadScript('/js/skulpt-stdlib.js')
      console.log('[Skulpt] Loaded successfully')
      addOutput('✓ Python runtime ready\n', OutputLevel.OUTPUT)
    } catch (error) {
      console.error('[Skulpt] Failed to load:', error)
      addOutput('Failed to load Python runtime (Skulpt)', OutputLevel.ERROR)
      throw error
    }
  }

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current || !mounted) return

    const isDark = resolvedTheme === 'dark'

    // Select language extension
    const langExtension = language === 'python' ? python() : javascript()

    const extensions = [
      basicSetup,
      keymap.of([indentWithTab]), // Enable Tab/Shift+Tab for indentation
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
    }
  }, [mounted, resolvedTheme, language, initialCode, fontSize])

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
  }, [mounted, editorViewRef.current])

  // Prevent output panel scroll from propagating to page
  useEffect(() => {
    const outputPanel = outputPanelRef.current
    if (!outputPanel) return

    const handleWheel = (e: WheelEvent) => {
      // Only stop propagation if we're at the scroll boundary
      const { scrollTop, scrollHeight, clientHeight } = outputPanel
      const isAtTop = scrollTop === 0 && e.deltaY < 0
      const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0

      // Stop propagation unless we're at a boundary and trying to scroll further
      if (!isAtTop && !isAtBottom) {
        e.stopPropagation()
      }
    }

    outputPanel.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      outputPanel.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Add output helper
  const addOutput = (message: string, level: OutputLevel = OutputLevel.OUTPUT) => {
    setOutput((prev) => [...prev, { message, level, timestamp: Date.now() }])
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
    const newFile: PythonFile = {
      name: `file${fileNumber}.py`,
      content: '# New file\n'
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
    setRenameValue(files[index].name.replace(/\.py$/, ''))
  }

  // Confirm rename
  const confirmRename = (index: number) => {
    if (!renameValue.trim()) {
      setRenamingIndex(null)
      return
    }

    const newName = renameValue.trim().endsWith('.py')
      ? renameValue.trim()
      : renameValue.trim() + '.py'

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
        }
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
      // Decide which runtime to use based on turtle module detection
      if (hasTurtleModule) {
        runPythonCode(code) // Use Skulpt for turtle
      } else {
        runPyodideCode(code) // Use Pyodide for everything else (including matplotlib)
      }
    } else if (language === 'javascript') {
      // TODO: Implement JavaScript execution
      addOutput('JavaScript execution not yet implemented', OutputLevel.ERROR)
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

          // Try to match with or without .py extension
          const userFile = files.find(f => {
            // Direct match
            if (f.name === baseName || f.name === filename) return true

            // Try adding .py extension
            if (f.name === baseName + '.py' || f.name === filename + '.py') return true

            // Try removing .py extension
            const nameWithoutExt = f.name.replace(/\.py$/, '')
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
          addOutput('✓ Program completed successfully', OutputLevel.OUTPUT)
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

      // Load packages if needed
      if (uniquePackages.length > 0) {
        addOutput(`Loading packages: ${uniquePackages.join(', ')}...`, OutputLevel.OUTPUT)
        try {
          await pyodide.loadPackage(uniquePackages)
          addOutput('✓ Packages loaded successfully\n', OutputLevel.OUTPUT)
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

          addOutput(`✓ ${plotsData.length} plot${plotsData.length > 1 ? 's' : ''} displayed in Graphics panel`, OutputLevel.OUTPUT)
        }
      } catch (plotError) {
        console.error('[Pyodide] Error capturing plots:', plotError)
      }

      if (result !== undefined && result !== null) {
        addOutput(String(result), OutputLevel.OUTPUT)
      }

      addOutput('✓ Program completed successfully', OutputLevel.OUTPUT)
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

  // Reset code
  const resetCode = () => {
    if (editorViewRef.current) {
      editorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: editorViewRef.current.state.doc.length,
          insert: initialCode,
        },
      })
    }
    setOutput([])
    if (canvasRef.current) {
      canvasRef.current.innerHTML = ''
    }
    // Reset to center position
    resetCanvasView()
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

  // Clear output
  const clearOutput = () => {
    setOutput([])
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
      className="flex flex-col w-full border rounded-lg overflow-hidden bg-background"
      style={{ height: fullscreen ? '100vh' : '600px' }}
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
            {/* File Tabs */}
            {language === 'python' && (
              <div className="flex items-center justify-between gap-1 px-2 py-1 border-b bg-muted/10">
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
                <div className="flex items-center gap-1">
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
                </div>
              </div>
            )}

            {/* CodeMirror Editor */}
            <div ref={editorRef} className="flex-1 overflow-auto w-full h-full relative">
              {/* Floating Control Buttons */}
              <div className="absolute bottom-2 left-2 flex items-center gap-1 z-10">
                {runState === RunState.STOPPED ? (
                  <Button onClick={runCode} size="sm" variant="default" className="h-7 px-2 shadow-lg">
                    <Play className="w-3 h-3 mr-1" />
                    Run
                  </Button>
                ) : (
                  <Button onClick={stopCode} size="sm" variant="destructive" className="h-7 px-2 shadow-lg">
                    <Square className="w-3 h-3 mr-1" />
                    Stop
                  </Button>
                )}
                <Button onClick={resetCode} size="sm" variant="outline" className="h-7 px-2 shadow-lg">
                  <RotateCcw className="w-3 h-3" />
                </Button>
                {!showGraphics && hasGraphics && language === 'python' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditorWidth(50)}
                    title="Show Graphics Panel"
                    className="h-7 px-2 shadow-lg text-primary hover:text-primary"
                  >
                    <Palette className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Draggable Splitter */}
        {showEditor && showGraphics && canvasVisible && (
          <div
            onMouseDown={handleSplitterMouseDown}
            className={`w-2 bg-border hover:bg-primary/20 cursor-col-resize flex-shrink-0 transition-colors relative flex items-center justify-center ${
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
                className="absolute"
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

      {/* Output Panel */}
      <div className="h-48 border-t flex flex-col">
        <div className="flex items-center justify-between gap-2 p-2 border-b bg-muted/30">
          <div className="text-sm font-medium">Output</div>
          <Button onClick={clearOutput} size="sm" variant="ghost">
            Clear
          </Button>
        </div>
        <div ref={outputPanelRef} className="flex-1 overflow-auto p-2 font-mono text-sm">
          {output.length === 0 ? (
            <div className="text-muted-foreground italic">No output yet. Run your code to see results here.</div>
          ) : (
            output.map((entry, index) => (
              <div
                key={index}
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
            ))
          )}
        </div>
      </div>
    </div>
  )
}
