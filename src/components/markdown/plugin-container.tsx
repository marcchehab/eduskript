'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import { useUserData } from '@/lib/userdata/hooks'
import { useCurrentSite } from '@/contexts/current-site-context'
import { buildPluginSrcdoc, pinchRatioToWheelDeltaY } from '@/lib/plugin-sdk'
import { ShareListOptions } from './share-list-options'
import { PLUGIN_SHARE_UPDATED, reportScore, type ShareEntry, type ShareResults } from '@/lib/plugin-share'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { PLUGIN_POINTER_ATTR } from '@/lib/plugin-pointer-forward'

interface PluginContainerProps {
  /** Plugin reference: "ownerPageSlug/pluginSlug" */
  src: string
  /** Stable ID for UserData persistence (auto-generated if omitted) */
  id?: string
  /** Override default height */
  height?: string | number
  /** Page ID for UserData persistence (from markdown context) */
  pageId?: string
  /** List this embedding may publish to: "class" or a list name. See plugin-share.ts */
  share?: string
  /** Which value counts per student: "best" (default) or "last" */
  keep?: string
  /** Editor only: shows the list gizmo for plugins that call publish(). */
  onShareChange?: (share: string | null) => void
  /** All other attributes become plugin config */
  [key: string]: unknown
}

interface PluginMessage {
  type: string
  data?: unknown
  height?: number
  requestId?: number
  values?: unknown
  /** publish: small JSON for the class. setShared: `value`. */
  payload?: unknown
  value?: unknown
  options?: { value?: string; limit?: number; classId?: string; payload?: boolean }
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
  share,
  keep,
  onShareChange,
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
  // Bumped by Retry so the fetch effect runs again.
  const [loadAttempt, setLoadAttempt] = useState(0)

  const { resolvedTheme: themeResolved, forcedTheme } = useTheme()
  const resolvedTheme = forcedTheme ?? themeResolved
  const { siteId } = useCurrentSite()
  // Teachers get technical details + an edit link when a plugin fails;
  // students only a neutral note (QA decision 2026-10-05).
  const { data: session } = useSession()
  const isTeacher = session?.user?.accountType === 'teacher'

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
  }, [validSrc, ownerSlug, pluginSlug, src, heightProp, loadAttempt])

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
        // Convert incremental touch pinch ratio to synthetic ctrl+wheel so
        // that page zoom follows the finger ratio. See pinchRatioToWheelDeltaY.
        const deltaY = pinchRatioToWheelDeltaY(msg.ratio)
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

        case 'plugin:publish': {
          const respond = (data: unknown) => sendToPlugin({ type: 'host:data', requestId: msg.requestId, data })
          const earned = (msg.values as { score?: unknown } | undefined)?.score
          if (typeof earned === 'number' && Number.isFinite(earned)) reportScore({ componentId, earned })
          if (!share || !pageId || !siteId) {
            respond({ stored: false })
            break
          }
          fetch('/api/plugin-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, pageId, componentId, share, keep, values: msg.values, payload: msg.payload }),
          })
            .then((res) => (res.ok ? res.json() : { stored: false }))
            .catch(() => ({ stored: false }))
            .then((result) => {
              respond(result)
              if (result.stored) {
                window.dispatchEvent(new CustomEvent(PLUGIN_SHARE_UPDATED, { detail: { source: share } }))
              }
            })
          break
        }

        // The site owner's state for this embedding, read by the class through
        // getResults. The route rejects everyone else.
        case 'plugin:setShared': {
          const respond = (data: unknown) => sendToPlugin({ type: 'host:data', requestId: msg.requestId, data })
          if (!share || !pageId || !siteId) {
            respond({ stored: false })
            break
          }
          fetch('/api/plugin-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, pageId, componentId, share, shared: msg.value ?? null }),
          })
            .then((res) => (res.ok ? res.json() : { stored: false }))
            .catch(() => ({ stored: false }))
            .then(respond)
          break
        }

        case 'plugin:getResults': {
          const respond = (data: unknown) => sendToPlugin({ type: 'host:data', requestId: msg.requestId, data })
          if (!share || !siteId) {
            respond({ entries: [], self: null, failed: true })
            break
          }
          const params = new URLSearchParams({ siteId, source: share, value: String(msg.options?.value ?? 'score') })
          if (msg.options?.limit) params.set('limit', String(msg.options.limit))
          if (typeof msg.options?.classId === 'string') params.set('classId', msg.options.classId)
          if (pageId) {
            params.set('pageId', pageId)
            params.set('componentId', componentId)
            if (msg.options?.payload) params.set('payload', '1')
          }
          // Plugin code is third-party: it gets nicknames, values and payloads,
          // never the student ids and names the site owner's response carries.
          const forPlugin = (e: ShareEntry) => ({
            rank: e.rank, nickname: e.nickname, value: e.value, isSelf: e.isSelf,
            ...(e.payload !== undefined ? { payload: e.payload } : {}),
          })
          fetch(`/api/plugin-share?${params}`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)
            .then((r: ShareResults | null) => respond({
              entries: (r?.entries ?? []).map(forPlugin),
              self: r?.self ? forPlugin(r.self) : null,
              // `failed` lets a plugin tell "no entries" from "request failed".
              failed: !r,
              member: !!r?.member,
              isOwner: !!r?.isOwner,
              classes: r?.classes ?? [],
              classId: r?.classId ?? null,
              now: r?.now ?? null,
              shared: r?.shared ?? null,
            }))
          break
        }

        // The plugin is (or stops being) a drawing surface: the annotation
        // canvas forwards gestures over a marked iframe, see plugin-pointer-forward.ts.
        case 'plugin:capturePointer': {
          iframeRef.current.setAttribute(PLUGIN_POINTER_ATTR, msg.value ? 'true' : 'false')
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

        case 'plugin:error': {
          const err = msg as PluginMessage & { message?: string; line?: number }
          console.warn(`Plugin ${src}: ${err.message}${err.line ? ` (line ${err.line})` : ''}`)
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
  }, [config, userData, resolvedTheme, sendToPlugin, src, pageId, updateData, share, keep, siteId, componentId])

  // Someone published into this embedding's list or the owner changed the
  // shared state: tell the plugin, it decides whether to call getResults.
  useRealtimeEvents(['leaderboard-update'], (event) => {
    if ((event.siteId && event.siteId !== siteId) || (event.list && event.list !== share)) return
    sendToPlugin({ type: 'host:resultsChanged', shared: !!event.shared })
  }, { enabled: !!share && status === 'ready' })

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

  // Every state renders inside the same wrapper div carrying dataAttrs
  // (data-section-id). SectionAnchoredStrokes portals stroke SVGs into it:
  // swapping the wrapper for a different element crashed the page
  // (NotFoundError removeChild) when a plugin timed out, and an error box
  // without data-section-id dropped the strokes anchored to it.

  // Invalid src format
  if (!validSrc) {
    return (
      <div className="my-4" {...dataAttrs}>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <p className="font-medium">Invalid plugin src: &quot;{src}&quot;</p>
          <p className="mt-1 text-xs opacity-75">
            Format: &lt;plugin src=&quot;ownerPageSlug/pluginSlug&quot;&gt;&lt;/plugin&gt;
          </p>
        </div>
      </div>
    )
  }

  const failed = !!fetchError || status === 'error' || status === 'unresponsive'
  let notice: ReactNode = null
  if (failed && !isTeacher) {
    notice = (
      <div className="rounded-lg border border-muted bg-muted/30 p-4 text-sm text-muted-foreground">
        This interactive element is not available right now.
      </div>
    )
  } else if (status === 'unresponsive' && !fetchError) {
    notice = (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
        <p className="font-medium">Plugin &quot;{src}&quot; is unresponsive</p>
      </div>
    )
  } else if (failed) {
    notice = (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">Plugin &quot;{src}&quot; could not be shown</p>
        <p className="mt-1 text-xs opacity-75">
          {fetchError
            ? 'It does not exist (deleted or renamed?).'
            : 'It did not finish loading within 5 seconds, probably because of an error in its code. It still appears if it finishes loading later.'}{' '}
          Students see &quot;This interactive element is not available right now.&quot;
        </p>
        <div className="mt-2 flex gap-3 text-xs">
          {!fetchError && (
            <a href={`/dashboard/plugins/edit/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(pluginSlug)}`} className="underline hover:no-underline">
              Edit plugin
            </a>
          )}
          <button
            onClick={() => {
              setFetchError(null)
              setStatus('loading')
              setPluginHtml(null)
              readyReceived.current = false
              setLoadAttempt((n) => n + 1)
            }}
            className="underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // After a timeout the iframe stays mounted (hidden), so a slow plugin whose
  // plugin:ready arrives late still switches to 'ready' and shows up.
  const srcdoc = pluginHtml && !fetchError ? buildPluginSrcdoc(pluginHtml, resolvedTheme) : undefined

  return (
    <div className="my-4" {...dataAttrs}>
      {notice}
      {status === 'loading' && !fetchError && (
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
           
          {...{ allowtransparency: 'true' } as any}
          style={{
            border: 'none',
            width: '100%',
            height: iframeHeight,
            display: status === 'ready' ? 'block' : 'none',
            colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light',
          }}
          title={`Plugin: ${src}`}
        />
      )}
      {/* Plugins declare nothing, so this searches the HTML for a publish call. */}
      {onShareChange && pluginHtml?.includes('.publish(') && (
        <ShareListOptions value={share} allowOff onChange={onShareChange} />
      )}
    </div>
  )
}
