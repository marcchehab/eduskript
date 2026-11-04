'use client'

import { useState, Children, ReactNode, ReactElement, isValidElement } from 'react'
import { cn } from '@/lib/utils'
import { usePrintMode } from '@/lib/print/print-mode'

interface TabsProps {
  items: string[]
  children?: ReactNode
  /** Pre-extracted tab contents (alternative to children with Tabs.Tab) */
  tabContents?: ReactNode[]
  className?: string
  /** Original markdown source lines, for editor preview cursor-sync. */
  sourceLineStart?: string
  sourceLineEnd?: string
}

/**
 * Tabs component for markdown - supports Nextra-style syntax:
 * <Tabs items={['Tab 1', 'Tab 2']}>
 *   <Tabs.Tab>Content 1</Tabs.Tab>
 *   <Tabs.Tab>Content 2</Tabs.Tab>
 * </Tabs>
 *
 * Or with pre-extracted contents:
 * <Tabs items={['Tab 1', 'Tab 2']} tabContents={[content1, content2]} />
 */
function TabsComponent({ items, children, tabContents: preExtractedContents, className, sourceLineStart, sourceLineEnd }: TabsProps) {
  const [activeTab, setActiveTab] = useState(0)
  const printing = usePrintMode()

  // Use pre-extracted contents if provided, otherwise collect from children
  let tabContents: ReactNode[] = preExtractedContents || []

  if (!preExtractedContents && children) {
    Children.forEach(children, (child) => {
      if (isValidElement(child)) {
        // Check if it's a Tab component (Tabs.Tab)
        const element = child as ReactElement<{ children?: ReactNode }>
        if (element.type === Tab) {
          tabContents.push(element.props.children)
        }
      }
    })
  }

  if (items.length === 0 || tabContents.length === 0) {
    return <>{children}</>
  }

  const box = (index: number, extra?: Record<string, string>) => (
    <div
      key={index}
      className={cn('my-6 border border-border rounded-lg overflow-hidden', className)}
      {...(extra ?? { 'data-source-line-start': sourceLineStart, 'data-source-line-end': sourceLineEnd })}
    >
      {/* Tab headers */}
      <div className="flex flex-wrap gap-0 bg-muted/50 border-b border-border overflow-x-auto overflow-y-hidden">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              'hover:bg-muted focus:outline-hidden focus:ring-2 focus:ring-primary/20',
              index === i
                ? 'bg-card text-foreground border-b-2 border-primary -mb-px'
                : 'text-muted-foreground'
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {/* Tab content. Drop the first child's top margin (e.g. a leading
          heading) so it doesn't add dead space under the tab strip. */}
      <div className="p-4 bg-card [&>*:first-child]:mt-0!">
        {tabContents[index]}
      </div>
    </div>
  )

  if (!printing) return box(activeTab)

  // Print view: every other tab follows the active one as its own box with
  // that tab selected in the strip; the active box stays where it is online.
  // Sibling boxes (not nested), so the paginator can break between them.
  // data-print-online-height="0": strokes below move by the added height
  // (section-anchored-strokes.tsx). data-print-tab-copy: no source lines, so
  // the page-break overlay offers no "+" before them (print-edit-overlay.tsx).
  return (
    <>
      {box(activeTab)}
      {tabContents.map((_, index) => index === activeTab ? null : box(index, { 'data-print-online-height': '0', 'data-print-tab-copy': '' }))}
    </>
  )
}

interface TabProps {
  children: ReactNode
}

/**
 * Tab content component - used as Tabs.Tab
 */
function Tab({ children }: TabProps) {
  return <>{children}</>
}

// Create compound component pattern: Tabs.Tab
export const Tabs = Object.assign(TabsComponent, { Tab })

// Legacy exports for remarkTabs plugin output
export { TabsComponent as TabsContainer }
export { Tab as TabItem }
