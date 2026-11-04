'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * QR code linking to this page, at the bottom right of the first printed
 * page, in the right margin (.print-page-qr, globals.css), on every printout:
 * the way to the interactive parts (AI feedback, videos, simulations) from
 * paper. <ai-feedback> itself prints nothing (ai-feedback.tsx). Rendered by
 * PrintView into #paper. Label in the page's language (<html lang>, set per
 * site): German for "de*", else English.
 *
 * Gray modules (#6b7280 on white, about 4.8:1) to stay unobtrusive; still
 * scannable at this size.
 */
export function PrintPageQr() {
  const paper = typeof document !== 'undefined' ? document.getElementById('paper') : null
  const [qr, setQr] = useState<string | null>(null)
  const label = typeof document !== 'undefined' && document.documentElement.lang.startsWith('de') ? 'Online ansehen' : 'View online'

  useEffect(() => {
    let cancelled = false
    const target = window.location.origin + window.location.pathname
    void import('qrcode')
      .then((QR) => QR.toDataURL(target, { margin: 0, width: 240, color: { dark: '#6b7280', light: '#ffffff' } }))
      .then((data) => { if (!cancelled) setQr(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!paper || !qr) return null
  return createPortal(
    <div className="print-page-qr flex flex-col items-center gap-1.5 rounded-lg border border-border bg-white px-1.5 pt-2.5 pb-1.5 whitespace-nowrap text-[11px] leading-tight text-gray-500" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img src={qr} alt="" className="!m-0 !h-16 !w-16 !max-w-none !rounded-none" />
      <div className="font-medium">{label}</div>
    </div>,
    paper,
  )
}
