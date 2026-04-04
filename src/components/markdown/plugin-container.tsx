'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { useUserData } from '@/lib/userdata/hooks'
import { buildPluginSrcdoc } from '@/lib/plugin-sdk'

interface PluginContainerProps {
  /** Plugin reference: "ownerPageSlug/pluginSlug" */
  src: string
  /** Stable ID for UserData persistence (auto-generated if omitted) */
  id?: string
  /** Override default height */
  height?: string | number
  /** Page ID for UserData persistence (from markdown context) */
  pageId?: string
  /** All other attributes become plugin config */
  [key: string]: unknown
}

interface PluginMessage {
  type: string
  data?: unknown
  height?: number
  requestId?: number
}

const MAX_DATA_SIZE = 1_000_000 // 1MB
const RATE_LIMIT_INTERVAL = 500 // 2 calls/second
const READY_TIMEOUT = 5000
const UNRESPONSIVE_TIMEOUT = 30000

/**
 * Renders a plugin in a sandboxed iframe with postMessage RPC.
 * Handles UserData persistence, theme sync, auto-resize, and error boundaries.
 */
export function PluginContainer({
  src,
  id,
  height: heightProp,
  pageId,
  ...configProps
}: PluginContainerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const lastSetDataTime = useRef(0)
  const readyReceived = useRef(false)

  const [iframeHeight, setIframeHeight] = useState<number>(
    typeof heightProp === 'number' ? heightProp : parseInt(String(heightProp)) || 0,
  )
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unresponsive'>('loading')
  const [pluginHtml, setPluginHtml] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const { resolvedTheme } = useTheme()

  // Parse src into ownerSlug/pluginSlug — format: "ownerPageSlug/pluginSlug"
  const slashIndex = src.indexOf('/')
  const ownerSlug = slashIndex > 0 ? src.slice(0, slashIndex) : ''
  const pluginSlug = slashIndex > 0 ? src.slice(slashIndex + 1) : src
  const validSrc = !!(ownerSlug && pluginSlug)

  // Stable component ID for UserData
  const componentId = `plugin-${id || src}`

  // UserData hook for persistence
  const { data: userData, updateData } = useUserData<Record<string, unknown>>(
    pageId || '',
    componentId,
    null,
  )

  // Fetch plugin HTML from API
  useEffect(() => {
    if (!validSrc) return

    let cancelled = false

    fetch(`/api/plugins/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(pluginSlug)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Plugin not found: ${src}`)
        return res.json()
      })
      .then((json) => {
        if (!cancelled) {
          setPluginHtml(json.plugin.entryHtml)
          // Use defaultHeight from manifest if no explicit height prop
          const manifest = json.plugin.manifest as { defaultHeight?: number } | undefined
          if (!heightProp && manifest?.defaultHeight) {
            setIframeHeight(manifest.defaultHeight)
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(err.message)
          setStatus('error')
        }
      })

    return () => { cancelled = true }
  }, [validSrc, ownerSlug, pluginSlug, src])

  // Extract config from remaining props (filter out internal/React props and data-* attributes)
  const config = Object.fromEntries(
    Object.entries(configProps).filter(
      ([key]) => !key.startsWith('data-') && key !== 'className' && key !== 'style',
    ),
  )

  // Extract data-* attributes to forward to wrapper div (for annotation system tracking)
  const dataAttrs = Object.fromEntries(
    Object.entries(configProps).filter(([key]) => key.startsWith('data-')),
  )

  // Send message to iframe
  const sendToPlugin = useCallback((msg: Record<string, unknown>) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(msg, '*')
    }
  }, [])

  // Forward zoom gestures from iframe to parent document so annotation-layer handles them.
  // Iframes have their own document, so wheel/touch events inside don't bubble to the parent.
  useEffect(() => {
    const handleZoomMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const msg = event.data
      if (!msg || typeof msg.type !== 'string') return

      if (msg.type === 'plugin:zoomWheel') {
        // Convert iframe-relative coords to parent-relative coords
        const rect = iframeRef.current.getBoundingClientRect()
        const syntheticWheel = new WheelEvent('wheel', {
          deltaY: msg.deltaY,
          clientX: rect.left + (msg.clientX || 0),
          clientY: rect.top + (msg.clientY || 0),
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        document.dispatchEvent(syntheticWheel)
      }

      if (msg.type === 'plugin:zoomTouchMove' && msg.ratio) {
        // Convert incremental touch pinch ratio to synthetic ctrl+wheel.
        // ratio > 1 means fingers spreading (zoom in) → negative deltaY.
        // The parent handler does: delta = -deltaY * 0.01, newZoom = current * (1 + delta)
        // We want newZoom = current * ratio, so (1 + delta) = ratio, delta = ratio - 1
        // Therefore deltaY = -(ratio - 1) / 0.01 = -(ratio - 1) * 100
        const deltaY = -(msg.ratio - 1) * 100
        // centerX/centerY are in screen coordinates (immune to CSS transforms).
        // Convert to parent viewport client coords using window.screenX/screenY
        // plus chrome offsets (outerWidth/Height - innerWidth/Height).
        const chromeLeft = (window.outerWidth - window.innerWidth) / 2
        const chromeTop = window.outerHeight - window.innerHeight - chromeLeft
        const clientX = msg.centerX - window.screenX - chromeLeft
        const clientY = msg.centerY - window.screenY - chromeTop
        const syntheticWheel = new WheelEvent('wheel', {
          deltaY,
          clientX,
          clientY,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        document.dispatchEvent(syntheticWheel)
      }
    }

    window.addEventListener('message', handleZoomMessage)
    return () => window.removeEventListener('message', handleZoomMessage)
  }, [])

  // Handle messages from plugin iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent<PluginMessage>) => {
      // Validate source is our iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return

      const msg = event.data
      if (!msg || typeof msg.type !== 'string') return

      switch (msg.type) {
        case 'plugin:ready': {
          readyReceived.current = true
          setStatus('ready')
          // Respond with init data
          sendToPlugin({
            type: 'host:init',
            config,
            data: userData,
            theme: resolvedTheme || 'light',
          })
          break
        }

        case 'plugin:resize': {
          const h = typeof msg.height === 'number' ? msg.height : 0
          if (h > 0 && h < 50000) {
            setIframeHeight(h)
          }
          break
        }

        case 'plugin:setData': {
          // Rate limit
          const now = Date.now()
          if (now - lastSetDataTime.current < RATE_LIMIT_INTERVAL) return
          lastSetDataTime.current = now

          // Size validation
          const serialized = JSON.stringify(msg.data)
          if (serialized.length > MAX_DATA_SIZE) {
            console.warn(`Plugin ${src}: data exceeds ${MAX_DATA_SIZE} byte limit`)
            return
          }

          // Persist via UserData
          if (pageId) {
            updateData(msg.data as Record<string, unknown>)
          }
          break
        }

        case 'plugin:getData': {
          sendToPlugin({
            type: 'host:data',
            requestId: msg.requestId,
            data: userData,
          })
          break
        }

        case 'plugin:requestFullscreen': {
          if (iframeRef.current?.requestFullscreen) {
            iframeRef.current.requestFullscreen().catch(() => {
              // Fullscreen request denied by browser
            })
          }
          break
        }

        case 'plugin:exitFullscreen': {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
          }
          break
        }
      }
    }

    // Notify plugin when fullscreen state changes
    const handleFullscreenChange = () => {
      const isFs = document.fullscreenElement === iframeRef.current
      sendToPlugin({ type: 'host:fullscreenChange', isFullscreen: isFs })
    }

    window.addEventListener('message', handleMessage)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      window.removeEventListener('message', handleMessage)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [config, userData, resolvedTheme, sendToPlugin, src, pageId, updateData])

  // Push theme changes to plugin
  useEffect(() => {
    if (status === 'ready') {
      sendToPlugin({ type: 'host:themeChange', theme: resolvedTheme || 'light' })
    }
  }, [resolvedTheme, status, sendToPlugin])

  // Push external data changes to plugin (e.g. from sync or broadcast)
  const prevUserDataRef = useRef(userData)
  useEffect(() => {
    if (status === 'ready' && userData !== prevUserDataRef.current) {
      prevUserDataRef.current = userData
      sendToPlugin({ type: 'host:dataChanged', data: userData })
    }
  }, [userData, status, sendToPlugin])

  // Ready timeout — show error if plugin never sends plugin:ready
  useEffect(() => {
    if (!pluginHtml) return

    const readyTimer = setTimeout(() => {
      if (!readyReceived.current) {
        setStatus('error')
      }
    }, READY_TIMEOUT)

    const unresponsiveTimer = setTimeout(() => {
      if (!readyReceived.current) {
        setStatus('unresponsive')
      }
    }, UNRESPONSIVE_TIMEOUT)

    return () => {
      clearTimeout(readyTimer)
      clearTimeout(unresponsiveTimer)
    }
  }, [pluginHtml])

  // Invalid src format
  if (!validSrc) {
    return (
      <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">Invalid plugin src: &quot;{src}&quot;</p>
        <p className="mt-1 text-xs opacity-75">
          Format: &lt;plugin src=&quot;ownerPageSlug/pluginSlug&quot;&gt;&lt;/plugin&gt;
        </p>
      </div>
    )
  }

  // Error/loading states
  if (fetchError || status === 'error') {
    return (
      <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">Plugin failed to load: {src}</p>
        {fetchError && <p className="mt-1 text-xs opacity-75">{fetchError}</p>}
        <button
          onClick={() => {
            setFetchError(null)
            setStatus('loading')
            setPluginHtml(null)
            readyReceived.current = false
          }}
          className="mt-2 text-xs underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (status === 'unresponsive') {
    return (
      <div className="my-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
        <p className="font-medium">Plugin &quot;{src}&quot; is unresponsive</p>
      </div>
    )
  }

  const srcdoc = pluginHtml ? buildPluginSrcdoc(pluginHtml, resolvedTheme) : undefined

  return (
    <div className="my-4" {...dataAttrs}>
      {status === 'loading' && (
        <div className="flex items-center justify-center rounded-lg border border-muted bg-muted/20 p-8 text-sm text-muted-foreground"
          style={{ height: iframeHeight }}
        >
          Loading plugin...
        </div>
      )}
      {srcdoc && (
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin"
          allowFullScreen
          srcDoc={srcdoc}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...{ allowtransparency: 'true' } as any}
          style={{
            border: 'none',
            width: '100%',
            height: iframeHeight,
            display: status === 'loading' ? 'none' : 'block',
            colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light',
          }}
          title={`Plugin: ${src}`}
        />
      )}
    </div>
  )
}
