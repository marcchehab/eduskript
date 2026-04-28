/**
 * Paste-helper rule classifier for the dashboard markdown editor.
 *
 * Pure module: no DOM manipulation, no React, no CodeMirror. Takes a
 * ClipboardEvent's clipboardData (or a small subset of it for testing) and
 * returns a PasteIntent describing what the editor should do, or null to
 * fall through to the default browser paste.
 *
 * Architectural mirror of the drag-and-drop helper in
 * src/components/dashboard/codemirror-editor.tsx — same idea (classify by
 * content, then dispatch), different input source.
 */

import { parseYoutubeUrl } from '@/lib/youtube-url'

export interface PasteMenuOption {
  /** Display label, e.g. "Embed image" */
  label: string
  /** Markdown text inserted at the caret when picked. */
  insert: string
  /** Optional icon name (lucide). Picked up by the popup renderer. */
  icon?: 'image' | 'link' | 'youtube'
}

export type PasteIntent =
  /** Insert text directly at the caret. No menu. */
  | { kind: 'insert'; text: string }
  /** Show a contextual menu at the caret with these options. */
  | { kind: 'menu'; options: PasteMenuOption[] }
  /** Upload an image blob, then insert ![](filename) at the caret. */
  | { kind: 'upload-image'; file: File }

/** Minimal slice of ClipboardEvent.clipboardData the classifier reads. */
export interface PasteSource {
  getData(format: string): string
  files?: FileList | null
  items?: DataTransferItemList | null
}

const IMAGE_URL_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?(#.*)?$/i

/**
 * Classify a paste event. Returns null if no rule matches and the editor
 * should let the default browser paste run.
 */
export function classifyPaste(source: PasteSource): PasteIntent | null {
  // Image blob paste (screenshot, copied image) — check items first since some
  // browsers deliver the image in items but not files.
  const imageFile = findImageFile(source)
  if (imageFile) {
    return { kind: 'upload-image', file: imageFile }
  }

  const text = source.getData('text/plain').trim()
  if (!text) return null

  // YouTube URL — direct insert. The existing remark plugin renders the
  // embed; we only need ![](url) for it to fire.
  if (parseYoutubeUrl(text)) {
    return { kind: 'insert', text: `![](${text})` }
  }

  // Image URL — menu with two options.
  if (isImageUrl(text)) {
    const filename = extractFilename(text) || text
    return {
      kind: 'menu',
      options: [
        { label: 'Embed image', insert: `![](${text})`, icon: 'image' },
        { label: 'Insert link', insert: `[${filename}](${text})`, icon: 'link' },
      ],
    }
  }

  return null
}

function findImageFile(source: PasteSource): File | null {
  // items path
  if (source.items) {
    for (let i = 0; i < source.items.length; i++) {
      const item = source.items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) return file
      }
    }
  }
  // files path (fallback / Safari)
  if (source.files) {
    for (let i = 0; i < source.files.length; i++) {
      const file = source.files[i]
      if (file.type.startsWith('image/')) return file
    }
  }
  return null
}

function isImageUrl(text: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return IMAGE_URL_EXT_RE.test(parsed.pathname)
}

function extractFilename(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    return last || null
  } catch {
    return null
  }
}
