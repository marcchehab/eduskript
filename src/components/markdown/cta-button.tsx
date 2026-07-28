/**
 * <cta> — a call-to-action button for page content.
 *
 * Renders as a link styled with the app's own button variants, so a CTA on a
 * teacher page matches the rest of the UI (and follows the theme) instead of
 * being a drawn image that never changes with it.
 *
 *   <cta href="/auth/signup">Create free account</cta>
 *   <cta href="/auth/signup" label="Create free account" variant="outline" size="lg" align="left" />
 *
 * The label comes from the children when present, otherwise from `label`, so
 * both the container and the self-closing form work.
 */

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type CtaVariant = 'default' | 'secondary' | 'outline' | 'ghost'
export type CtaSize = 'default' | 'sm' | 'lg'
export type CtaAlign = 'left' | 'center' | 'right'

interface CtaButtonProps {
  href?: string
  label?: string
  variant?: CtaVariant
  size?: CtaSize
  align?: CtaAlign
  /** Opens in a new tab. Defaults to true for absolute URLs to other hosts. */
  external?: boolean
  children?: React.ReactNode
}

const ALIGN_CLASS: Record<CtaAlign, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
}

/**
 * Page content is styled by `.prose-theme a { @apply text-primary underline }`
 * in globals.css, which at specificity 0,1,1 outranks the button's own utility
 * classes at 0,1,0 — the default variant came out as primary-blue text on a
 * primary-blue background, i.e. an empty-looking button, and every variant was
 * underlined. Inline styles are the one thing that beats it without either
 * weakening the prose rule for every link on the site or scattering `!important`
 * through the variants.
 */
// The --color-* variables, not the bare --primary-foreground ones: the latter
// hold raw HSL triples ("210 40% 98%") that only work inside hsl().
const VARIANT_COLOR: Record<CtaVariant, string> = {
  default: 'var(--color-primary-foreground)',
  secondary: 'var(--color-secondary-foreground)',
  outline: 'var(--color-foreground)',
  ghost: 'var(--color-foreground)',
}

export function CtaButton({
  href,
  label,
  variant = 'default',
  size = 'lg',
  align = 'center',
  external,
  children,
}: CtaButtonProps) {
  const hasChildren = children !== undefined && children !== null && children !== ''
  const content = hasChildren ? children : label

  if (!href || !content) {
    return (
      <span className="text-sm text-destructive">
        &lt;cta&gt; needs an href and a label
      </span>
    )
  }

  const isAbsolute = /^https?:\/\//i.test(href)
  const opensNewTab = external ?? isAbsolute

  const classes = cn(buttonVariants({ variant, size }), 'no-underline')
  const proseOverride: React.CSSProperties = {
    textDecoration: 'none',
    color: VARIANT_COLOR[variant],
  }

  // A span wrapper, not a div: <cta> can sit inside a paragraph, and a block
  // element there would be hoisted out by the HTML parser.
  return (
    <span className={cn('my-6 flex', ALIGN_CLASS[align])}>
      {isAbsolute ? (
        <a
          href={href}
          className={classes}
          style={proseOverride}
          {...(opensNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {content}
        </a>
      ) : (
        <Link
          href={href}
          className={classes}
          style={proseOverride}
          {...(opensNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {content}
        </Link>
      )}
    </span>
  )
}
