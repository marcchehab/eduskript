'use client'

/**
 * Word-style ribbon primitives for the markdown editor toolbar.
 *
 * Deliberately mimics the Microsoft Word ribbon (tabs → labeled groups →
 * big/small buttons, style gallery, collapsible panel) so teachers who know
 * Word can transfer that spatial memory 1:1. Used by codemirror-editor.tsx,
 * which assembles the actual tab contents from its insert/format handlers.
 *
 * Behavior ("auto-hide ribbon", like Word's collapsed ribbon):
 * - Only the tab bar is visible while editing. Clicking a tab opens its panel
 *   as an overlay over the editor (nothing below moves); clicking outside it
 *   (e.g. back into the editor) or Escape closes it. Clicking the open tab
 *   again closes it too.
 * - Tabs marked `pinned` (AI Edit) open inline instead and stay open: their
 *   panel is used side by side with the editor below.
 * - Tabs marked align 'right' sit outside the scrollable tab strip, so they
 *   stay reachable on narrow screens.
 * - Groups are separated by vertical dividers with a small centered caption.
 * - Signature actions get big buttons (icon over label); dense controls get
 *   small square buttons in stacked rows.
 *
 * All button components spread ...rest so they work as Radix asChild targets
 * (DropdownMenuTrigger clones them and injects onClick/aria/ref props).
 */

import { useState, useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

export interface RibbonTabDef {
  id: string
  label: string
  content: ReactNode
  /** Word-contextual-tab-style coloring (e.g. subject tabs): tailwind classes
      for the active and idle tab label. Neutral tabs omit it. */
  accent?: { active: string; idle: string; fill?: string }
  /** Small icon before the label. */
  icon?: ReactNode
  /** Render at the right end of the tab bar (e.g. AI Edit) instead of in sequence. */
  align?: 'right'
  /** Open inline and stay open (doesn't auto-hide on outside click). */
  pinned?: boolean
}

interface RibbonProps {
  tabs: RibbonTabDef[]
  /** Rendered at the right end of the tab bar (always visible). */
  tabBarRight?: ReactNode
}

export function Ribbon({ tabs, tabBarRight }: RibbonProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = tabs.find(t => t.id === activeId) ?? null
  const overlayOpen = !!active && !active.pinned

  // Auto-hide: outside pointerdown / Escape closes an overlay panel. Clicks in
  // Radix portals (dropdowns, color pickers opened from the panel) count as
  // inside, otherwise the panel would vanish under an open menu.
  useEffect(() => {
    if (!overlayOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || rootRef.current?.contains(t)) return
      if (t.closest('[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"]')) return
      setActiveId(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveId(null) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [overlayOpen])

  const tabButton = (tab: RibbonTabDef) => {
    const isActive = tab.id === activeId
    return (
      <button
        key={tab.id}
        type="button"
        aria-expanded={isActive}
        onClick={() => setActiveId(isActive ? null : tab.id)}
        className={`shrink-0 px-3 py-1 rounded-t-md border-b-2 transition-colors ${
          isActive
            ? tab.accent
              ? `font-medium ${tab.accent.active}`
              : 'border-primary text-primary font-medium'
            : tab.accent
              ? `border-transparent hover:bg-accent/50 ${tab.accent.idle}`
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
        } ${tab.icon ? 'flex items-center gap-1.5' : ''}`}
      >
        {tab.icon}
        {tab.label}
      </button>
    )
  }

  // Word-style tinted panel: a soft top-to-bottom gradient in the active
  // tab's color (neutral tabs: gray), on an opaque card background so the
  // overlay hides the editor beneath it.
  const panel = active && (
    <div className="rounded-md bg-card">
      <div
        className={`flex items-stretch overflow-x-auto rounded-md px-2 py-1 bg-linear-to-b ${
          active.accent?.fill ?? 'from-muted-foreground/15 to-muted-foreground/[0.03]'
        }`}
      >
        {active.content}
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="relative border-b border-border select-none">
      {/* Tab bar: left tabs scroll on narrow screens; right tabs stay put. */}
      <div className="flex items-center gap-0.5 px-2 pt-1 text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap">
          {tabs.filter(t => t.align !== 'right').map(tabButton)}
        </div>
        {tabs.filter(t => t.align === 'right').map(tabButton)}
        {tabBarRight}
      </div>
      {active && (active.pinned ? (
        <div className="mx-2 mb-2 mt-1">{panel}</div>
      ) : (
        <div className="absolute inset-x-2 top-full z-30 mt-1 rounded-md border border-border shadow-lg">{panel}</div>
      ))}
    </div>
  )
}

/** Labeled group: content row on top, small centered caption below, divider on the right. */
export function RibbonGroup({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-stretch shrink-0 ${className ?? ''}`}>
      <div className="flex flex-col items-center px-1.5">
        <div className="flex items-center gap-0.5 flex-1">{children}</div>
        <div className="text-[10px] leading-4 text-muted-foreground whitespace-nowrap">{caption}</div>
      </div>
      <div className="w-px bg-border my-1" />
    </div>
  )
}

interface RibbonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  active?: boolean
}

/** Big Word-style button: icon above a small label. */
export function RibbonBigButton({ icon, label, active, className, ...rest }: RibbonButtonProps & { label: string }) {
  return (
    <button
      type="button"
      title={rest.title ?? label}
      className={`flex flex-col items-center justify-start gap-1 w-14 h-[3.75rem] pt-1.5 rounded-md text-foreground ${
        active ? 'bg-accent' : 'hover:bg-accent/60'
      } disabled:opacity-40 disabled:pointer-events-none ${className ?? ''}`}
      {...rest}
    >
      <span className="[&>svg]:w-5 [&>svg]:h-5">{icon}</span>
      <span className="text-[11px] leading-tight text-center">{label}</span>
    </button>
  )
}

/** Small square button for dense rows (Word's Font/Paragraph group style). */
export function RibbonSmallButton({ icon, active, className, ...rest }: RibbonButtonProps) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center w-7 h-7 rounded ${
        active ? 'bg-accent' : 'hover:bg-accent/60'
      } disabled:opacity-40 disabled:pointer-events-none [&>svg]:w-4 [&>svg]:h-4 ${className ?? ''}`}
      {...rest}
    >
      {icon}
    </button>
  )
}

/** Two stacked rows of small buttons, like Word's Font group. */
export function RibbonSmallStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col justify-center gap-0.5">{children}</div>
}

export function RibbonSmallRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>
}

/**
 * Word-style split big button: top half fires the default action, the label +
 * chevron bottom half is the dropdown trigger (wrap it in DropdownMenuTrigger
 * asChild via `menuTrigger`).
 */
export function RibbonSplitBigButton({ icon, label, onDefaultAction, title, menuTrigger }: {
  icon: ReactNode
  label: string
  onDefaultAction: () => void
  title?: string
  menuTrigger: (bottomHalf: ReactNode) => ReactNode
}) {
  return (
    <div className="flex flex-col items-center w-14 h-[3.75rem] rounded-md overflow-hidden">
      {/* Both halves together mirror RibbonBigButton's geometry (pt-1.5 +
          20px icon + gap-1 + 11px label) so icon and label line up with
          neighboring big buttons; the dropdown trigger is the label half. */}
      <button
        type="button"
        onClick={onDefaultAction}
        title={title ?? label}
        className="flex items-start justify-center w-full pt-1.5 pb-1 hover:bg-accent/60 rounded-t-md [&>svg]:w-5 [&>svg]:h-5"
      >
        {icon}
      </button>
      {menuTrigger(
        <button
          type="button"
          title={`${label} options`}
          className="flex items-start justify-center gap-0.5 w-full flex-1 hover:bg-accent/60 rounded-b-md"
        >
          <span className="text-[11px] leading-tight">{label}</span>
          <ChevronDown className="w-2.5 h-2.5 mt-0.5" />
        </button>
      )}
    </div>
  )
}

/** Style-gallery chip (Word's Styles group): a small preview tile with a label. */
export function RibbonGalleryChip({ preview, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { preview: ReactNode; label: string }) {
  return (
    <button
      type="button"
      title={rest.title ?? label}
      className={`flex flex-col items-center justify-between w-[4.5rem] h-[3.4rem] py-1 px-1 rounded-md border border-border bg-background hover:border-primary/60 hover:bg-accent/40 ${className ?? ''}`}
      {...rest}
    >
      <span className="flex-1 flex items-center justify-center w-full overflow-hidden">{preview}</span>
      <span className="text-[10px] leading-tight text-muted-foreground truncate max-w-full">{label}</span>
    </button>
  )
}
