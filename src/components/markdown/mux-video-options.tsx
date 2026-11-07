'use client'

import { useCallback } from 'react'
import { Film, Play, Repeat, Pin } from 'lucide-react'
import { mediaLayoutAttrs, type MediaLayout } from '@/lib/media-layout'

export interface MuxVideoFlags {
  gif: boolean
  autoplay: boolean
  loop: boolean
  pin: boolean
}

interface MuxVideoOptionsProps {
  src: string
  /** Caption text; preserved as the tag's alt attribute when rewriting. */
  alt?: string
  poster?: string
  flags: MuxVideoFlags
  /** Current width/align/wrap, kept when a flag toggles. */
  layout: MediaLayout
  /** Provided by the client (editor) renderer only — public pages get no toolbar. */
  onChange: (src: string, newMarkdown: string) => void
}

/**
 * Serialize a `<muxvideo>` tag. Valueless attributes are used for the flags —
 * rehype-raw turns them into empty strings / booleans, which the component's
 * reader accepts (see markdown-components.tsx).
 */
export function buildMuxVideoTag(
  src: string,
  alt: string | undefined,
  poster: string | undefined,
  flags: MuxVideoFlags,
  layout?: MediaLayout
): string {
  const attrs = [`src="${src}"`]
  if (alt) attrs.push(`alt="${alt.replace(/"/g, '&quot;')}"`)
  if (poster) attrs.push(`poster="${poster}"`)
  // gif already implies autoplay + loop in the component; don't write them out
  // as well, or unticking gif would silently leave the video autoplaying.
  if (flags.gif) attrs.push('gif')
  else {
    if (flags.autoplay) attrs.push('autoplay')
    if (flags.loop) attrs.push('loop')
  }
  if (flags.pin) attrs.push('pin')
  if (layout) attrs.push(...mediaLayoutAttrs(layout))
  return `<muxvideo ${attrs.join(' ')} />`
}

const OPTIONS: Array<{
  key: keyof MuxVideoFlags
  label: string
  icon: typeof Film
}> = [
  { key: 'gif', label: 'GIF mode — muted autoplay, looping, no controls', icon: Film },
  { key: 'autoplay', label: 'Autoplay (muted)', icon: Play },
  { key: 'loop', label: 'Loop', icon: Repeat },
  { key: 'pin', label: 'Pin to the corner when scrolled past', icon: Pin },
]

/**
 * Editor-only flag buttons for a video: toggle the playback flags by rewriting
 * the source tag. Rendered only when the renderer passes an onChange, i.e. in
 * the dashboard preview, inside ResizableWrapper's control group
 * (extraControls) next to the align/wrap buttons.
 */
export function MuxVideoOptions({ src, alt, poster, flags, layout, onChange }: MuxVideoOptionsProps) {
  const toggle = useCallback(
    (key: keyof MuxVideoFlags) => {
      const next: MuxVideoFlags = { ...flags, [key]: !flags[key] }
      // GIF owns autoplay/loop, so turning it on clears the redundant pair and
      // turning it off leaves a plain player rather than a half-configured one.
      if (key === 'gif') {
        next.autoplay = false
        next.loop = false
      } else if (next.gif && (key === 'autoplay' || key === 'loop')) {
        next.gif = false
      }
      onChange(src, buildMuxVideoTag(src, alt, poster, next, layout))
    },
    [flags, layout, onChange, src, alt, poster]
  )

  return (
    <span className="flex items-center gap-0.5">
      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const active = flags[key] || (flags.gif && (key === 'autoplay' || key === 'loop'))
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            title={label}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        )
      })}
    </span>
  )
}
