'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CircleCheckBig, CircleMinus, EyeOff, Globe, Link2, Loader2, LayoutTemplate } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { getVisibility, type VisibilityFlags, type VisibilityState } from '@/lib/visibility'

/**
 * One badge answering "can students see this?" for a page or skript, with a
 * popover that lists every level that affects it (page, skript, placement on
 * the site) and lets the author change page/skript state in place.
 * Rules: src/lib/visibility.ts.
 *
 * Flags are held locally after a change (optimistic, PATCHed to the same
 * endpoints as PublishToggle) and re-synced whenever the props change, so
 * callers that router.refresh() in onChange stay consistent. Callers with
 * client-side state (page builder) can ignore onChange.
 */

type Flags = Required<VisibilityFlags>
type FlagValue = 'draft' | 'unlisted' | 'published'

interface VisibilityBadgeProps {
  page?: { id: string } & VisibilityFlags
  skript: { id: string } & VisibilityFlags
  placed?: boolean
  placementRequired?: boolean
  canEdit: boolean
  /** Icon-only trigger for dense rows (page builder, library cards). */
  compact?: boolean
  /** Hide the "Open Page Builder" link when already on the page builder. */
  hidePageBuilderLink?: boolean
  onChange?: (level: 'page' | 'skript', flags: Flags) => void
}

const stateConfig: Record<VisibilityState, { label: string; icon: typeof Globe; className: string }> = {
  public: {
    label: 'Public',
    icon: Globe,
    className: 'text-success border-success/40 bg-success/10',
  },
  'link-only': {
    label: 'Link only',
    icon: Link2,
    className: 'text-violet-600 dark:text-violet-400 border-violet-500/40 bg-violet-500/10',
  },
  hidden: {
    label: 'Not visible',
    icon: EyeOff,
    className: 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/10',
  },
}

const statusIcon = {
  ok: <CircleCheckBig className="w-4 h-4 text-success shrink-0 mt-0.5" />,
  limited: <Link2 className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />,
  blocked: <CircleMinus className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />,
}

function toFlags(f: VisibilityFlags): Flags {
  return { isPublished: f.isPublished, isUnlisted: !!f.isUnlisted }
}
function toValue(f: Flags): FlagValue {
  return !f.isPublished ? 'draft' : f.isUnlisted ? 'unlisted' : 'published'
}

function summary(state: VisibilityState, subject: 'page' | 'skript'): string {
  if (state === 'public') return `Students and the public can see this ${subject}.`
  if (state === 'link-only') return `Only people with the link can open this ${subject}.`
  return `Students and the public can’t see this ${subject} yet.`
}

export function VisibilityBadge({
  page,
  skript,
  placed,
  placementRequired,
  canEdit,
  compact = false,
  hidePageBuilderLink = false,
  onChange,
}: VisibilityBadgeProps) {
  const [pageFlags, setPageFlags] = useState<Flags | undefined>(page && toFlags(page))
  const [skriptFlags, setSkriptFlags] = useState<Flags>(toFlags(skript))
  const [saving, setSaving] = useState<'page' | 'skript' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (page) setPageFlags({ isPublished: page.isPublished, isUnlisted: !!page.isUnlisted })
  }, [page?.isPublished, page?.isUnlisted]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSkriptFlags({ isPublished: skript.isPublished, isUnlisted: !!skript.isUnlisted })
  }, [skript.isPublished, skript.isUnlisted])

  const subject = page ? 'page' : 'skript'
  const { state, checks } = getVisibility({ page: pageFlags, skript: skriptFlags, placed, placementRequired })
  const config = stateConfig[state]
  const Icon = config.icon

  const setLevel = async (level: 'page' | 'skript', value: FlagValue) => {
    const id = level === 'page' ? page!.id : skript.id
    const next: Flags = { isPublished: value !== 'draft', isUnlisted: value === 'unlisted' }
    setSaving(level)
    setError(null)
    try {
      const res = await fetch(level === 'page' ? `/api/pages/${id}` : `/api/skripts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error(String(res.status))
      if (level === 'page') setPageFlags(next)
      else setSkriptFlags(next)
      onChange?.(level, next)
    } catch {
      setError(`Could not change the ${level}. Please try again.`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border font-medium transition-colors hover:brightness-95 shrink-0',
            compact ? 'p-1' : 'px-2.5 py-1 text-xs',
            config.className
          )}
          title={`${config.label}: ${summary(state, subject)}`}
          aria-label={`Visibility: ${config.label}`}
        >
          <Icon className="w-3.5 h-3.5" />
          {!compact && config.label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className={cn('flex items-start gap-2 px-4 py-3 border-b rounded-t-md', config.className, 'border-x-0 border-t-0')}>
          <Icon className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold">{config.label}</div>
            <div className="text-xs text-foreground/80">{summary(state, subject)}</div>
          </div>
        </div>
        <ul className="px-4 py-3 space-y-3">
          {checks.map((check) => {
            const flags = check.level === 'page' ? pageFlags : check.level === 'skript' ? skriptFlags : undefined
            return (
              <li key={check.level} className="flex items-start gap-2">
                {statusIcon[check.status]}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-sm font-medium leading-tight">{check.label}</div>
                  {check.detail && <div className="text-xs text-muted-foreground">{check.detail}</div>}
                  {flags && canEdit && (check.level === 'page' || check.level === 'skript') && (
                    <FlagSwitch
                      value={toValue(flags)}
                      saving={saving === check.level}
                      onSelect={(v) => setLevel(check.level as 'page' | 'skript', v)}
                    />
                  )}
                  {check.level === 'placement' && check.status !== 'ok' && !hidePageBuilderLink && (
                    <Link
                      href="/dashboard/page-builder"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <LayoutTemplate className="w-3 h-3" />
                      Open Page Builder
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {error && <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">{error}</div>}
      </PopoverContent>
    </Popover>
  )
}

function FlagSwitch({
  value,
  saving,
  onSelect,
}: {
  value: FlagValue
  saving: boolean
  onSelect: (v: FlagValue) => void
}) {
  const options: { value: FlagValue; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'unlisted', label: 'Unlisted' },
    { value: 'published', label: 'Published' },
  ]
  return (
    <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={saving || o.value === value}
          onClick={() => onSelect(o.value)}
          className={cn(
            'px-2 py-0.5 rounded-sm transition-colors',
            o.value === value
              ? 'bg-background shadow-xs font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground disabled:opacity-60'
          )}
        >
          {o.label}
        </button>
      ))}
      {saving && <Loader2 className="w-3 h-3 mx-1 animate-spin text-muted-foreground" />}
    </div>
  )
}
