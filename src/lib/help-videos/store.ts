// Contextual help videos: a "How do I …?" link anywhere (dashboard UI or a
// <helpvideo> tag in page markdown) opens a docked video panel that stays
// open across navigation until the viewer closes it with X — like the
// onboarding quest widget, but for anyone, logged in or not.
//
// Clips are skript-less Mux `Video` rows with the filename `help-<topic>.mp4`,
// uploaded with scripts/upload-onboarding-video.mjs (same as the quest clips).
// Topics are free-form slugs: a new clip needs no code change, only the
// upload plus a link that names the topic. HELP_TOPIC_TITLES just supplies a
// default panel title for topics linked from the dashboard.
//
// The open topic lives in localStorage, so it survives reloads and route
// changes and syncs across tabs (storage event). Limitation: localStorage is
// per origin, so a panel opened on eduskript.org doesn't follow the viewer
// onto a teacher's custom domain (the quest solves that with server-side
// UserData, which would force a login we don't want here).

export const HELP_TOPIC_TITLES: Record<string, string> = {
  'create-skript': 'How do I create a new skript?',
}

export interface OpenHelpVideo {
  topic: string
  title: string
}

const STORAGE_KEY = 'eduskript:help-video'
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidHelpTopic(topic: string): boolean {
  return TOPIC_PATTERN.test(topic)
}

export function helpVideoFilename(topic: string): string {
  return `help-${topic}.mp4`
}

const listeners = new Set<() => void>()
// useSyncExternalStore needs a referentially stable snapshot, so parse once
// per raw string instead of on every getSnapshot call.
let lastRaw: string | null = null
let lastParsed: OpenHelpVideo | null = null

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function getOpenHelpVideo(): OpenHelpVideo | null {
  if (typeof window === 'undefined') return null
  const raw = readRaw()
  if (raw === lastRaw) return lastParsed
  lastRaw = raw
  lastParsed = null
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<OpenHelpVideo>
      if (typeof parsed.topic === 'string' && isValidHelpTopic(parsed.topic)) {
        lastParsed = {
          topic: parsed.topic,
          title: typeof parsed.title === 'string' && parsed.title ? parsed.title : parsed.topic,
        }
      }
    } catch {
      // corrupt entry — treat as closed
    }
  }
  return lastParsed
}

export function getServerHelpVideo(): OpenHelpVideo | null {
  return null
}

function write(value: OpenHelpVideo | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode etc.): the panel still opens for this
    // page view via the in-memory snapshot below, it just won't persist.
    lastRaw = value ? JSON.stringify(value) : null
    lastParsed = value
  }
  listeners.forEach((listener) => listener())
}

export function openHelpVideo(topic: string, title?: string) {
  if (!isValidHelpTopic(topic)) return
  write({ topic, title: title || HELP_TOPIC_TITLES[topic] || topic })
}

export function closeHelpVideo() {
  write(null)
}

export function subscribeHelpVideo(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
