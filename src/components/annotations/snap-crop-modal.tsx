'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface SnapCropModalProps {
  blob: Blob
  onConfirm: (dataUrl: string, naturalW: number, naturalH: number) => void
  onCancel: () => void
}

// Which part of the crop rect the user is dragging
type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

interface CropRect {
  x: number  // image-space (unscaled)
  y: number
  w: number
  h: number
}

export function SnapCropModal({ blob, onConfirm, onCancel }: SnapCropModalProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })
  // scale is state (not a ref) so render can use it safely
  const [scale, setScale] = useState(1)
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 })

  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    handle: DragHandle
    startClientX: number
    startClientY: number
    startCrop: CropRect
  } | null>(null)

  // Create object URL for the blob
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  // Once image loads, calculate display size and default to full-image crop
  const handleImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const maxW = window.innerWidth * 0.85
    const maxH = window.innerHeight * 0.8
    const s = Math.min(1, maxW / nw, maxH / nh)
    setScale(s)
    setNaturalSize({ w: nw, h: nh })
    setDisplaySize({ w: nw * s, h: nh * s })
    setCropRect({ x: 0, y: 0, w: nw, h: nh })
  }

  const handlePointerDown = useCallback((e: React.PointerEvent, handle: DragHandle) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: { ...cropRect },
    }
  }, [cropRect])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const { handle, startClientX, startClientY, startCrop } = dragRef.current
    // Convert display-pixel delta to image-pixel delta
    const dx = (e.clientX - startClientX) / scale
    const dy = (e.clientY - startClientY) / scale
    const imgW = naturalSize.w
    const imgH = naturalSize.h
    const MIN = 20

    let { x, y, w, h } = startCrop

    if (handle === 'move') {
      x = Math.max(0, Math.min(imgW - w, startCrop.x + dx))
      y = Math.max(0, Math.min(imgH - h, startCrop.y + dy))
    } else {
      if (handle.includes('e')) {
        w = Math.max(MIN, Math.min(imgW - startCrop.x, startCrop.w + dx))
      }
      if (handle.includes('w')) {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.w - MIN, startCrop.x + dx))
        w = startCrop.x + startCrop.w - newX
        x = newX
      }
      if (handle.includes('s')) {
        h = Math.max(MIN, Math.min(imgH - startCrop.y, startCrop.h + dy))
      }
      if (handle.includes('n')) {
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.h - MIN, startCrop.y + dy))
        h = startCrop.y + startCrop.h - newY
        y = newY
      }
    }
    setCropRect({ x, y, w, h })
  }, [naturalSize, scale])

  const handlePointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const handleConfirm = () => {
    const img = imgRef.current
    if (!img) return
    const sx = Math.round(cropRect.x)
    const sy = Math.round(cropRect.y)
    const sw = Math.round(cropRect.w)
    const sh = Math.round(cropRect.h)
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    onConfirm(canvas.toDataURL('image/jpeg', 0.9), sw, sh)
  }

  if (!imgUrl) return null

  // Crop rect in display coordinates (scale is state — safe to use during render)
  const dx = cropRect.x * scale
  const dy = cropRect.y * scale
  const dw = cropRect.w * scale
  const dh = cropRect.h * scale

  const handles: { id: DragHandle; style: React.CSSProperties }[] = [
    { id: 'nw', style: { top: -5, left: -5, cursor: 'nwse-resize' } },
    { id: 'n',  style: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { id: 'ne', style: { top: -5, right: -5, cursor: 'nesw-resize' } },
    { id: 'e',  style: { top: '50%', right: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    { id: 'se', style: { bottom: -5, right: -5, cursor: 'nwse-resize' } },
    { id: 's',  style: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { id: 'sw', style: { bottom: -5, left: -5, cursor: 'nesw-resize' } },
    { id: 'w',  style: { top: '50%', left: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  ]

  const content = (
    <div className="fixed inset-0 z-200 bg-black/80 flex flex-col items-center justify-center gap-6 select-none">
      {/* Image + crop overlay */}
      <div
        className="relative overflow-hidden"
        style={{ width: displaySize.w, height: displaySize.h }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imgUrl}
          alt="Paste to crop"
          style={{ width: displaySize.w, height: displaySize.h, display: 'block' }}
          onLoad={handleImgLoad}
          draggable={false}
        />

        {/* Spotlight: box-shadow darkens everything outside the crop rect.
            Container overflow:hidden clips the shadow to the image bounds. */}
        <div
          className="absolute border border-white/80"
          style={{
            left: dx,
            top: dy,
            width: dw,
            height: dh,
            cursor: 'move',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
          onPointerDown={(e) => handlePointerDown(e, 'move')}
        >
          {/* 8 resize handles */}
          {handles.map(({ id, style }) => (
            <div
              key={id}
              className="absolute w-3 h-3 bg-white rounded-sm border border-gray-500"
              style={{ ...style, position: 'absolute' }}
              onPointerDown={(e) => handlePointerDown(e, id)}
            />
          ))}
        </div>
      </div>

      <div className="text-white/60 text-sm">Drag to move · Drag handles to crop</div>

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="px-5 py-2 bg-background text-foreground rounded-lg hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Save as Snap
        </button>
      </div>
    </div>
  )

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null
}
