'use client'

/**
 * <ai-feedback> — student-triggered AI feedback on handwritten/annotated work.
 *
 * Three input paths:
 * 1. Button: collects the student's own annotation strokes that currently sit
 *    inside the enclosing H2 section (previous h1/h2 → next h1/h2, live DOM
 *    positions), renders them to a PNG (render-strokes-to-png.ts) and sends it.
 * 2. Paste zone: hover/focus the dashed box and press Ctrl+V with a screenshot
 *    in the clipboard — sends the pasted image instead. Covers work on top of
 *    tables/SVG/plugins where we can't rasterize the underlying DOM.
 * 3. Camera/file: pick or shoot a photo (capture="environment" opens the rear
 *    camera on mobile). Same normalize path as paste — for work done on paper.
 *
 * The server re-derives the exercise text + teacher prompt from page content;
 * the client only sends pageId, feedbackId and the image.
 *
 * Section scoping duplicates the live-position math of
 * section-anchored-strokes.tsx in read-only form: a stroke's current y =
 * stored y + (live section top − stored sectionOffsetY).
 *
 * @see src/app/api/ai/feedback/route.ts
 * @see src/lib/ai/feedback-context.ts
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Sparkles, Loader2, AlertCircle, ClipboardPaste, Camera, LogIn } from 'lucide-react'
import { userDataService } from '@/lib/userdata'
import type { AnnotationData } from '@/lib/userdata/types'
import { parseStrokes } from '@/hooks/use-stroke-animation'
import { usePublicSignInUrl } from '@/hooks/use-public-signin-url'
import {
  renderStrokesToPng,
  type RenderableImage,
  type RenderableStroke,
} from '@/lib/annotations/render-strokes-to-png'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import type { ChatStreamEvent } from '@/lib/ai/types'

interface AIFeedbackProps {
  pageId?: string
  feedbackId?: string
  label?: string
}

/** Cap pasted screenshots to this edge length (px) before upload. */
const MAX_PASTE_EDGE = 2000

/** Ignore images smaller than this (paper px) — inline icons, emoji. */
const MIN_IMAGE_EDGE = 32

/**
 * Reload an image with crossOrigin="anonymous" so drawing it can never taint
 * the capture canvas. Same-origin (/api/files/…) always succeeds; S3 images
 * succeed only if the bucket sends CORS headers. Returns null on failure —
 * the caller skips that image rather than losing the whole capture.
 */
function loadCorsSafeImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

type Status = 'idle' | 'preparing' | 'streaming'

export function AIFeedback({ pageId, feedbackId, label }: AIFeedbackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pasteArmedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [feedback, setFeedback] = useState('')
  const [sentImage, setSentImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loginModalOpen, setLoginModalOpen] = useState(false)

  const { status: authStatus } = useSession()
  const signInUrl = usePublicSignInUrl()
  // Server enforces auth (route returns 401 for anon); this is the friendly
  // gate so a logged-out student gets a "sign in" modal instead of an error.
  // Treat only a resolved 'unauthenticated' as logged-out — while 'loading'
  // we let the action proceed and the 401 path still catches a real anon.
  const loggedIn = authStatus !== 'unauthenticated'
  // Read in the document-level paste handler (bound in an effect) without
  // re-subscribing it on every auth change.
  const loggedInRef = useRef(loggedIn)
  loggedInRef.current = loggedIn

  const busy = status !== 'idle'

  /** Gate an action behind sign-in. Returns true if the caller may proceed. */
  const requireLogin = (): boolean => {
    if (!loggedIn) {
      setLoginModalOpen(true)
      return false
    }
    return true
  }

  const sendImage = async (image: string) => {
    if (!pageId) {
      setError('AI feedback needs a saved page context.')
      return
    }
    setError(null)
    setFeedback('')
    setSentImage(image)
    setStatus('streaming')

    // Which <ai-feedback> tag on the page is this? DOM order matches source
    // order, so the server can pick the right prompt/section without the
    // teacher having to assign ids.
    const feedbackIndex = containerRef.current
      ? [...document.querySelectorAll('[data-ai-feedback]')].indexOf(containerRef.current)
      : -1

    try {
      const response = await fetch('/api/ai/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, feedbackId, feedbackIndex, image }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || 'Request failed')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete line for next chunk
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: ChatStreamEvent
          try {
            event = JSON.parse(line.slice(6)) as ChatStreamEvent
          } catch {
            continue
          }
          if (event.type === 'content' && event.content) {
            accumulated += event.content
            setFeedback(accumulated)
          } else if (event.type === 'error') {
            throw new Error(event.error || 'AI error')
          }
        }
      }
      if (!accumulated) {
        setError('The AI returned no feedback. Please try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setStatus('idle')
    }
  }

  /** Button path: strokes in the enclosing H2 section → PNG → send. */
  const handleFeedbackClick = async () => {
    if (busy) return
    if (!requireLogin()) return
    if (!pageId) {
      setError('AI feedback needs a saved page context.')
      return
    }
    setError(null)
    setStatus('preparing')
    try {
      const paperEl = document.getElementById('paper')
      const hostEl = containerRef.current
      if (!paperEl || !hostEl) {
        setError('Could not locate the page content.')
        return
      }

      const paperRect = paperEl.getBoundingClientRect()
      // Strokes are stored in unscaled layout px; divide client coords by the
      // current zoom/pan scale to compare against them (see POSITIONING.md).
      const scale = paperRect.width / paperEl.offsetWidth || 1
      const toPaperY = (clientY: number) => (clientY - paperRect.top) / scale

      // Section bounds: previous h1/h2 (or paper top) → next h1/h2 (or paper end)
      const componentTop = toPaperY(hostEl.getBoundingClientRect().top)
      let yTop = 0
      let yBottom = paperRect.height / scale
      for (const el of paperEl.querySelectorAll('[data-section-id^="h1-"], [data-section-id^="h2-"]')) {
        const top = toPaperY(el.getBoundingClientRect().top)
        if (top <= componentTop && top > yTop) yTop = top
        if (top > componentTop && top < yBottom) yBottom = top
      }

      const record = await userDataService.get<AnnotationData>(pageId, 'annotations')
      const strokes = parseStrokes(record?.data?.canvasData)

      const included: RenderableStroke[] = []
      for (const stroke of strokes) {
        if (stroke.mode !== 'draw' || stroke.points.length < 2) continue
        const sectionEl = stroke.sectionId
          ? paperEl.querySelector(`[data-section-id="${CSS.escape(stroke.sectionId)}"]`)
          : null
        // Orphaned sections render at stored coords (annotation-svg-layer
        // fallback), so shift 0 matches what the student sees.
        const yShift = sectionEl
          ? toPaperY(sectionEl.getBoundingClientRect().top) - (stroke.sectionOffsetY ?? 0)
          : 0
        let sum = 0
        for (const p of stroke.points) sum += p.y
        const liveAvgY = sum / stroke.points.length + yShift
        if (liveAvgY >= yTop && liveAvgY < yBottom) {
          included.push({
            points: stroke.points,
            mode: stroke.mode,
            color: stroke.color,
            width: stroke.width,
            yShift,
          })
        }
      }

      // Composite images (content images, excalidraw SVGs) that sit in the
      // section, so drawing ON an image needs no screenshot. Live rects from
      // the same instant as the stroke shifts keep both aligned.
      const toPaperX = (clientX: number) => (clientX - paperRect.left) / scale
      const imageCandidates: Array<{ src: string; x: number; y: number; w: number; h: number }> = []
      for (const el of paperEl.querySelectorAll('img')) {
        if (el.closest('[data-ai-feedback]')) continue // our own thumbnail
        const r = el.getBoundingClientRect()
        const w = r.width / scale
        const h = r.height / scale
        if (w < MIN_IMAGE_EDGE || h < MIN_IMAGE_EDGE) continue // hidden or icon-sized
        const centerY = toPaperY(r.top) + h / 2
        if (centerY < yTop || centerY >= yBottom) continue
        imageCandidates.push({ src: el.currentSrc || el.src, x: toPaperX(r.left), y: toPaperY(r.top), w, h })
      }
      const images: RenderableImage[] = []
      for (const cand of imageCandidates) {
        const source = await loadCorsSafeImage(cand.src)
        if (source) {
          images.push({ source, x: cand.x, y: cand.y, w: cand.w, h: cand.h })
        } else {
          console.warn('[ai-feedback] skipping non-CORS image in capture:', cand.src)
        }
      }

      const png = renderStrokesToPng(included, images)
      if (!png) {
        setError(
          'Nothing written in this section yet. Write your solution on the page first, or paste a screenshot into the box instead.'
        )
        return
      }
      await sendImage(png.dataUrl)
    } finally {
      setStatus((s) => (s === 'preparing' ? 'idle' : s))
    }
  }

  /**
   * Paste/camera path: normalize the image to a capped PNG data URL.
   *
   * Phone camera photos carry an EXIF orientation flag; canvas drawImage does
   * NOT apply it, so a portrait shot lands sideways. createImageBitmap with
   * `imageOrientation: 'from-image'` bakes the rotation into the bitmap's
   * pixels (and its width/height come out already-oriented). Fall back to
   * <img> (which some browsers auto-orient, some don't) if the bitmap path is
   * unavailable.
   */
  const handlePastedBlob = async (blob: Blob) => {
    try {
      let source: ImageBitmap | HTMLImageElement
      let srcW: number
      let srcH: number
      try {
        source = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        srcW = source.width
        srcH = source.height
      } catch {
        const url = URL.createObjectURL(blob)
        try {
          source = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image()
            el.onload = () => resolve(el)
            el.onerror = () => reject(new Error('Could not read the image'))
            el.src = url
          })
          srcW = source.naturalWidth
          srcH = source.naturalHeight
        } finally {
          URL.revokeObjectURL(url)
        }
      }

      const scale = Math.min(1, MAX_PASTE_EDGE / Math.max(srcW, srcH))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(srcW * scale)
      canvas.height = Math.round(srcH * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not process the image')
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      if (source instanceof ImageBitmap) source.close()
      await sendImage(canvas.toDataURL('image/png'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the image')
    }
  }

  // Document-level paste listener, only active while the drop zone is
  // hovered or focused (pasteArmedRef) — same scoping idea as the snap paste
  // handler, but per-component so multiple <ai-feedback> tags don't all fire.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!pasteArmedRef.current || busy) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            e.preventDefault()
            // Keep the paste from also reaching the snap paste handler
            // (paste-snap-handler.tsx listens on document in the bubble
            // phase; we listen in capture, so this kills it reliably).
            e.stopImmediatePropagation()
            if (!loggedInRef.current) {
              setLoginModalOpen(true)
              return
            }
            void handlePastedBlob(blob)
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlePastedBlob is stable enough; re-binding on busy is all we need
  }, [busy])

  return (
    <div ref={containerRef} className="my-6 not-prose" data-ai-feedback={feedbackId || true}>
      <div className="flex flex-wrap items-stretch gap-3">
        <button
          type="button"
          onClick={handleFeedbackClick}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {status === 'streaming' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {label || 'Get AI feedback'}
        </button>

        <div
          tabIndex={0}
          role="button"
          aria-label="Paste a screenshot for AI feedback"
          onMouseEnter={() => { pasteArmedRef.current = true }}
          onMouseLeave={() => { pasteArmedRef.current = false }}
          onFocus={() => { pasteArmedRef.current = true }}
          onBlur={() => { pasteArmedRef.current = false }}
          onClick={() => { if (!loggedIn) setLoginModalOpen(true) }}
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-4 py-2 text-sm text-muted-foreground hover:border-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <ClipboardPaste className="h-4 w-4" />
          …or paste a screenshot
        </div>

        <button
          type="button"
          onClick={() => { if (requireLogin()) fileInputRef.current?.click() }}
          disabled={busy}
          aria-label="Take a picture for AI feedback"
          className="inline-flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-4 py-2 text-sm text-muted-foreground hover:border-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <Camera className="h-4 w-4" />
          …or take a picture
        </button>
        {/* capture="environment" opens the rear camera on phones/tablets; on
            desktop it falls back to the file picker (webcam via the OS). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // allow re-selecting the same file
            if (file && !busy) void handlePastedBlob(file)
          }}
        />
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(feedback || status === 'streaming') && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            AI feedback
            {status === 'streaming' && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
          {sentImage && (
            // Show what was actually sent so transcription errors are visible
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sentImage}
              alt="Your work as sent to the AI"
              className="mb-3 max-h-40 rounded border border-border bg-white"
            />
          )}
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {feedback}
            </ReactMarkdown>
          </div>
        </div>
      )}

      <Dialog open={loginModalOpen} onOpenChange={setLoginModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign in to use AI feedback</DialogTitle>
            <DialogDescription>
              AI feedback is only available to signed-in students. Sign in to send
              your work and get feedback.
            </DialogDescription>
          </DialogHeader>
          <Link
            href={signInUrl}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </Link>
        </DialogContent>
      </Dialog>
    </div>
  )
}
