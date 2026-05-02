// Shared OG image layout for `next/og` ImageResponse routes.
// Used by every opengraph-image.tsx file under public surfaces so all
// social-share previews look like one product, not a patchwork.

import fs from 'node:fs/promises'
import path from 'node:path'

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = 'image/png'

export interface OgLayoutProps {
  title: string
  subtitle?: string | null
  footer?: string | null
  // Absolute URL for an icon (teacher pageIcon, org iconUrl).
  // Relative paths are resolved against `NEXTAUTH_URL` so the renderer can
  // fetch from /api/files/... in addition to S3-style absolute URLs.
  // Pass `null`, `undefined`, or the literal `'default'` (the value teachers
  // pick when they want the platform's default avatar) to render no icon.
  iconUrl?: string | null
}

// Cached so we only read the TTF once per process. Barlow Condensed Bold matches
// the project's `--font-heading` (Barlow_Condensed weight 700 in src/app/layout.tsx).
// Lives under public/fonts so Next.js standalone output bundles it (the
// alternative — reading from src/ via process.cwd() — fails in production
// because Next traces source files into a separate prefix).
let fontPromise: Promise<ArrayBuffer> | null = null
export function loadHeadingFont(): Promise<ArrayBuffer> {
  if (!fontPromise) {
    const fontPath = path.join(process.cwd(), 'public/fonts/barlow-condensed-700.ttf')
    fontPromise = fs.readFile(fontPath).then(buf =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    )
  }
  return fontPromise
}

export async function ogFonts() {
  const data = await loadHeadingFont()
  return [
    { name: 'Barlow Condensed', data, weight: 700 as const, style: 'normal' as const },
  ]
}

// Resolve a possibly-relative icon path to an absolute URL the OG renderer can fetch.
// Returns null when there's no usable icon.
export function resolveIconUrl(raw?: string | null): string | null {
  if (!raw || raw === 'default') return null
  if (/^https?:\/\//i.test(raw)) return raw
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`
}

// Returns the JSX for one OG card. Pass to `new ImageResponse(<OgLayout ... />, { ...OG_SIZE, fonts: await ogFonts() })`.
// Constraints: Satori (the renderer behind next/og) supports a CSS subset only — every visible
// element needs an explicit `display`, no className, no children-as-strings on flex parents.
export function OgLayout({ title, subtitle, footer, iconUrl }: OgLayoutProps) {
  // Drop title size when it gets long so it still fits without clamping.
  const titleSize = title.length > 80 ? 80 : title.length > 50 ? 96 : 112
  const resolvedIcon = resolveIconUrl(iconUrl)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1a1a1a',
        color: '#f5f5f5',
        padding: '80px',
        position: 'relative',
        fontFamily: '"Barlow Condensed", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: titleSize,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
          color: '#f5f5f5',
          marginBottom: subtitle ? 28 : 0,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </div>

      {subtitle && (
        <div
          style={{
            fontSize: 36,
            fontWeight: 400,
            color: '#a3a3a3',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {subtitle}
        </div>
      )}

      {(resolvedIcon || footer) && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 80,
            right: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 28,
            color: '#d4d4d4',
            fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {resolvedIcon && (
            // eslint-disable-next-line @next/next/no-img-element -- Satori needs a plain <img>; next/image isn't supported in ImageResponse
            <img
              src={resolvedIcon}
              width={64}
              height={64}
              alt=""
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                objectFit: 'cover',
                background: '#262626',
              }}
            />
          )}
          {footer && (
            <div
              style={{
                display: 'flex',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {footer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
