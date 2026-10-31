/**
 * File references in page content: how a skript file's name is written into
 * markdown and read back out again. Client-safe (no Prisma).
 *
 * Every embed path emits names through encodeFileRef/buildFileEmbed, and every
 * lookup goes through skript-files.ts (resolveFile), which accepts what
 * decodeFileRef and normalizeFileName undo. Three stored forms exist:
 *
 * 1. Percent-encoded (`![](a%20b.png)`): what the editor inserts now. The
 *    same encoded string works in a markdown destination, an HTML attribute
 *    and a code-fence meta value. The `<a b.png>` angle-bracket destination is
 *    avoided because rehype-raw parses it as an HTML tag inside a container
 *    such as <fullwidth> (rehypeMarkdownChildren re-parses that text later).
 * 2. Raw names with no special characters (`![](photo.png)`): unchanged.
 * 3. Raw names CommonMark rejects (`![](a b.png)`, `![](Bild (1.png)`): stored
 *    by editors before this module existed. repairFileRefs (file-ref-repair.ts)
 *    encodes them at render time.
 *
 * A `%` is encoded only when two hex digits follow it, so "50%.png" stays
 * `50%.png` and cannot be mistaken for a sibling "50%25.png", whose own embed
 * is `50%2525.png`. resolveFile tries the exact name first, for the raw form.
 *
 * Known limitation: "a b.png" and a sibling literally named "a%20b.png" both
 * have the reference `a%20b.png` (encoded and raw), and it resolves to the
 * sibling. Text in a page cannot say which was meant; see lookup in skript-files.ts.
 */

/** Extensions saveFile accepts by default, and `ALLOWED_FILE_TYPES`' fallback. */
export const ALLOWED_EXTENSIONS_DEFAULT = 'jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,odt,txt,md,zip,mp4,mp3,wav,ogg,webm,csv,json,xml,html,css,js,ts,py,java,cpp,c,h,hpp,rs,go,php,rb,sh,yml,yaml,excalidraw,db,sqlite,ig'

/** Every extension a stored file can have, with the video pipeline's and avif. */
export const UPLOADABLE_EXTENSIONS = [...ALLOWED_EXTENSIONS_DEFAULT.split(','), 'mov', 'avif']

/** Unicode NFC, every whitespace character as U+0020, trimmed. Case is kept. */
export function normalizeFileName(name: string): string {
  return name.normalize('NFC').replace(/\s/g, ' ').trim()
}

// Characters with a meaning in a markdown destination, HTML attribute, fence
// meta value, GFM table cell or `assets="a,b"` list, or invisible in the editor
// (\p{Cf} includes the ZWJ inside emoji sequences). Letters and most emoji stay
// raw so the source remains readable.
const UNSAFE_REF_CHARS = /%(?=[0-9a-f]{2})|[\s\p{Z}\p{Cc}\p{Cf}()<>[\]\\"'`&#?:|,{}]/giu

/** Write a filename so it can be pasted into markdown or an attribute value. */
export function encodeFileRef(name: string): string {
  return name.replace(UNSAFE_REF_CHARS, (char) =>
    // encodeURIComponent leaves ( ) ' alone.
    encodeURIComponent(char).replace(/[()']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  )
}

/** Percent-decode; malformed sequences (`100%.png`) stay as written. */
export function decodeFileRef(ref: string): string {
  return ref.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      return run
    }
  })
}

/** True for a skript filename, false for a URL, absolute path or anchor. */
export function isLocalFileRef(ref: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]+:|\/|#)/i.test(ref)
}

export type FileKind = 'pdf' | 'database' | 'image' | 'excalidraw' | 'video' | 'audio' | 'other'

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  sqlite: 'database', db: 'database',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  excalidraw: 'excalidraw',
  mp4: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio',
}

/** Classify a filename or stored reference by its extension, ignoring case. */
export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase()
  if (lower.endsWith('.excalidraw.md')) return 'excalidraw'
  return KIND_BY_EXTENSION[lower.split('.').pop() ?? ''] ?? 'other'
}

/**
 * Regex source for a reference as it appears in the markdown. The rendered
 * reference is the encoded form after repairFileRefs, while the page may hold
 * the raw name, so both are accepted, with or without angle brackets.
 */
export function fileRefPattern(ref: string): string {
  const forms = [...new Set([ref, decodeFileRef(ref)])].map(escapeRegExp).join('|')
  return `<?(?:${forms})>?`
}

/**
 * The items that `refs` (from extractReferencedFilenames) point at, compared
 * the way resolveFile compares, so a stored U+202F matches a typed space. O(n + m).
 * Keeps both rows when two stored names normalize alike: a copy of a page then
 * brings an unreferenced twin along, which is harmless.
 */
export function matchByRefs<T>(items: T[], refs: string[], nameOf: (item: T) => string): T[] {
  const wanted = new Set(refs.map(normalizeFileName))
  return items.filter((item) => wanted.has(normalizeFileName(nameOf(item))))
}

/** Escape for a double-quoted HTML attribute built by string concatenation. */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function linkLabel(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\`*_{}[\]()<>#+!|~$&]/g, '\\$&')
}

export interface FileEmbedOptions {
  /** Alt text. Empty by default: the pipeline renders alt as a figcaption. */
  alt?: string
  /** `id` of the SQL editor block. Omitted from the fence when not given. */
  editorId?: string
}

/**
 * The markdown for a skript file. `as: 'link'` applies to files that can be
 * either (pdf, database, image); drawings, videos and audio are always embeds
 * and anything else is always a download link.
 */
export function buildFileEmbed(name: string, as: 'embed' | 'link' = 'embed', options: FileEmbedOptions = {}): string {
  const ref = encodeFileRef(name)
  const link = `[${linkLabel(name)}](${ref})`
  switch (fileKind(name)) {
    case 'pdf':
      return as === 'link' ? link : `<pdf src="${ref}" height="1267"></pdf>`
    case 'database': {
      if (as === 'link') return link
      const id = options.editorId ? ` id="${options.editorId}"` : ''
      return `\`\`\`sql editor${id} db="${ref}"\n-- Show all tables in the database\nSELECT name FROM sqlite_master WHERE type='table' ORDER BY name;\n\`\`\``
    }
    case 'image':
      return as === 'link' ? link : `![${options.alt ?? ''}](${ref})`
    case 'excalidraw':
    case 'video':
      return `![${options.alt ?? ''}](${ref})`
    case 'audio':
      // Resolved to the current file URL by AudioComponent in markdown-components.
      return `<audio controls src="${ref}"></audio>`
    default:
      return link
  }
}

/**
 * Source for one inline link destination, up to the closing parenthesis:
 * `<angle form>`, or text with one level of balanced parentheses. Also matches
 * spaces, which CommonMark rejects, so stored form 3 above is found.
 */
export const FILE_DESTINATION_SOURCE = String.raw`<[^>\n]*>|(?:[^()\n]|\([^()\n]*\))*`

/** Split a matched destination into the reference and an optional title. */
export function parseFileDestination(raw: string): { ref: string; title?: string } {
  const text = raw.trim()
  if (text.startsWith('<') && text.endsWith('>')) return { ref: text.slice(1, -1) }
  const titled = text.match(/^(.*?)\s+(?:"([^"]*)"|'([^']*)')$/)
  if (titled) return { ref: titled[1], title: titled[2] ?? titled[3] }
  return { ref: text }
}

/**
 * The names a reference can mean: as written and percent-decoded. Compare the
 * result with matchByRefs, which also covers NFC/NFD and whitespace variants.
 */
export function fileRefCandidates(ref: string): string[] {
  return [...new Set([ref, decodeFileRef(ref)])]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Point every reference to `oldName` at `newName`, in each form it can be stored:
 * raw, percent-encoded, or in an angle-bracket destination. Rewrites links,
 * images, and src="…"/db="…" attributes. Fence contents are not excluded.
 */
export function renameFileRefs(content: string, oldName: string, newName: string): string {
  const forms = [...new Set([oldName, encodeFileRef(oldName)])].map(escapeRegExp).join('|')
  const newRef = encodeFileRef(newName)
  return content
    .replace(new RegExp(`\\]\\((?:<${forms}>|${forms})\\)`, 'g'), () => `](${newRef})`)
    .replace(new RegExp(`\\b(src|db)="(?:${forms})"`, 'g'), (_, attr: string) => `${attr}="${newRef}"`)
}
