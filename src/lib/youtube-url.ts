/**
 * Shared YouTube URL recognition.
 *
 * Single source of truth used by:
 * - the remark plugin that turns ![](youtube-url) into <youtube-embed>
 *   (src/lib/remark-plugins/youtube-image.ts)
 * - the paste-helper that recognises YouTube URLs on paste
 *   (src/lib/paste-rules.ts)
 *
 * Recognised hosts: youtube.com, www.youtube.com, m.youtube.com, youtu.be.
 * Recognised paths: /watch?v=ID, /embed/ID, /shorts/ID, /playlist?list=ID,
 * youtu.be/ID. Time params: ?t=90, ?t=90s, ?t=1m30s, ?start=90.
 */

export interface YoutubeRef {
  id?: string
  playlist?: string
  startTime?: number
}

export function parseYoutubeUrl(rawUrl: string): YoutubeRef | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '')
  if (host !== 'youtube.com' && host !== 'youtu.be') return null

  let id: string | undefined
  let playlist: string | undefined

  if (host === 'youtu.be') {
    id = parsed.pathname.replace(/^\//, '').split('/')[0] || undefined
    playlist = parsed.searchParams.get('list') || undefined
  } else {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v') || undefined
    } else if (parsed.pathname.startsWith('/embed/')) {
      id = parsed.pathname.slice('/embed/'.length).split('/')[0] || undefined
    } else if (parsed.pathname.startsWith('/shorts/')) {
      id = parsed.pathname.slice('/shorts/'.length).split('/')[0] || undefined
    }
    playlist = parsed.searchParams.get('list') || undefined
  }

  if (!id && !playlist) return null

  const startTime = parseStartTime(parsed.searchParams.get('t') || parsed.searchParams.get('start'))

  return { id, playlist, startTime }
}

function parseStartTime(value: string | null): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  // 1h2m3s style — any combination, all parts optional
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match) return undefined
  const h = parseInt(match[1] || '0', 10)
  const m = parseInt(match[2] || '0', 10)
  const s = parseInt(match[3] || '0', 10)
  const total = h * 3600 + m * 60 + s
  return total > 0 ? total : undefined
}
