'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { useSearchParams } from 'next/navigation'
import { buildPluginSrcdoc } from '@/lib/plugin-sdk'

interface EmbedPluginProps {
  entryHtml: string
  name: string
}

interface PluginMessage {
  type: string
  data?: unknown
  requestId?: number
}

const READY_TIMEOUT = 5000
const UNRESPONSIVE_TIMEOUT = 30000

/**
 * Standalone full-viewport plugin embed (e.g. for iframing into exam.net).
 *
 * Differs from PluginContainer:
 * - Fills 100vw × 100vh instead of inline flow.
 * - Reads plugin config from URL query params (`theme` and `id` are reserved).
 * - No UserData persistence — anonymous external context, no pageId.
 * - No annotation-layer zoom forwarding.
 * - Ignores plugin:resize (the iframe is already viewport-sized).
 */
export function EmbedPlugin({ entryHtml, name }: EmbedPluginProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyReceived = useRef(false)
  const searchParams = useSearchParams()
  const { resolvedTheme } = useTheme()

  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unresponsive'>('loading')

  // Build config from query params. `theme` and `id` are reserved for the host.
  const { config, themeOverride } = useMemo(() => {
    const cfg: Record<string, string> = {}
    let override: string | null = null
    searchParams.forEach((value, key) => {
      if (key === 'theme') {
        if (value === 'dark' || value === 'light') override = value
        return
      }
      if (key === 'id') return
      cfg[key] = value
    })
    return { config: cfg, themeOverride: override }
  }, [searchParams])

  const effectiveTheme = themeOverride ?? resolvedTheme ?? 'light'

  const sendToPlugin = useCallback((msg: Record<string, unknown>) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(msg, '*')
    }
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<PluginMessage>) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const msg = event.data
      if (!msg || typeof msg.type !== 'string') return

      switch (msg.type) {
        case 'plugin:ready':
          readyReceived.current = true
          setStatus('ready')
          sendToPlugin({
            type: 'host:init',
            config,
            data: null,
            theme: effectiveTheme,
          })
          break

        case 'plugin:getData':
          sendToPlugin({ type: 'host:data', requestId: msg.requestId, data: null })
          break

        case 'plugin:setData':
          // No-op: anonymous embed has no persistence target.
          break

        case 'plugin:requestFullscreen':
          iframeRef.current?.requestFullscreen?.().catch(() => {})
          break

        case 'plugin:exitFullscreen':
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
          break
      }
    }

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
  }, [config, effectiveTheme, sendToPlugin])

  // Push theme changes after ready
  useEffect(() => {
    if (status === 'ready') {
      sendToPlugin({ type: 'host:themeChange', theme: effectiveTheme })
    }
  }, [effectiveTheme, status, sendToPlugin])

  // Ready / unresponsive timeouts
  useEffect(() => {
    const readyTimer = setTimeout(() => {
      if (!readyReceived.current) setStatus('error')
    }, READY_TIMEOUT)
    const unresponsiveTimer = setTimeout(() => {
      if (!readyReceived.current) setStatus('unresponsive')
    }, UNRESPONSIVE_TIMEOUT)
    return () => {
      clearTimeout(readyTimer)
      clearTimeout(unresponsiveTimer)
    }
  }, [])

  const srcdoc = buildPluginSrcdoc(entryHtml, effectiveTheme)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        background: effectiveTheme === 'dark' ? '#0a0a0a' : '#ffffff',
      }}
    >
      {status === 'loading' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            color: effectiveTheme === 'dark' ? '#888' : '#666',
          }}
        >
          Loading plugin…
        </div>
      )}
      {status === 'error' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            color: '#b91c1c',
          }}
        >
          Plugin &ldquo;{name}&rdquo; failed to load.
        </div>
      )}
      {status === 'unresponsive' && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            padding: '6px 10px',
            background: '#fef3c7',
            color: '#854d0e',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            borderRadius: 4,
          }}
        >
          Plugin is unresponsive.
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        allowFullScreen
        srcDoc={srcdoc}
        style={{
          border: 'none',
          width: '100%',
          height: '100%',
          display: 'block',
          colorScheme: effectiveTheme === 'dark' ? 'dark' : 'light',
        }}
        title={`Plugin: ${name}`}
      />
    </div>
  )
}
