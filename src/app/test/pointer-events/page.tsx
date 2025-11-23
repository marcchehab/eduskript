'use client'

import { useState, useRef } from 'react'

interface EventLog {
  timestamp: number
  type: string
  pointerType: string
  buttons: number
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  pointerId: number
  isPrimary: boolean
  width: number
  height: number
}

export default function PointerEventsTest() {
  const [events, setEvents] = useState<EventLog[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [currentDevice, setCurrentDevice] = useState<'pen' | 'mouse' | 'touch' | null>(null)
  const lastPenTimeRef = useRef<number>(0)
  const isPenDownRef = useRef<boolean>(false)

  // Detect device type based on event properties
  const detectDevice = (e: React.PointerEvent | React.MouseEvent | React.TouchEvent, eventType: string): 'pen' | 'mouse' | 'touch' | null => {
    if ('touches' in e) {
      return 'touch'
    }

    if ('pointerId' in e) {
      // Real pen: pointerType='pen' AND pressure !== 0.5
      // Fake mouse (Chromium bug): pointerType='pen' but pressure === 0.5
      const isRealPen = e.pointerType === 'pen' && e.pressure !== 0.5

      if (isRealPen) {
        lastPenTimeRef.current = Date.now()

        // Track pen down state
        const wasPenDown = isPenDownRef.current
        if (eventType === 'pointerdown') {
          isPenDownRef.current = true
        } else if (eventType === 'pointerup') {
          isPenDownRef.current = false
        }

        if (wasPenDown !== isPenDownRef.current) {
          console.log(`[DEBUG] Pen state changed: ${wasPenDown ? 'DOWN' : 'UP'} → ${isPenDownRef.current ? 'DOWN' : 'UP'} (event: ${eventType})`)
        }

        return 'pen'
      }

      // Mouse detection with cooldown
      // IMPORTANT: Don't switch to mouse while pen is down!
      // Chromium sends fake mouse events rapidly interleaved with pen events,
      // so we need a LONG cooldown (2 seconds) to avoid false switches
      if (e.pointerType === 'mouse') {
        const timeSinceLastPen = Date.now() - lastPenTimeRef.current
        const willSwitch = timeSinceLastPen > 2000 && !isPenDownRef.current

        console.log('[DEBUG] Mouse event detected:', {
          eventType,
          timeSinceLastPen,
          isPenDown: isPenDownRef.current,
          pressure: e.pressure,
          willSwitch
        })

        if (willSwitch) {
          return 'mouse'
        }
      }
    }

    return null
  }

  const logEvent = (e: React.PointerEvent | React.MouseEvent | React.TouchEvent, type: string) => {
    try {
      // Detect device and log switch
      const device = detectDevice(e, type)
      if (device && device !== currentDevice) {
        console.log(
          `%c[DEVICE SWITCH] ${currentDevice || 'none'} → ${device} (penDown: ${isPenDownRef.current})`,
          'background: #4CAF50; color: white; font-weight: bold; padding: 2px 5px;'
        )
        setCurrentDevice(device)
      }
    } catch (error) {
      console.error('[ERROR] logEvent failed:', error)
    }


    try {
      if ('pointerId' in e) {
        // Pointer event
        const event: EventLog = {
          timestamp: Date.now(),
          type,
          pointerType: e.pointerType,
          buttons: e.buttons,
          pressure: e.pressure,
          tiltX: e.tiltX,
          tiltY: e.tiltY,
          twist: e.twist,
          pointerId: e.pointerId,
          isPrimary: e.isPrimary,
          width: e.width,
          height: e.height
        }
        setEvents(prev => [...prev, event])
      } else if ('touches' in e) {
        // Touch event
        const event: EventLog = {
          timestamp: Date.now(),
          type,
          pointerType: 'touch',
          buttons: 0,
          pressure: 1.0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          pointerId: -1,
          isPrimary: true,
          width: 0,
          height: 0
        }
        setEvents(prev => [...prev, event])
      } else {
        // Mouse event
        const event: EventLog = {
          timestamp: Date.now(),
          type,
          pointerType: 'mouse',
          buttons: e.buttons,
          pressure: 0,
          tiltX: 0,
          tiltY: 0,
          twist: 0,
          pointerId: -1,
          isPrimary: true,
          width: 0,
          height: 0
        }
        setEvents(prev => [...prev, event])
      }
    } catch (error) {
      console.error('[ERROR] Event logging failed:', error)
    }
  }

  const copyToClipboard = () => {
    const text = events.map(e =>
      `${e.type.padEnd(20)} | pointerType: ${e.pointerType.padEnd(6)} | buttons: ${e.buttons} | pressure: ${e.pressure.toFixed(3)} | tiltX: ${e.tiltX.toString().padStart(3)} | tiltY: ${e.tiltY.toString().padStart(3)} | twist: ${e.twist.toString().padStart(3)} | id: ${e.pointerId.toString().padStart(3)} | primary: ${e.isPrimary} | w: ${e.width.toFixed(1)} | h: ${e.height.toFixed(1)}`
    ).join('\n')

    navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  }

  const clear = () => {
    setEvents([])
  }

  return (
    <div className="min-h-screen p-8 bg-background">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Pointer Events Test</h1>
        <p className="mb-4 text-muted-foreground">
          Draw on the canvas below with both your pen and mouse. Device switches will be logged to console.
        </p>

        {/* Current Device Indicator */}
        <div className="mb-4 p-4 bg-card border border-border rounded-lg">
          <div className="text-sm font-semibold mb-2">Current Device:</div>
          <div className="text-2xl font-bold">
            {currentDevice === 'pen' && <span className="text-blue-600">🖊️ PEN</span>}
            {currentDevice === 'mouse' && <span className="text-green-600">🖱️ MOUSE</span>}
            {currentDevice === 'touch' && <span className="text-purple-600">👆 TOUCH</span>}
            {!currentDevice && <span className="text-muted-foreground">None detected</span>}
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={copyToClipboard}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={clear}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
          >
            Clear
          </button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="w-full h-96 border-2 border-border rounded bg-card mb-4 cursor-crosshair"
          // Pointer Events
          onPointerDown={(e) => logEvent(e, 'pointerdown')}
          onPointerMove={(e) => logEvent(e, 'pointermove')}
          onPointerUp={(e) => logEvent(e, 'pointerup')}
          onPointerEnter={(e) => logEvent(e, 'pointerenter')}
          onPointerLeave={(e) => {
            logEvent(e, 'pointerleave')
            // Release pointer capture to prevent input lockup
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onPointerCancel={(e) => logEvent(e, 'pointercancel')}
          onPointerOver={(e) => logEvent(e, 'pointerover')}
          onPointerOut={(e) => {
            logEvent(e, 'pointerout')
            // Release pointer capture to prevent input lockup
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          }}
          onGotPointerCapture={(e) => logEvent(e, 'gotpointercapture')}
          onLostPointerCapture={(e) => logEvent(e, 'lostpointercapture')}
          // Mouse Events
          onMouseDown={(e) => logEvent(e, 'mousedown')}
          onMouseMove={(e) => logEvent(e, 'mousemove')}
          onMouseUp={(e) => logEvent(e, 'mouseup')}
          onMouseEnter={(e) => logEvent(e, 'mouseenter')}
          onMouseLeave={(e) => logEvent(e, 'mouseleave')}
          onMouseOver={(e) => logEvent(e, 'mouseover')}
          onMouseOut={(e) => logEvent(e, 'mouseout')}
          onClick={(e) => logEvent(e, 'click')}
          onDoubleClick={(e) => logEvent(e, 'dblclick')}
          onContextMenu={(e) => logEvent(e, 'contextmenu')}
          // Touch Events
          onTouchStart={(e) => logEvent(e, 'touchstart')}
          onTouchMove={(e) => logEvent(e, 'touchmove')}
          onTouchEnd={(e) => logEvent(e, 'touchend')}
          onTouchCancel={(e) => logEvent(e, 'touchcancel')}
        >
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Draw here with pen, mouse, or touch
          </div>
        </div>

        {/* Event Log */}
        <div className="bg-card border border-border rounded p-4">
          <h2 className="text-xl font-semibold mb-2">Event Log ({events.length} events)</h2>
          <div className="font-mono text-xs overflow-auto max-h-96 bg-muted p-2 rounded">
            {events.length === 0 ? (
              <div className="text-muted-foreground">No events yet. Draw on the canvas above.</div>
            ) : (
              events.map((e, i) => (
                <div key={i} className="whitespace-nowrap">
                  <span className="text-muted-foreground">{i.toString().padStart(4, '0')}</span>
                  {' | '}
                  <span className="font-bold">{e.type.padEnd(20)}</span>
                  {' | '}
                  <span>type: <span className="text-blue-600 dark:text-blue-400">{e.pointerType.padEnd(6)}</span></span>
                  {' | '}
                  <span>btn: {e.buttons}</span>
                  {' | '}
                  <span>pressure: {e.pressure.toFixed(3)}</span>
                  {' | '}
                  <span>tiltX: {e.tiltX.toString().padStart(3)}</span>
                  {' | '}
                  <span>tiltY: {e.tiltY.toString().padStart(3)}</span>
                  {' | '}
                  <span>twist: {e.twist.toString().padStart(3)}</span>
                  {' | '}
                  <span>id: {e.pointerId.toString().padStart(3)}</span>
                  {' | '}
                  <span>1°: {e.isPrimary ? '✓' : '✗'}</span>
                  {' | '}
                  <span>w: {e.width.toFixed(1)}</span>
                  {' | '}
                  <span>h: {e.height.toFixed(1)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 p-4 bg-muted rounded">
          <h3 className="font-semibold mb-2">Instructions:</h3>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Draw on the canvas with your mouse</li>
            <li>Draw on the canvas with your pen</li>
            <li>Click "Copy to Clipboard" to copy all events</li>
            <li>Paste the data to analyze differences between pen and mouse</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
