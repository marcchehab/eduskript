'use client'

import { useState, useCallback, useRef } from 'react'
import { toSvg, getFontEmbedCSS } from 'html-to-image'

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
  strokeData?: string
}

// Helper function to create a variable-width stroke as a filled path
function createVariableWidthPath(
  points: Array<{ x: number; y: number; pressure: number }>,
  baseWidth: number
): string {
  if (points.length < 2) return ''

  // Calculate perpendicular offsets for each point based on pressure
  const leftPoints: Array<{ x: number; y: number }> = []
  const rightPoints: Array<{ x: number; y: number }> = []

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    const width = baseWidth * (point.pressure || 0.5)

    // Calculate direction vector
    let dx: number, dy: number
    if (i === 0) {
      // First point: use direction to next point
      dx = points[i + 1].x - point.x
      dy = points[i + 1].y - point.y
    } else if (i === points.length - 1) {
      // Last point: use direction from previous point
      dx = point.x - points[i - 1].x
      dy = point.y - points[i - 1].y
    } else {
      // Middle points: average of directions
      dx = points[i + 1].x - points[i - 1].x
      dy = points[i + 1].y - points[i - 1].y
    }

    // Normalize and calculate perpendicular
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const perpX = -dy / len * width / 2
    const perpY = dx / len * width / 2

    leftPoints.push({ x: point.x + perpX, y: point.y + perpY })
    rightPoints.push({ x: point.x - perpX, y: point.y - perpY })
  }

  // Build the path: left side forward, then right side backward
  let path = `M ${leftPoints[0].x} ${leftPoints[0].y}`

  // Draw left side with curves
  for (let i = 1; i < leftPoints.length; i++) {
    path += ` L ${leftPoints[i].x} ${leftPoints[i].y}`
  }

  // Draw right side backward with curves
  for (let i = rightPoints.length - 1; i >= 0; i--) {
    path += ` L ${rightPoints[i].x} ${rightPoints[i].y}`
  }

  path += ' Z' // Close the path

  return path
}

export function SnapOverlay({ onCapture, onCancel, nextSnapNumber, zoom, strokeData }: SnapOverlayProps) {
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

      // Calculate the selection relative to the paper element
      const scrollTop = window.scrollY || document.documentElement.scrollTop

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

      // Clone the paper element
      const paperClone = paperElement.cloneNode(true) as HTMLElement
      paperClone.style.position = 'absolute'
      paperClone.style.left = `${-logicalLeft}px`
      paperClone.style.top = `${-logicalTop}px`
      // Preserve natural dimensions to prevent reflow
      paperClone.style.width = `${naturalWidth}px`
      paperClone.style.height = `${naturalHeight}px`
      paperClone.style.minWidth = `${naturalWidth}px`
      paperClone.style.minHeight = `${naturalHeight}px`

      // Append paper clone to wrapper
      wrapper.appendChild(paperClone)

      // Apply inline font-family styles to ensure fonts are rendered correctly in the SVG
      // This is needed because @font-face rules don't always work reliably in SVG context
      const typography = document.querySelector('[data-typography]')?.getAttribute('data-typography') || 'modern'
      const bodyFont = typography === 'modern' ? 'Roboto Slab' : 'EB Garamond'
      const headingFont = 'Barlow Condensed'

      // Apply base font to the paper clone itself to cascade
      paperClone.style.fontFamily = `"${bodyFont}", serif`

      // Apply to all text-containing elements, using more specific selectors
      // Include all possible text containers
      const textSelectors = 'p, li, td, th, span, div, blockquote, pre, code, em, strong, b, i, u, a, label, button, figcaption'
      paperClone.querySelectorAll(textSelectors).forEach(el => {
        const htmlEl = el as HTMLElement
        // Only set if not already set and not a heading
        if (!htmlEl.style.fontFamily && !htmlEl.closest('h1, h2, h3, h4, h5, h6')) {
          htmlEl.style.fontFamily = `"${bodyFont}", serif`
        }
      })

      // Apply heading font to all headings
      paperClone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => {
        const htmlEl = el as HTMLElement
        htmlEl.style.fontFamily = `"${headingFont}", sans-serif`
      })

      // Also apply to any elements inside headings (like links)
      paperClone.querySelectorAll('h1 *, h2 *, h3 *, h4 *, h5 *, h6 *').forEach(el => {
        const htmlEl = el as HTMLElement
        htmlEl.style.fontFamily = `"${headingFont}", sans-serif`
      })

      console.log(`Applied inline fonts - Body: ${bodyFont}, Heading: ${headingFont}`)

      // Add pen annotations as SVG paths if we have stroke data
      if (strokeData) {
        try {
          const strokes = JSON.parse(strokeData) as Array<{
            points: Array<{ x: number; y: number; pressure: number }>
            mode: 'draw' | 'erase'
            color: string
            width: number
            sectionId: string
            sectionOffsetY: number
          }>

          // Get paper's padding values
          const paperStyle = window.getComputedStyle(paperElement)
          const paperPaddingLeft = parseFloat(paperStyle.paddingLeft) || 0
          const paperPaddingTop = parseFloat(paperStyle.paddingTop) || 0

          // Create SVG element for annotations
          const annotationSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          annotationSvg.style.position = 'absolute'
          annotationSvg.style.left = '0'
          annotationSvg.style.top = '0'
          annotationSvg.style.width = `${width}px`
          annotationSvg.style.height = `${height}px`
          annotationSvg.style.pointerEvents = 'none'
          annotationSvg.style.zIndex = '10'
          annotationSvg.setAttribute('width', String(width))
          annotationSvg.setAttribute('height', String(height))
          annotationSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)

          // Apply dark mode filter if in dark theme
          const isDarkMode = document.documentElement.classList.contains('dark')
          if (isDarkMode) {
            // Same filter as applied to the canvas in dark mode
            annotationSvg.style.filter = 'invert(1) hue-rotate(180deg)'
          }

          // Add each stroke as a path
          strokes.forEach((stroke) => {
            if (stroke.mode === 'draw' && stroke.points.length >= 2) {
              const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')

              // Adjust points to be relative to the selection
              // The selection coordinates (logicalLeft/Top) are relative to the paper element (including padding)
              // But canvas coordinates are relative to the content inside the padding
              // So we subtract the padding from the logical coordinates
              const adjustedPoints = stroke.points.map(p => ({
                x: p.x - (logicalLeft - paperPaddingLeft),
                y: p.y + stroke.sectionOffsetY - (logicalTop - paperPaddingTop),
                pressure: p.pressure
              }))

              // Check if any points are within the selection area
              const hasVisiblePoints = adjustedPoints.some(p =>
                p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height
              )

              if (hasVisiblePoints) {
                // Create a variable-width path that respects pressure at each point
                const pathData = createVariableWidthPath(adjustedPoints, stroke.width)

                pathElement.setAttribute('d', pathData)
                pathElement.setAttribute('fill', stroke.color)
                pathElement.setAttribute('stroke', 'none') // No stroke, just fill

                annotationSvg.appendChild(pathElement)
              }
            }
          })

          // Append SVG to wrapper
          wrapper.appendChild(annotationSvg)
        } catch (error) {
          console.error('Error adding annotation paths to snap:', error)
        }
      }

      // Append wrapper to body
      document.body.appendChild(wrapper)

      // Try to get font CSS, but fall back to skipFonts if it fails
      let captureOptions: any = {
        quality: 1.0,
        pixelRatio: 2,
        preferredFontFormat: 'woff2'
      }

      // Try to embed fonts
      try {
        const fontEmbedCSS = await getFontEmbedCSS(paperElement)
        captureOptions.fontEmbedCSS = fontEmbedCSS
      } catch (fontError) {
        // getFontEmbedCSS fails in Firefox - use our fallback
        console.warn('Using fallback font embedding:', fontError)

        // Map font hashes to font names (from next-font-manifest.json)
        const fontMap = {
          '4cfd7524de14b24d': { family: 'Roboto Slab', weight: '300' },
          'd9b5d46d9a89ffe6': { family: 'Barlow Condensed', weight: '700' },
          '83afe278b6a6bb3c': { family: 'EB Garamond', weight: '400' },
          'e4505858a30c79c2': { family: 'EB Garamond', weight: '500' },
          // Add weight 600 if it exists
          'a039f99e6e8cf559': { family: 'EB Garamond', weight: '600' }
        }

        let fontFaceRules = ''
        const foundFonts: string[] = []

        document.querySelectorAll('link[rel="preload"][as="font"]').forEach(link => {
          const href = link.getAttribute('href')
          if (href) {
            // Find which font this is by checking the hash
            for (const [hash, font] of Object.entries(fontMap)) {
              if (href.includes(hash)) {
                const url = new URL(href, window.location.origin).href
                foundFonts.push(`${font.family} (${font.weight})`)
                fontFaceRules += `
@font-face {
  font-family: "${font.family}";
  src: url("${url}") format("woff2");
  font-weight: ${font.weight};
  font-style: normal;
  font-display: swap;
}
`
                break
              }
            }
          }
        })

        console.log('Found fonts for embedding:', foundFonts)
        console.log('Font CSS length:', fontFaceRules.length)

        if (fontFaceRules) {
          captureOptions.fontEmbedCSS = fontFaceRules
        }
      }

      // Capture the wrapper (which shows only the selected region)
      const svgDataUrl = await toSvg(wrapper, captureOptions)

      // Clean up: remove the temporary wrapper
      document.body.removeChild(wrapper)

      // Restore the selection rectangle
      setCurrentPos(savedCurrentPos)

      // Use the cropped SVG
      const imageUrl = svgDataUrl

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
