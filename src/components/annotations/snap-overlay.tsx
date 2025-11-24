'use client'

import { useState, useCallback, useRef } from 'react'
import { toJpeg } from 'html-to-image'

export interface Snap {
  id: string
  name: string
  imageUrl: string
  top: number
  left: number
  width: number
  height: number
}

interface SnapOverlayProps {
  onCapture: (snap: Snap) => void
  onCancel: () => void
  nextSnapNumber: number
  zoom: number
}

export function SnapOverlay({ onCapture, onCancel, nextSnapNumber, zoom }: SnapOverlayProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null)
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start dragging on left click
    if (e.button !== 0) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

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
  }, [zoom])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !startPos) return

    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return

    // Account for zoom transform - divide by zoom to get logical coordinates
    setCurrentPos({
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    })
  }, [isDragging, startPos, zoom])

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!isDragging || !startPos || !currentPos) {
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

    try {
      // Get the paper element (the main content area)
      const paperElement = document.getElementById('paper')
      if (!paperElement) {
        console.error('Could not find paper element')
        onCancel()
        return
      }

      // Hide the selection rectangle before capturing
      const savedCurrentPos = currentPos
      setCurrentPos(null)

      // Wait a tick for React to update
      await new Promise(resolve => setTimeout(resolve, 0))

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

      // For snap positioning: offset from selection
      const snapLeft = logicalLeft + width + 20
      const snapTop = logicalTop + height + 20

      // Create a temporary wrapper to capture only the selected region
      const wrapper = document.createElement('div')
      wrapper.style.position = 'absolute'
      wrapper.style.left = '0'
      wrapper.style.top = '0'
      wrapper.style.width = `${width}px`
      wrapper.style.height = `${height}px`
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
            console.log(`Embedded ${fontInfo.family} (${fontInfo.weight}) as base64`)
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

      console.log('Font CSS length:', fontFaceRules.join('\n').length, 'characters')

      // Also add CSS variable mappings that Next.js uses
      const cssVariables = `
        :root {
          --font-roboto-slab: 'Roboto Slab', serif;
          --font-eb-garamond: 'EB Garamond', serif;
          --font-barlow-condensed: 'Barlow Condensed', sans-serif;
        }
        * {
          font-synthesis: none !important;
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
      // Firefox sometimes needs more explicit font application
      const needsExplicitFonts = navigator.userAgent.toLowerCase().includes('firefox')
      if (needsExplicitFonts) {
        console.log('Firefox detected, applying explicit font styles')

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

          // Copy canvas content
          const ctx = canvasClone.getContext('2d')
          if (ctx) {
            ctx.drawImage(annotationCanvas, 0, 0)
          }

          // Position canvas correctly in the wrapper
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
      const DEBUG_MODE = false  // Set to true for debugging

      if (DEBUG_MODE) {
        // Style wrapper for visibility
        wrapper.style.position = 'fixed'
        wrapper.style.left = '10px'
        wrapper.style.top = '10px'
        wrapper.style.zIndex = '9999'
        wrapper.style.border = '2px solid red'
        wrapper.style.backgroundColor = 'white'

        // Add a label to identify it
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

        // Add close button
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

      // Additional wait for rendering to ensure base64 fonts are applied
      await new Promise(resolve => setTimeout(resolve, 300))

      // Capture as JPEG with quality compression
      // Works with SVG, PNG
      const imageUrl = await toJpeg(wrapper, {
        quality: 0.3,  
        skipFonts: true
      } as any)

      // Clean up: remove the temporary wrapper (only if not in debug mode)
      if (!DEBUG_MODE) {
        document.body.removeChild(wrapper)
      }

      // Restore the selection rectangle
      setCurrentPos(savedCurrentPos)

      if (!imageUrl) {
        console.error('Failed to capture image')
        onCancel()
        return
      }

      // Create snap with auto-generated name
      const snap: Snap = {
        id: Date.now().toString(),
        name: `snap${nextSnapNumber}`,
        imageUrl,
        top: snapTop,
        left: snapLeft,
        width,
        height
      }

      onCapture(snap)
    } catch (error) {
      console.error('Error capturing screenshot:', error)
      onCancel()
    }

    // Reset state
    setIsDragging(false)
    setStartPos(null)
    setCurrentPos(null)
  }, [isDragging, startPos, currentPos, onCapture, onCancel, nextSnapNumber, zoom])

  // Calculate selection rectangle for display
  const selectionRect = startPos && currentPos ? {
    left: Math.min(startPos.x, currentPos.x),
    top: Math.min(startPos.y, currentPos.y),
    width: Math.abs(currentPos.x - startPos.x),
    height: Math.abs(currentPos.y - startPos.y)
  } : null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 cursor-crosshair"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.1)'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
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
}
