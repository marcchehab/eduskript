'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { QrCode } from 'lucide-react'
import { usePrintMode } from '@/lib/print/print-mode'

/**
 * Paper version of an interactive embed (video, plugin, simulation): a QR code
 * and a label. The QR code links to `href` (e.g. the YouTube video) or to this
 * page. Online it renders its children unchanged, inside a wrapper div that
 * records their height; the print version carries it as
 * data-print-online-height so strokes below the embed move by the height
 * difference (section-anchored-strokes.tsx). Opened directly with ?print the
 * embed never laid out online, so that correction is missing.
 * `image`: a preview (e.g. the video thumbnail) printed before the QR code.
 * `empty`: prints nothing, only records the online height (<ai-feedback>: one
 * QR code per page instead, print-page-qr.tsx).
 */
export function PrintFallback({ label, href, image, empty, children }: { label: string; href?: string; image?: string; empty?: boolean; children: ReactNode }) {
  const printing = usePrintMode()
  const [qr, setQr] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [onlineHeight, setOnlineHeight] = useState<number | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapper.current
    if (printing || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setOnlineHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [printing])

  useEffect(() => {
    if (!printing || empty) return
    const target = href || window.location.origin + window.location.pathname
    setUrl(target)
    let cancelled = false
    void import('qrcode').then((QR) => QR.toDataURL(target, { margin: 0, width: 240 })).then((data) => {
      if (!cancelled) setQr(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [printing, href, empty])

  if (!printing) return <div ref={wrapper}>{children}</div>
  if (empty) return <div data-print-online-height={onlineHeight ?? undefined} />
  return (
    // my-4 like the embeds: their margins collapse through the online wrapper
    // and are not part of its measured height, so neither are these.
    <div className="my-4 flex w-fit max-w-full items-center gap-4 rounded-lg border border-border p-3" data-print-online-height={onlineHeight ?? undefined}>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- external thumbnail, printed as is
        <img src={image} alt="" className="!m-0 !h-24 !w-auto !max-w-none shrink-0 rounded" />
      )}
      {qr
        // eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize
        ? <img src={qr} alt="" className="!m-0 !h-24 !w-24 !max-w-none !rounded-none shrink-0" />
        : <QrCode className="h-24 w-24 shrink-0 text-muted-foreground" />}
      <div className="text-sm">
        <div className="font-medium">{label}</div>
        <div className="break-all text-muted-foreground">{url}</div>
      </div>
    </div>
  )
}
