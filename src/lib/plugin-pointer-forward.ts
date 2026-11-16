/**
 * Pointer input for plugins under the annotation canvas.
 *
 * While a pen is selected or stylus mode is on, the annotation canvas covers
 * the whole paper (annotation-layer.tsx), so a pen never reaches a plugin
 * iframe: a student drawing in a plugin would annotate the page instead. A
 * plugin that is a drawing surface calls `plugin.capturePointer(true)`; the
 * container marks its iframe with PLUGIN_POINTER_ATTR, and the canvas hands
 * every gesture that starts over such an iframe to the plugin instead of
 * drawing (simple-canvas.tsx). The SDK replays the gesture inside the iframe
 * as synthetic pointer events (plugin-sdk.ts, 'host:pointer').
 *
 * Pen and mouse gestures only; touch keeps the canvas's own rules. A gesture
 * that stays within 6 px and 600 ms is also replayed as a click, so buttons
 * inside the plugin work with the pen.
 *
 * Limitations: the replayed events are untrusted (isTrusted false), carry no
 * coalesced points, tilt or hover, and setPointerCapture on them throws, so a
 * plugin has to guard that call. Without a pointer-down in the parent nothing
 * is forwarded: when the canvas is not covering the paper (view mode), the
 * iframe gets the real events as before.
 */

/** Set on a plugin iframe while its plugin asks for pointer input. */
export const PLUGIN_POINTER_ATTR = 'data-pointer-input'

export type PointerPhase = 'down' | 'move' | 'up'

/** The topmost plugin iframe asking for pointer input at a viewport point, or null. */
export function pointerInputFrameAt(clientX: number, clientY: number): HTMLIFrameElement | null {
  // Missing in jsdom (unit tests) and very old browsers: then nothing is forwarded.
  if (typeof document.elementsFromPoint !== 'function') return null
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    if (el instanceof HTMLIFrameElement && el.getAttribute(PLUGIN_POINTER_ATTR) === 'true') return el
  }
  return null
}

interface PointerLike {
  clientX: number
  clientY: number
  pointerId: number
  pointerType: string
  pressure: number
}

/**
 * Sends one point of a gesture to the plugin, in the iframe's own CSS pixels:
 * the paper can be scaled by a CSS transform (zoom), so the viewport offset is
 * divided by the scale the iframe is shown at.
 */
export function forwardPointer(iframe: HTMLIFrameElement, phase: PointerPhase, e: PointerLike) {
  const rect = iframe.getBoundingClientRect()
  if (!iframe.contentWindow || rect.width === 0 || rect.height === 0) return
  iframe.contentWindow.postMessage({
    type: 'host:pointer',
    phase,
    x: (e.clientX - rect.left) * (iframe.clientWidth / rect.width),
    y: (e.clientY - rect.top) * (iframe.clientHeight / rect.height),
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    pressure: e.pressure,
  }, '*')
}
