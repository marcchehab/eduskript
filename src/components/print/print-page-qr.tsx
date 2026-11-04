'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePrintLayoutVersion } from '@/lib/print/print-mode'

/**
 * One QR code for the whole page, at the bottom right of the first printed
 * page, in the right margin (.print-page-qr, globals.css). Shown only when
 * the page has an <ai-feedback> (which itself prints nothing,
 * ai-feedback.tsx): the student opens the page on the phone and scrolls to
 * the exercise. Rendered by PrintView into #paper.
 *
 * Gray modules (#6b7280 on white, about 4.8:1) to stay unobtrusive; still
 * scannable at this size.
 */
export function PrintPageQr() {
  // Re-render after every pagination pass: the content may render late.
  usePrintLayoutVersion()
  const paper = typeof document !== 'undefined' ? document.getElementById('paper') : null
  const [qr, setQr] = useState<string | null>(null)
  const hasFeedback = !!paper?.querySelector('[data-ai-feedback]')

  useEffect(() => {
    if (!hasFeedback) return
    let cancelled = false
    const target = window.location.origin + window.location.pathname
    void import('qrcode')
      .then((QR) => QR.toDataURL(target, { margin: 0, width: 240, color: { dark: '#6b7280', light: '#ffffff' } }))
      .then((data) => { if (!cancelled) setQr(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [hasFeedback])

  if (!paper || !hasFeedback || !qr) return null
  return createPortal(
    <div className="print-page-qr flex flex-col items-center gap-1.5 rounded-lg border border-border bg-white px-1.5 pt-2.5 pb-1.5 whitespace-nowrap text-[11px] leading-tight text-gray-500" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
      <img src={qr} alt="" className="!m-0 !h-16 !w-16 !max-w-none !rounded-none" />
      <div className="font-medium">KI-Feedback?</div>
    </div>,
    paper,
  )
}
