'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'

export type VisibilityState = 'draft' | 'published' | 'unlisted'

export function getVisibilityState(isPublished: boolean, isUnlisted: boolean): VisibilityState {
  if (!isPublished) return 'draft'
  if (isUnlisted) return 'unlisted'
  return 'published'
}

export const visibilityConfig: Record<VisibilityState, {
  label: string
  dot: string
  text: string
  description: (type: 'skript' | 'page' | 'front page') => string
}> = {
  draft: {
    label: 'Draft',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    description: (type) => `Only authors can see this ${type}.`,
  },
  unlisted: {
    label: 'Unlisted',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    description: () => 'Anyone with the link can open it. Hidden from the sidebar and search.',
  },
  published: {
    label: 'Published',
    dot: 'bg-success',
    text: 'text-success',
    description: () => 'Visible on your site, in the sidebar and in search.',
  },
}

const ORDER: VisibilityState[] = ['draft', 'unlisted', 'published']

/** Coloured status dot, shared by the toggle and read-only markers (page lists). */
export function VisibilityDot({ state, className = '' }: { state: VisibilityState; className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${visibilityConfig[state].dot} ${className}`} />
}

interface PublishToggleProps {
  /** 'frontpage' = a front page (skript, site or org): no Unlisted state
   *  (FrontPage has only isPublished); pass its PATCH `endpoint`. */
  type: 'skript' | 'page' | 'frontpage'
  /** PATCH target; defaults to /api/skripts/{itemId} or /api/pages/{itemId}. */
  endpoint?: string
  itemId: string
  isPublished: boolean
  isUnlisted?: boolean
  onToggle: (newIsPublished: boolean, newIsUnlisted: boolean) => void
  size?: 'sm' | 'md' | 'lg'
  /** false = dot only (dense lists); the popover is the same. */
  showText?: boolean
  /** Public path of the item; shown with copy + open in the popover when not a draft. */
  publicUrl?: string | null
  /** Why the public link can't be opened even though this item is visible (e.g. skript is a draft). */
  viewBlockedReason?: string | null
  onOpenPublic?: () => void
}

/**
 * Visibility control (YouTube/Notion pattern): a status button that opens a
 * popover with an explicit Draft / Unlisted / Published choice plus the public
 * link (copy, open). Replaces the former click-to-cycle icon and the separate
 * eye "view page" button.
 */
export function PublishToggle({
  type,
  itemId,
  isPublished: initialIsPublished,
  isUnlisted: initialIsUnlisted = false,
  onToggle,
  size = 'sm',
  showText = true,
  publicUrl,
  viewBlockedReason,
  onOpenPublic,
  endpoint: endpointProp,
}: PublishToggleProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState<VisibilityState | null>(null)
  const [state, setState] = useState<VisibilityState>(
    getVisibilityState(initialIsPublished, initialIsUnlisted)
  )

  const choose = async (next: VisibilityState) => {
    if (next === state || saving) return
    setSaving(next)
    const newIsPublished = next !== 'draft'
    const newIsUnlisted = next === 'unlisted'
    try {
      const endpoint = endpointProp ?? (type === 'skript' ? `/api/skripts/${itemId}` : `/api/pages/${itemId}`)
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(type === 'frontpage'
          ? { isPublished: newIsPublished }
          : { isPublished: newIsPublished, isUnlisted: newIsUnlisted }),
      })
      if (response.ok) {
        setState(next)
        onToggle(newIsPublished, newIsUnlisted)
      } else {
        console.error(`Failed to change ${type} visibility`)
      }
    } catch (error) {
      console.error(`Error changing ${type} visibility:`, error)
    } finally {
      setSaving(null)
    }
  }

  const config = visibilityConfig[state]
  const noun = type === 'frontpage' ? 'front page' : type
  const Noun = type === 'skript' ? 'Skript' : type === 'page' ? 'Page' : 'Front page'
  const states = type === 'frontpage' ? ORDER.filter(s => s !== 'unlisted') : ORDER
  const buttonSize = size === 'lg' ? 'default' : 'sm'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={buttonSize}
          className={`gap-1.5 px-2 ${config.text}`}
          title={`${Noun} visibility: ${config.label}`}
        >
          <VisibilityDot state={state} />
          {showText && <span className="text-xs font-medium">{config.label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          {Noun} visibility
        </div>
        <div role="radiogroup" className="p-1">
          {states.map((s) => {
            const c = visibilityConfig[s]
            const selected = s === state
            return (
              <button
                key={s}
                role="radio"
                aria-checked={selected}
                onClick={() => void choose(s)}
                disabled={!!saving}
                className={`flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-60 ${selected ? 'bg-muted' : ''}`}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-foreground' : 'border-muted-foreground/50'}`}>
                  {saving === s
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : selected && <span className="h-2 w-2 rounded-full bg-foreground" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <VisibilityDot state={s} />
                    {c.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{c.description(noun)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {publicUrl && state !== 'draft' && (
          <div className="space-y-2 border-t px-3 py-2.5">
            <PublicLinkRow
              publicUrl={publicUrl}
              label={`Open ${noun}`}
              blockedReason={viewBlockedReason}
              onOpen={onOpenPublic}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Public URL with copy + open. Shared by the visibility popover and the page
 * settings popover. Shows `blockedReason` instead when the URL isn't reachable.
 */
export function PublicLinkRow({
  publicUrl,
  label,
  blockedReason,
  onOpen,
}: {
  publicUrl: string
  label: string
  blockedReason?: string | null
  onOpen?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const absoluteUrl = typeof window !== 'undefined'
    ? new URL(publicUrl, window.location.origin).toString()
    : publicUrl

  if (blockedReason) {
    return <p className="text-xs text-amber-700 dark:text-amber-400">{blockedReason}</p>
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard denied (insecure context) — the URL is still selectable in the field.
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <input
          readOnly
          value={absoluteUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="h-8 min-w-0 flex-1 rounded-md border bg-muted px-2 font-mono text-xs text-muted-foreground outline-none"
        />
        <Button variant="ghost" size="sm" onClick={() => void copy()} title="Copy link">
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <a
        href={publicUrl}
        target="_blank"
        rel="noopener"
        onClick={() => onOpen?.()}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {label}
      </a>
    </>
  )
}
