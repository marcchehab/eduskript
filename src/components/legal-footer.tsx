import Link from 'next/link'

/** Revision label shown next to every "Terms" link. Bump it whenever the terms
 *  or the privacy policy change (terms §12 promises the date is in the footer). */
export const TERMS_DATE = 'Sep 2026'

/** Footer of the legal pages (/impressum, /terms, /datenschutz). The app-wide
 *  footers (dashboard sidebar, public layout) render the same three links inline. */
export function LegalFooter() {
  return (
    <>
      <p className="text-sm text-muted-foreground mt-12">Stand: September 2026</p>
      <footer className="mt-16 pt-4 border-t text-center text-xs text-muted-foreground/50">
        <Link href="/impressum" className="hover:text-muted-foreground">Legal</Link>
        <span className="mx-2">·</span>
        <Link href="/datenschutz" className="hover:text-muted-foreground">Privacy</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-muted-foreground">Terms ({TERMS_DATE})</Link>
      </footer>
    </>
  )
}
