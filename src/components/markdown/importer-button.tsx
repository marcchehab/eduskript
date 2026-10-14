/**
 * <importer> — button linking to the anonymous skript import (/import).
 *
 *   <importer />
 *   <importer lang="de" />
 *   <importer lang="de" label="Eigenes Skript ausprobieren" />
 *
 * Deliberately only a link, no upload: /import shows the student-data and
 * AI-processing notice that must be seen before a file is sent. The format list
 * mirrors the accept/hint in src/app/(app)/import/import-upload.tsx — keep them
 * in sync by hand. /import is served on every host (src/proxy.ts passthrough),
 * so the relative href also works on custom teacher domains.
 */

import Link from 'next/link'
import { Upload } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FORMATS = '.docx · .doc · .odt · .rtf · .pdf'

interface ImporterButtonProps {
  lang?: string
  label?: string
}

export function ImporterButton({ lang, label }: ImporterButtonProps) {
  const de = lang === 'de'
  const text = label || (de ? 'Word-Skript importieren' : 'Import a Word script')

  return (
    // span wrapper, not div: the tag can end up inside a paragraph (see cta-button.tsx).
    <span className="my-6 flex justify-center">
      <Link
        href="/import"
        className={cn(buttonVariants({ size: 'lg' }), 'h-auto gap-3 py-3 px-6 no-underline')}
        // Inline styles beat `.prose-theme a` (colour + underline), see cta-button.tsx.
        // Fixed white, not --color-primary-foreground: that is dark in dark mode,
        // which left the format line barely readable on the blue button.
        style={{ textDecoration: 'none', color: '#fff' }}
      >
        <Upload className="size-6! shrink-0" />
        <span className="flex flex-col items-start gap-0.5 leading-tight">
          <span className="text-base font-semibold">{text}</span>
          <span className="text-xs opacity-80 font-normal">{FORMATS}</span>
        </span>
      </Link>
    </span>
  )
}
