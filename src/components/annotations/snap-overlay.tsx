'use client'

import { useState, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { toJpeg } from 'html-to-image'

export interface Snap {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number // Pixels from left edge of paper
  width: number
  height: number
  sectionId?: string // Section heading ID this snap belongs to
  sectionOffsetY?: number // Y offset of the section when snap was created
}

interface HeadingPosition {
  sectionId: string
  offsetY: number
  headingText: string
}

interface SnapOverlayProps {
  onCapture: (snap: Snap) => void
  onCancel: () => void
  nextSnapNumber: number
  zoom: number
  headingPositions?: HeadingPosition[] // For section detection when creating snaps
}

// Imperative handle for programmatic snap triggering (DEV ONLY)
export interface SnapOverlayHandle {
  triggerCapture: (x1: number, y1: number, x2: number, y2: number) => Promise<void>
}

export const SnapOverlay = forwardRef<SnapOverlayHandle, SnapOverlayProps>(function SnapOverlay(
  { onCapture, onCancel, nextSnapNumber, zoom, headingPositions = [] },
  ref
) {
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Core capture logic - used by both mouse-based and programmatic captures
  // Takes logical coordinates (already adjusted for zoom)
  const performCapture = useCallback(async (
    left: number,
    top: number,
    width: number,
    height: number
  ) => {
    // Mark as capturing to prevent new interactions
    setIsCapturing(true)

    try {
      // Get the paper element (the main content area)
      const paperElement = document.getElementById('paper')
      if (!paperElement) {
        console.error('Could not find paper element')
        onCancel()
        return
      }

      // Hide the selection box during capture to prevent it appearing in the snap
      setCurrentPos(null)

      // Get the paper element's position relative to the viewport
      const paperRect = paperElement.getBoundingClientRect()

      // Get natural (unzoomed) dimensions of the paper element
      const naturalWidth = paperElement.offsetWidth
      const naturalHeight = paperElement.offsetHeight

      // Convert overlay coordinates to paper coordinates
      const overlayRect = overlayRef.current?.getBoundingClientRect()
      if (!overlayRect) {
        onCancel()
        return
      }

      // Calculate selection position relative to paper in logical coordinates
      const logicalLeft = left + (overlayRect.left - paperRect.left) / zoom
      const logicalTop = top + (overlayRect.top - paperRect.top) / zoom

      // For snap positioning: appear at the selection location
      const snapLeft = logicalLeft
      const snapTop = logicalTop

      // Create snap animation overlay at selection location (visual feedback)
      // Use viewport coordinates (not zoom-adjusted) since animation uses position: fixed
      const viewportLeft = left * zoom + (overlayRect?.left || 0)
      const viewportTop = top * zoom + (overlayRect?.top || 0)
      const viewportWidth = width * zoom
      const viewportHeight = height * zoom

      // Create SVG animation overlay with rounded border
      const animDuration = 0.5 // seconds
      const borderWidth = 5
      const cornerRadius = 8

      // Calculate perimeter for stroke-dasharray (rounded rect formula)
      const perimeter = 2 * (viewportWidth + viewportHeight - 2 * cornerRadius) + 2 * Math.PI * cornerRadius

      // Determine stroke color based on theme
      const isDark = document.documentElement.classList.contains('dark')
      const strokeColor = isDark ? 'white' : 'black'

      // Create SVG element
      const svgNS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('width', String(viewportWidth + borderWidth))
      svg.setAttribute('height', String(viewportHeight + borderWidth))
      svg.style.cssText = `
        position: fixed;
        left: ${viewportLeft - borderWidth / 2}px;
        top: ${viewportTop - borderWidth / 2}px;
        pointer-events: none;
        z-index: 10000;
      `

      // Create rounded rect for the border
      const rect = document.createElementNS(svgNS, 'rect')
      rect.setAttribute('x', String(borderWidth / 2))
      rect.setAttribute('y', String(borderWidth / 2))
      rect.setAttribute('width', String(viewportWidth))
      rect.setAttribute('height', String(viewportHeight))
      rect.setAttribute('rx', String(cornerRadius))
      rect.setAttribute('ry', String(cornerRadius))
      rect.setAttribute('fill', 'none')
      rect.setAttribute('stroke', strokeColor)
      rect.setAttribute('stroke-width', String(borderWidth))
      // Use CSS properties for smooth animation (not SVG attributes)
      rect.style.strokeDasharray = String(perimeter)
      rect.style.strokeDashoffset = String(perimeter)
      rect.style.transition = `stroke-dashoffset ${animDuration}s ease-out`

      svg.appendChild(rect)
      document.body.appendChild(svg)

      // Trigger animation on next frame
      requestAnimationFrame(() => {
        rect.style.strokeDashoffset = '0'
      })

      // Store reference for cleanup
      const animOverlay = svg

      // Wait for animation to complete before starting capture
      await new Promise(resolve => setTimeout(resolve, animDuration * 1000))

      // Create capture wrapper - position at selection location
      const wrapper = document.createElement('div')
      wrapper.style.position = 'absolute'
      wrapper.style.left = `${viewportLeft}px`
      wrapper.style.top = `${viewportTop}px`
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
      wrapper.style.zIndex = '1'
      wrapper.style.overflow = 'hidden'
      wrapper.style.pointerEvents = 'none'

      // Copy theme classes from html/body to preserve theme in capture
      const htmlClasses = document.documentElement.className
      const bodyClasses = document.body.className
      wrapper.className = `${htmlClasses} ${bodyClasses}`

      // Extract and inject font-face rules to ensure fonts render correctly
      const styleElement = document.createElement('style')
      const fontFaceRules: string[] = []

      // Font hash mappings
      const fontMap: Record<string, { family: string; weight: string }> = {
        '4cfd7524de14b24d': { family: 'Roboto Slab', weight: '300' },
        'd9b5d46d9a89ffe6': { family: 'Barlow Condensed', weight: '700' },
        '83afe278b6a6bb3c': { family: 'EB Garamond', weight: '400' },
        'e4505858a30c79c2': { family: 'EB Garamond', weight: '500' }
      }

      // Get font URLs from preload links and convert to base64 for all browsers
      const preloadLinks = document.querySelectorAll('link[rel="preload"][as="font"]')

      for (const link of Array.from(preloadLinks)) {
        const href = link.getAttribute('href')
        if (!href) continue

        // Get full URL
        const fullUrl = href.startsWith('http') ? href : `${window.location.origin}${href}`

        // Find font family from hash
        let fontInfo: { family: string; weight: string } | null = null
        for (const [hash, info] of Object.entries(fontMap)) {
          if (href.includes(hash)) {
            fontInfo = info
            break
          }
        }

        if (fontInfo) {
          try {
            // Always use base64 embedding for reliability
            const response = await fetch(fullUrl)
            const blob = await response.blob()
            const reader = new FileReader()
            const base64 = await new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string)
              reader.readAsDataURL(blob)
            })

            const fontFace = `
              @font-face {
                font-family: '${fontInfo.family}';
                src: url('${base64}') format('woff2');
                font-weight: ${fontInfo.weight};
                font-style: normal;
              }
            `
            fontFaceRules.push(fontFace)
          } catch (err) {
            console.warn(`Failed to embed ${fontInfo.family}:`, err)
            // Fallback to URL if base64 fails
            const fontFace = `
              @font-face {
                font-family: '${fontInfo.family}';
                src: url('${fullUrl}') format('woff2');
                font-weight: ${fontInfo.weight};
                font-style: normal;
              }
            `
            fontFaceRules.push(fontFace)
          }
        }
      }

      // Also add CSS variable mappings that Next.js uses
      const cssVariables = `
        :root {
          --font-roboto-slab: 'Roboto Slab', serif;
          --font-eb-garamond: 'EB Garamond', serif;
          --font-barlow-condensed: 'Barlow Condensed', sans-serif;
        }
        strong, b {
          font-weight: 600 !important;
        }
      `

      styleElement.textContent = fontFaceRules.join('\n') + cssVariables
      wrapper.appendChild(styleElement)

      // First, collect computed font styles from original elements
      const fontStyleMap = new Map<Element, string>()
      const allOriginalElements = paperElement.querySelectorAll('*')

      // Store computed font for paper element itself
      const paperComputedStyle = window.getComputedStyle(paperElement)
      const paperFontFamily = paperComputedStyle.fontFamily

      // Store computed fonts for all descendants
      allOriginalElements.forEach((el) => {
        if (el instanceof HTMLElement) {
          const style = window.getComputedStyle(el)
          if (style.fontFamily) {
            fontStyleMap.set(el, style.fontFamily)
          }
        }
      })

      // Clone the paper element with annotations canvas included
      const paperClone = paperElement.cloneNode(true) as HTMLElement
      paperClone.style.position = 'absolute'
      paperClone.style.left = `${-logicalLeft}px`
      paperClone.style.top = `${-logicalTop}px`
      // Preserve natural dimensions to prevent reflow
      paperClone.style.width = `${naturalWidth}px`
      paperClone.style.height = `${naturalHeight}px`
      paperClone.style.minWidth = `${naturalWidth}px`
      paperClone.style.minHeight = `${naturalHeight}px`

      // Apply the stored font to the clone
      if (paperFontFamily) {
        paperClone.style.fontFamily = paperFontFamily
      }

      // Apply stored fonts to all cloned descendants
      const allClonedElements = paperClone.querySelectorAll('*')
      allClonedElements.forEach((el, index) => {
        if (el instanceof HTMLElement && index < allOriginalElements.length) {
          const originalEl = allOriginalElements[index]
          const storedFont = fontStyleMap.get(originalEl)
          if (storedFont) {
            el.style.fontFamily = storedFont
          }
        }
      })

      // For Firefox: Ensure fonts are applied by adding explicit font-family
      const needsExplicitFonts = navigator.userAgent.toLowerCase().includes('firefox')
      if (needsExplicitFonts) {

        // Get the typography mode from data attribute
        const typography = document.querySelector('[data-typography]')?.getAttribute('data-typography') || 'modern'
        const bodyFont = typography === 'modern' ? 'Roboto Slab' : 'EB Garamond'
        const headingFont = 'Barlow Condensed'

        // Apply heading font to all heading elements
        paperClone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
          const htmlEl = el as HTMLElement
          if (!htmlEl.style.fontFamily || htmlEl.style.fontFamily === 'inherit') {
            htmlEl.style.fontFamily = `"${headingFont}", sans-serif`
            htmlEl.style.fontWeight = '700'
          }
        })

        // Apply body font to all text elements
        paperClone.querySelectorAll('p, li, td, span, div').forEach(el => {
          const htmlEl = el as HTMLElement
          // Skip if it already has a specific font set or is a code element
          if (!htmlEl.style.fontFamily || htmlEl.style.fontFamily === 'inherit') {
            // Don't override code blocks or syntax highlighting
            const className = htmlEl.className
            if (!htmlEl.closest('pre') && !htmlEl.closest('code') && !className.includes('hljs')) {
              htmlEl.style.fontFamily = `"${bodyFont}", serif`
            }
          }
        })

        // Ensure code blocks keep their monospace font
        paperClone.querySelectorAll('pre, code, .hljs').forEach(el => {
          const htmlEl = el as HTMLElement
          htmlEl.style.fontFamily = 'monospace'
        })
      }

      // Ensure strong/bold elements have proper font-weight and color
      const foregroundColor = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim()
      paperClone.querySelectorAll('strong, b').forEach(el => {
        const htmlEl = el as HTMLElement
        htmlEl.style.fontWeight = '600'
        if (foregroundColor) {
          htmlEl.style.color = `hsl(${foregroundColor})`
        }
      })

      // Ensure em/italic elements have proper font-style
      paperClone.querySelectorAll('em, i').forEach(el => {
        const htmlEl = el as HTMLElement
        htmlEl.style.fontStyle = 'italic'
      })

      // Handle Excalidraw dual images - show the correct theme variant
      const isDarkMode = document.documentElement.classList.contains('dark')
      paperClone.querySelectorAll('.excalidraw-light').forEach(el => {
        const imgEl = el as HTMLElement
        if (isDarkMode) {
          imgEl.style.cssText = 'display: none !important; position: absolute; width: 0; height: 0;'
        } else {
          imgEl.style.display = 'block'
        }
      })
      paperClone.querySelectorAll('.excalidraw-dark').forEach(el => {
        const imgEl = el as HTMLElement
        if (isDarkMode) {
          imgEl.style.display = 'block'
        } else {
          imgEl.style.cssText = 'display: none !important; position: absolute; width: 0; height: 0;'
        }
      })
      // Remove margins from Excalidraw wrappers
      paperClone.querySelectorAll('.excalidraw-wrapper').forEach(el => {
        const wrapperEl = el as HTMLElement
        wrapperEl.style.margin = '0'
        wrapperEl.style.padding = '0'
        let parent = wrapperEl.parentElement
        while (parent && parent !== paperClone) {
          if (parent.tagName === 'P' || parent.tagName === 'DIV' || parent.tagName === 'FIGURE') {
            parent.style.margin = '0'
            parent.style.padding = '0'
          }
          parent = parent.parentElement
        }
      })
      paperClone.querySelectorAll('figure').forEach(el => {
        const fig = el as HTMLElement
        fig.style.margin = '0'
      })

      // Clean up images for capture
      const images = paperClone.querySelectorAll('img')
      for (const img of Array.from(images)) {
        const imgEl = img as HTMLImageElement
        if (imgEl.src.includes('missing-file') || imgEl.src.includes('.mp4')) {
          imgEl.style.display = 'none'
          continue
        }
        imgEl.removeAttribute('data-nimg')
        imgEl.removeAttribute('loading')
        imgEl.removeAttribute('decoding')
        if (!imgEl.style.display || imgEl.style.display === 'none') {
          imgEl.style.display = 'block'
        }
      }

      // Remove video elements
      const videos = paperClone.querySelectorAll('video, source')
      for (const video of Array.from(videos)) {
        video.remove()
      }

      // Copy canvas pixel data from original to cloned canvases
      const originalCanvases = paperElement.querySelectorAll('canvas')
      const clonedCanvases = paperClone.querySelectorAll('canvas')

      originalCanvases.forEach((originalCanvas, index) => {
        const clonedCanvas = clonedCanvases[index] as HTMLCanvasElement | undefined
        if (clonedCanvas && originalCanvas instanceof HTMLCanvasElement) {
          clonedCanvas.width = originalCanvas.width
          clonedCanvas.height = originalCanvas.height
          const ctx = clonedCanvas.getContext('2d')
          if (ctx) {
            try {
              ctx.drawImage(originalCanvas, 0, 0)
            } catch (e) {
              console.warn('Could not copy canvas content:', e)
            }
          }
        }
      })

      // Append the paper clone to the wrapper
      wrapper.appendChild(paperClone)

      // Find and include the annotation canvas
      const annotationCanvas = document.querySelector('.annotation-canvas') as HTMLCanvasElement
      if (annotationCanvas) {
        const canvasParent = annotationCanvas.parentElement
        if (canvasParent) {
          const canvasClone = document.createElement('canvas')
          canvasClone.width = annotationCanvas.width
          canvasClone.height = annotationCanvas.height
          canvasClone.style.width = annotationCanvas.style.width
          canvasClone.style.height = annotationCanvas.style.height
          canvasClone.className = annotationCanvas.className

          const ctx = canvasClone.getContext('2d')
          if (ctx) {
            ctx.drawImage(annotationCanvas, 0, 0)
          }

          const canvasRect = canvasParent.getBoundingClientRect()
          const canvasOffsetLeft = (canvasRect.left - paperRect.left) / zoom
          const canvasOffsetTop = (canvasRect.top - paperRect.top) / zoom

          canvasClone.style.position = 'absolute'
          canvasClone.style.left = `${canvasOffsetLeft - logicalLeft}px`
          canvasClone.style.top = `${canvasOffsetTop - logicalTop}px`
          canvasClone.style.zIndex = '10'

          wrapper.appendChild(canvasClone)
        }
      }

      // Append wrapper to body temporarily for capture
      document.body.appendChild(wrapper)

      // DEBUG MODE: Keep wrapper visible for inspection
      const DEBUG_MODE = false

      if (DEBUG_MODE) {
        wrapper.style.position = 'fixed'
        wrapper.style.left = '10px'
        wrapper.style.top = '10px'
        wrapper.style.zIndex = '9999'
        wrapper.style.border = '2px solid red'
        wrapper.style.backgroundColor = 'white'

        const debugLabel = document.createElement('div')
        debugLabel.style.position = 'absolute'
        debugLabel.style.top = '-25px'
        debugLabel.style.left = '0'
        debugLabel.style.background = 'red'
        debugLabel.style.color = 'white'
        debugLabel.style.padding = '2px 5px'
        debugLabel.style.fontSize = '12px'
        debugLabel.style.fontFamily = 'monospace'
        debugLabel.textContent = 'DEBUG: Snap Preview (click X to remove)'
        wrapper.appendChild(debugLabel)

        const closeBtn = document.createElement('button')
        closeBtn.textContent = 'X'
        closeBtn.style.position = 'absolute'
        closeBtn.style.top = '-25px'
        closeBtn.style.right = '0'
        closeBtn.style.background = 'red'
        closeBtn.style.color = 'white'
        closeBtn.style.border = 'none'
        closeBtn.style.padding = '2px 8px'
        closeBtn.style.cursor = 'pointer'
        closeBtn.style.fontSize = '12px'
        closeBtn.onclick = () => document.body.removeChild(wrapper)
        wrapper.appendChild(closeBtn)
      }

      // Wait for fonts to load
      await document.fonts.ready

      // Force a reflow to ensure fonts are applied
      wrapper.offsetHeight

      // Capture as JPEG with quality compression
      const imageUrl = await toJpeg(wrapper, {
        quality: 0.9,
        skipFonts: true,
        style: {
          position: 'static',
          left: 'auto',
          top: 'auto',
          transform: 'none'
        },
        filter: (node: Element) => {
          if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE') {
            return false
          }
          if (node.tagName === 'IMG') {
            const img = node as HTMLImageElement
            if (img.src.includes('missing-file') || img.src.includes('.mp4')) {
              return false
            }
          }
          return true
        }
      } as any)

      // Clean up
      if (!DEBUG_MODE) {
        document.body.removeChild(wrapper)
        document.body.removeChild(animOverlay)
      }

      if (!imageUrl) {
        console.error('Failed to capture image')
        onCancel()
        return
      }

      // Create snap with auto-generated name
      // Determine which section the snap belongs to
      const snapCenterY = snapTop + height / 2
      let sectionId: string | undefined
      let sectionOffsetY: number | undefined

      if (headingPositions.length > 0) {
        const sortedHeadings = [...headingPositions].sort((a, b) => a.offsetY - b.offsetY)
        for (let i = sortedHeadings.length - 1; i >= 0; i--) {
          if (snapCenterY >= sortedHeadings[i].offsetY) {
            sectionId = sortedHeadings[i].sectionId
            sectionOffsetY = sortedHeadings[i].offsetY
            break
          }
        }
      }

      const snap: Snap = {
        id: Date.now().toString(),
        name: `snap${nextSnapNumber}`,
        imageUrl,
        top: snapTop,
        left: snapLeft,
        width,
        height,
        sectionId,
        sectionOffsetY,
      }

      onCapture(snap)
    } catch (error) {
      console.error('Error capturing screenshot:', error)
      onCancel()
    } finally {
      setIsCapturing(false)
    }
  }, [zoom, onCapture, onCancel, nextSnapNumber, headingPositions])

  // Expose programmatic capture method (DEV ONLY)
  useImperativeHandle(ref, () => ({
    triggerCapture: async (x1: number, y1: number, x2: number, y2: number) => {
      const left = Math.min(x1, x2)
      const top = Math.min(y1, y2)
      const width = Math.abs(x2 - x1)
      const height = Math.abs(y2 - y1)

      if (width < 20 || height < 20) {
        console.warn('Selection too small (minimum 20x20)')
        return
      }

      await performCapture(left, top, width, height)
    }
  }), [performCapture])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Don't start new selection while capturing
    if (isCapturing) return

    // Only start dragging on left click/primary button
    if (e.button !== 0) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    // Capture pointer to receive all events during drag
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

    setIsDragging(true)
    // Account for zoom transform - divide by zoom to get logical coordinates
    setStartPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
    setCurrentPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
  }, [zoom, isCapturing])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !startPos || isCapturing) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    // Account for zoom transform - divide by zoom to get logical coordinates
    setCurrentPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
  }, [isDragging, startPos, zoom, isCapturing])

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    // Release pointer capture
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // Ignore if not captured (e.g., programmatic trigger)
    }

    if (!isDragging || !startPos || !currentPos || isCapturing) {
      setIsDragging(false)
      setStartPos(null)
      setCurrentPos(null)
      return
    }

    // Calculate selection rectangle
    const left = Math.min(startPos.x, currentPos.x)
    const top = Math.min(startPos.y, currentPos.y)
    const width = Math.abs(currentPos.x - startPos.x)
    const height = Math.abs(currentPos.y - startPos.y)

    // Ignore very small selections (likely accidental clicks)
    if (width < 20 || height < 20) {
      setIsDragging(false)
      setStartPos(null)
      setCurrentPos(null)
      return
    }

    // Delegate to shared capture logic
    await performCapture(left, top, width, height)

    // Reset state
    setIsDragging(false)
    setStartPos(null)
    setCurrentPos(null)
  }, [isDragging, startPos, currentPos, isCapturing, performCapture])

  // Calculate selection rectangle for display (in viewport coordinates)
  // startPos/currentPos are in logical coords (divided by zoom), multiply back for display
  const selectionRect = startPos && currentPos ? {
    left: Math.min(startPos.x, currentPos.x) * zoom,
    top: Math.min(startPos.y, currentPos.y) * zoom,
    width: Math.abs(currentPos.x - startPos.x) * zoom,
    height: Math.abs(currentPos.y - startPos.y) * zoom
  } : null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 cursor-crosshair"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        touchAction: 'none' // Prevent browser handling of touch events
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      {/* Selection rectangle */}
      {selectionRect && (
        <div
          className="absolute border-2 border-primary bg-primary/10"
          style={{
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            pointerEvents: 'none'
          }}
        >
          {/* Size indicator */}
          <div className="absolute -top-8 left-0 bg-background/95 backdrop-blur border border-border/50 px-2 py-1 rounded text-xs font-mono text-foreground">
            {Math.round(selectionRect.width)} × {Math.round(selectionRect.height)}
          </div>
        </div>
      )}
    </div>
  )
})
