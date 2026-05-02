// Shared OG image layout for `next/og` ImageResponse routes.
// Used by every opengraph-image.tsx file under public surfaces so all
// social-share previews look like one product, not a patchwork.

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = 'image/png'

export interface OgLayoutProps {
  title: string
  subtitle?: string | null
  footer?: string | null
}

// Returns the JSX for one OG card. Pass to `new ImageResponse(<OgLayout ... />, { ...OG_SIZE })`.
// Constraints: Satori (the renderer behind next/og) supports a CSS subset only — every visible
// element needs an explicit `display`, no children-as-strings on flex parents, no className.
export function OgLayout({ title, subtitle, footer }: OgLayoutProps) {
  // Drop title size when it gets long so it still fits without clamping.
  const titleSize = title.length > 80 ? 64 : title.length > 50 ? 76 : 88

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        padding: '80px',
        position: 'relative',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: '200px',
          height: '6px',
          backgroundColor: '#3b82f6',
          marginBottom: '40px',
        }}
      />

      <div
        style={{
          fontSize: titleSize,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          color: '#f8fafc',
          marginBottom: subtitle ? 24 : 0,
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
            fontSize: 32,
            fontWeight: 400,
            color: '#94a3b8',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {subtitle}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 80,
          right: 80,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: 26,
        }}
      >
        <div
          style={{
            color: '#cbd5e1',
            fontWeight: 500,
            display: 'flex',
            maxWidth: '60%',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {footer || ''}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            color: '#64748b',
            fontWeight: 500,
          }}
        >
          <span>eduskript.org</span>
        </div>
      </div>
    </div>
  )
}
