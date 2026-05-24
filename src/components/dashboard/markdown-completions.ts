/**
 * Markdown autocompletion for the dashboard editor.
 *
 * Provides contextual suggestions for:
 * 1. Custom HTML tags (on `<`)
 * 2. Tag-specific attributes (inside an open tag)
 * 3. Known attribute values (inside quotes)
 * 4. Callout types (after `> [!`)
 * 5. Pandoc fenced-div directives (after `:::`)
 */

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { startCompletion } from '@codemirror/autocomplete'
import { calloutTypes } from '@/lib/remark-plugins/callouts'

// ── Tag definitions ──────────────────────────────────────────────────

interface TagDef {
  label: string
  info: string
  /** Text inserted when the completion is applied. */
  apply: string
  /** If set, cursor is placed at this offset within apply text and completions re-trigger. */
  cursorOffset?: number
}

const TAG_COMPLETIONS: TagDef[] = [
  { label: 'fullwidth', info: 'Edge-to-edge container that breaks out of page padding', apply: '<fullwidth>\n\n</fullwidth>' },
  { label: 'pdf', info: 'Embed a PDF with the browser\'s native viewer', apply: '<pdf src="" height="1267"></pdf>', cursorOffset: 10 },
  { label: 'flex', info: 'Responsive side-by-side layout container', apply: '<flex>\n<flex-item>\n\n</flex-item>\n<flex-item>\n\n</flex-item>\n</flex>' },
  { label: 'flex-item', info: 'Child of a <flex> container', apply: '<flex-item>\n\n</flex-item>' },
  { label: 'excali', info: 'Excalidraw drawing (auto light/dark)', apply: '<excali src="" />', cursorOffset: 13 },
  { label: 'img', info: 'Image with layout and invert support', apply: '<img src="" alt="" />', cursorOffset: 10 },
  { label: 'stickme', info: 'Pins wrapped content (image, schema, video) to the margin as you scroll; resizable', apply: '<stickme>\n\n</stickme>' },
  { label: 'plugin', info: 'User-created plugin in a sandboxed iframe', apply: '<plugin src="" height="400"></plugin>', cursorOffset: 13 },
  { label: 'question', info: 'Quiz question with multiple-choice or text answer', apply: '<question type="multiple-choice">\n\n<answer correct>Answer</answer>\n<answer>Wrong</answer>\n</question>' },
  { label: 'answer', info: 'Answer option inside a <question>', apply: '<answer>Text</answer>' },
  { label: 'mark', info: 'Highlight text', apply: '<mark></mark>' },
  { label: 'style', info: 'Scoped CSS block', apply: '<style>\n\n</style>' },
  { label: 'tabs-container', info: 'Tabbed content sections', apply: '<tabs-container>\n<tab-item label="Tab 1">\n\n</tab-item>\n<tab-item label="Tab 2">\n\n</tab-item>\n</tabs-container>' },
  { label: 'tab-item', info: 'Tab inside a <tabs-container>', apply: '<tab-item label="">\n\n</tab-item>' },
  { label: 'yt', info: 'YouTube timestamp link', apply: '<yt time="" label="" />' },
  { label: 'youtube', info: 'Embed a YouTube video (also works as ![caption](youtube-url))', apply: '<youtube id="" />', cursorOffset: 13 },
]

// ── Attribute definitions per tag ────────────────────────────────────

interface AttrDef {
  label: string
  info?: string
}

const GLOBAL_ATTRS: AttrDef[] = [
  { label: 'class', info: 'CSS class (e.g. invert-dark)' },
  { label: 'style', info: 'Inline CSS styles' },
]

const TAG_ATTRS: Record<string, AttrDef[]> = {
  'img': [
    { label: 'src', info: 'Image filename or URL' },
    { label: 'alt', info: 'Alt text (also used as caption)' },
    { label: 'align', info: 'left | center | right' },
    { label: 'wrap', info: 'Float with text wrap (true)' },
    { label: 'invert', info: 'Invert colors: dark | light | always' },
    { label: 'saturate', info: 'Saturation % when inverted (e.g. 70)' },
  ],
  'image': [
    { label: 'src', info: 'Image filename or URL' },
    { label: 'alt', info: 'Alt text' },
    { label: 'width', info: 'Width (e.g. 50%)' },
    { label: 'align', info: 'left | center | right' },
    { label: 'wrap', info: 'Float with text wrap (true)' },
    { label: 'invert', info: 'Invert colors: dark | light | always' },
    { label: 'saturate', info: 'Saturation % when inverted' },
  ],
  'pdf': [
    { label: 'src', info: 'PDF filename' },
    { label: 'height', info: 'Viewer height in px (default: 1267)' },
  ],
  'excali': [
    { label: 'src', info: 'Drawing name (without .excalidraw)' },
    { label: 'alt', info: 'Alt text' },
    { label: 'width', info: 'Width (e.g. 80%)' },
    { label: 'align', info: 'left | center | right' },
    { label: 'wrap', info: 'Float with text wrap (true)' },
  ],
  'flex': [
    { label: 'gap', info: 'none | small | medium | large' },
    { label: 'wrap', info: 'Allow wrapping (default: true)' },
    { label: 'direction', info: 'row | column' },
    { label: 'justify', info: 'start | center | end | between | around | evenly' },
    { label: 'align', info: 'start | center | end | stretch | baseline' },
  ],
  'flex-item': [
    { label: 'width', info: 'Fixed width (e.g. 300px, 40%)' },
    { label: 'grow', info: 'Allow flex grow (default: true)' },
  ],
  'plugin': [
    { label: 'src', info: 'Plugin source path' },
    { label: 'id', info: 'Unique plugin instance ID' },
    { label: 'height', info: 'Iframe height (e.g. 400)' },
    { label: 'width', info: 'Iframe width' },
    { label: 'name', info: 'Plugin name' },
  ],
  'question': [
    { label: 'id', info: 'Unique question ID' },
    { label: 'type', info: 'multiple-choice | single-choice | text' },
  ],
  'answer': [
    { label: 'correct', info: 'Mark as the correct answer' },
    { label: 'feedback', info: 'Feedback shown after answering' },
  ],
  'tab-item': [
    { label: 'label', info: 'Tab label text' },
  ],
  'yt': [
    { label: 'time', info: 'Timestamp (e.g. 1:23)' },
    { label: 'videoid', info: 'YouTube video ID' },
    { label: 'label', info: 'Link text' },
  ],
  'youtube': [
    { label: 'id', info: 'YouTube video ID (e.g. dQw4w9WgXcQ)' },
    { label: 'playlist', info: 'YouTube playlist ID (e.g. PLxyz...)' },
    { label: 'startTime', info: 'Start time in seconds' },
    { label: 'caption', info: 'Caption shown beneath the video' },
  ],
  'stickme': [],
  'fullwidth': [],
  'mark': [],
  'style': [],
}

// ── Per-plugin attribute definitions (keyed by `<plugin src="…">`) ───
// These attrs are merged in addition to the generic `plugin` attrs above
// when the current `<plugin>` tag's src matches. Add a new entry for each
// built-in plugin you want intellisense for; user plugins keep generic.
const PLUGIN_SRC_ATTRS: Record<string, AttrDef[]> = {
  'eduadmin/dijkstra-visualizer': [
    { label: 'initialnodecount', info: 'Initial node count (3..200, default 7)' },
    { label: 'initialdirected', info: 'Start in directed mode (true | false)' },
    { label: 'initialspeed', info: 'Animation speed 100..2000, higher = faster (default 1300)' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'eduadmin/mod-calc': [
    { label: 'formula', info: 'Initial formula' },
    { label: 'base', info: 'Initial base' },
    { label: 'exp', info: 'Initial exponent' },
    { label: 'mod', info: 'Initial modulus' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'eduadmin/cipher-lab': [
    { label: 'cipher', info: 'Initial cipher (e.g. caesar, vigenere)' },
    { label: 'cipherkey', info: 'Initial cipher key' },
    { label: 'text', info: 'Initial plaintext' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'eduadmin/mod-clock': [
    { label: 'mod', info: 'Initial modulus' },
    { label: 'modmax', info: 'Modulus slider max' },
    { label: 'max', info: 'Counter max' },
    { label: 'font', info: 'Custom font' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'eduadmin/diffie-hellman': [
    { label: 'p', info: 'Prime modulus' },
    { label: 'g', info: 'Generator' },
    { label: 'a', info: 'Alice secret' },
    { label: 'b', info: 'Bob secret' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'eduadmin/data-cube-visualizer': [
    { label: 'lang', info: 'UI language (en | de)' },
  ],
}

// ── Attribute value definitions ──────────────────────────────────────

const ATTR_VALUES: Record<string, string[]> = {
  'invert': ['dark', 'light', 'always'],
  'align': ['left', 'center', 'right'],
  'wrap': ['true'],
  'direction': ['row', 'column'],
  'justify': ['start', 'center', 'end', 'between', 'around', 'evenly'],
  'gap': ['none', 'small', 'medium', 'large'],
  'type': ['multiple-choice', 'single-choice', 'text'],
  'grow': ['true', 'false'],
  'class': ['invert-dark'],
}

// ── Block directive completions ──────────────────────────────────────

const DIRECTIVE_COMPLETIONS: Array<{ name: 'center' | 'left' | 'right'; info: string }> = [
  { name: 'center', info: 'Center-align block content (Pandoc fenced div)' },
  { name: 'left', info: 'Left-align block content (Pandoc fenced div)' },
  { name: 'right', info: 'Right-align block content (Pandoc fenced div)' },
]

// ── Callout completions ──────────────────────────────────────────────

// Build callout list from the canonical source
const CALLOUT_COMPLETIONS: Completion[] = Object.entries(calloutTypes).map(([name, resolvedType]) => ({
  label: name,
  type: 'keyword',
  info: name === resolvedType ? resolvedType : `${name} → ${resolvedType}`,
  boost: name === resolvedType ? 1 : 0, // base types sort first
}))

// ── File extension filters per tag for src attribute ─────────────────

const SRC_FILE_EXTENSIONS: Record<string, string[]> = {
  'excali': ['.excalidraw'],
  'img': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'],
  'image': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'],
  'pdf': ['.pdf'],
  'muxvideo': ['.mp4', '.mov'],
}

// ── File list type ───────────────────────────────────────────────────

export interface FileListItem {
  id: string
  name: string
  url?: string
  isDirectory?: boolean
}

// ── Main completion function ─────────────────────────────────────────

/**
 * Create a markdown completion source with access to the current file list.
 * The callback is invoked at completion time so it always reads the latest files.
 */
export function createMarkdownCompletions(getFileList: () => FileListItem[]) {
  return function markdownCompletions(context: CompletionContext): CompletionResult | null {
  // Get the text of the current line up to the cursor
  const line = context.state.doc.lineAt(context.pos)
  const textBefore = line.text.slice(0, context.pos - line.from)

  // 4. Callout types: > [!typ…
  const calloutMatch = textBefore.match(/>\s*\[!(\w*)$/)
  if (calloutMatch) {
    return {
      from: context.pos - calloutMatch[1].length,
      options: CALLOUT_COMPLETIONS,
      validFor: /^\w*$/,
    }
  }

  // 5. Block directives: :::nam… at start of line. Auto-expands the chosen
  // name into `:::name\n\n:::` and parks the cursor on the empty middle
  // line so the author can type content immediately. Mirrors how the
  // toolbar's alignment button wraps content.
  const directiveMatch = textBefore.match(/^:::(\w*)$/)
  if (directiveMatch) {
    const typed = directiveMatch[1]
    return {
      from: context.pos - typed.length,
      options: DIRECTIVE_COMPLETIONS.map(({ name, info }) => ({
        label: name,
        type: 'keyword',
        info,
        apply: (view: import('@codemirror/view').EditorView, _completion: Completion, fromPos: number, toPos: number) => {
          const insert = `${name}\n\n:::`
          view.dispatch({
            changes: { from: fromPos, to: toPos, insert },
            selection: { anchor: fromPos + name.length + 1 },
          })
        },
      })),
      validFor: /^\w*$/,
    }
  }

  // 3. Attribute value: attr="val…
  const valueMatch = textBefore.match(/([\w-]+)="([^"]*)$/)
  if (valueMatch) {
    const attrName = valueMatch[1]

    // src attribute: suggest files filtered by tag context
    if (attrName === 'src') {
      const fullTextBefore = context.state.doc.sliceString(0, context.pos)
      const tagName = findOpenTag(fullTextBefore)
      const files = getFileList().filter(f => !f.isDirectory)
      const extensions = (tagName && SRC_FILE_EXTENSIONS[tagName]) || null

      const filtered = extensions
        ? files.filter(f => extensions.some(ext => f.name.toLowerCase().endsWith(ext)))
        : files

      if (filtered.length > 0) {
        return {
          from: context.pos - valueMatch[2].length,
          options: filtered.map(f => ({ label: f.name, type: 'variable', info: f.name })),
          validFor: /^[^"]*$/,
        }
      }
      return null
    }

    // db attribute: suggest database files
    if (attrName === 'db') {
      const files = getFileList().filter(f =>
        !f.isDirectory && (f.name.endsWith('.db') || f.name.endsWith('.sqlite'))
      )
      if (files.length > 0) {
        return {
          from: context.pos - valueMatch[2].length,
          options: files.map(f => ({ label: f.name, type: 'variable' })),
          validFor: /^[^"]*$/,
        }
      }
      return null
    }

    const values = ATTR_VALUES[attrName]
    if (values) {
      return {
        from: context.pos - valueMatch[2].length,
        options: values.map(v => ({ label: v, type: 'enum' })),
        validFor: /^[^"]*$/,
      }
    }
    return null
  }

  // Find if we're inside an opening HTML tag
  // Scan backwards from cursor to find unclosed `<tagname`
  const fullTextBefore = context.state.doc.sliceString(0, context.pos)
  const tagContext = findOpenTag(fullTextBefore)

  // 2. Attribute completions: <tagname ...attr
  if (tagContext && /\s\w*$/.test(textBefore)) {
    const attrMatch = textBefore.match(/\s(\w*)$/)
    if (attrMatch) {
      const tagAttrs = TAG_ATTRS[tagContext] || []
      // Merge plugin-source-specific attrs when inside a <plugin src="…">
      const pluginAttrs = tagContext === 'plugin'
        ? (PLUGIN_SRC_ATTRS[findPluginSrc(fullTextBefore) || ''] || [])
        : []
      const allAttrs = [...tagAttrs, ...pluginAttrs, ...GLOBAL_ATTRS]

      return {
        from: context.pos - attrMatch[1].length,
        options: allAttrs.map(a => ({
          label: a.label,
          type: 'property',
          info: a.info,
          apply: (view, _completion, from, to) => {
            const insert = `${a.label}=""`
            // Place cursor between the quotes
            const cursorPos = from + a.label.length + 2
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: cursorPos },
            })
            // Immediately trigger value completions
            startCompletion(view)
          },
        })),
        validFor: /^\w*$/,
      }
    }
  }

  // 1. Tag completions: <tagn…
  const tagMatch = textBefore.match(/<(\w*)$/)
  if (tagMatch) {
    // Don't complete closing tags
    if (textBefore.endsWith('</')) return null
    const typed = tagMatch[1]
    return {
      from: context.pos - typed.length,
      options: TAG_COMPLETIONS.map(t => {
        // Strip leading `<` from apply text since the `<` is already in the document
        const applyText = t.apply.startsWith('<') ? t.apply.slice(1) : t.apply
        const cursorOffset = t.cursorOffset != null ? t.cursorOffset - 1 : undefined // -1 for stripped `<`

        return {
          label: t.label,
          type: 'type' as const,
          info: t.info,
          apply: cursorOffset != null
            ? (view: import('@codemirror/view').EditorView, _completion: Completion, from: number, to: number) => {
                view.dispatch({
                  changes: { from, to, insert: applyText },
                  selection: { anchor: from + cursorOffset },
                })
                startCompletion(view)
              }
            : applyText,
        }
      }),
      validFor: /^\w*$/,
    }
  }

  return null
  }
}

// ── Page-link completions ────────────────────────────────────────────

/**
 * Async completion source: when the cursor sits inside the URL parens of a
 * markdown link `[title](|)`, suggest the user's pages and insert the
 * selected one as a stable link `/p/{id}`. Stable links are slug-independent
 * and survive renames (see lib/page-stable-link.server.ts + the /p/[id]
 * redirect route).
 *
 * Registered as a separate source alongside markdownCompletions because it
 * needs to be async (fetches from /api/pages/search) while the existing
 * source is sync.
 */
interface PageSearchHit {
  id: string
  title: string
  skriptTitle: string
}

export async function pageLinkCompletions(
  context: CompletionContext
): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos)
  const textBefore = line.text.slice(0, context.pos - line.from)

  // Match the URL portion of `[label](|)` — cursor is after `](` with no
  // closing `)` or whitespace yet between `(` and the cursor.
  const linkMatch = textBefore.match(/\]\(([^)\s]*)$/)
  if (!linkMatch) return null

  const query = linkMatch[1]

  // Skip when the user is clearly typing an external/protocol URL — page
  // suggestions there would be noise. Anything else (empty, plain text,
  // partial /p/, relative path) gets the dropdown.
  if (/^(https?:|\/\/|mailto:|tel:)/i.test(query)) return null

  let hits: PageSearchHit[] = []
  try {
    const res = await fetch(`/api/pages/search?q=${encodeURIComponent(query)}`)
    if (!res.ok) return null
    const data = await res.json()
    hits = Array.isArray(data.pages) ? data.pages : []
  } catch {
    return null
  }
  if (hits.length === 0) return null

  return {
    from: context.pos - query.length,
    options: hits.map<Completion>(p => ({
      label: p.title,
      type: 'reference',
      detail: p.skriptTitle,
      apply: `/p/${p.id}`,
    })),
    validFor: /^[^)\s]*$/,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Inside the innermost unclosed `<plugin …>` tag, scan back for `src="…"`
 * and return the value, or null if not found / not in a plugin tag.
 */
function findPluginSrc(text: string): string | null {
  // Find the start of the unclosed `<plugin`
  let depth = 0
  let openIdx = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '>') {
      depth++
    } else if (text[i] === '<') {
      if (depth > 0) {
        depth--
      } else {
        openIdx = i
        break
      }
    }
  }
  if (openIdx < 0) return null
  const tag = text.slice(openIdx + 1)
  if (!tag.startsWith('plugin')) return null
  const m = tag.match(/\bsrc="([^"]*)"/)
  return m ? m[1] : null
}

/** Scan backwards to find the tag name of the innermost unclosed opening tag. */
function findOpenTag(text: string): string | null {
  // Find the last `<` that isn't part of a closing tag or already closed
  let depth = 0
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '>') {
      depth++
    } else if (text[i] === '<') {
      if (depth > 0) {
        depth--
      } else {
        // This `<` is unclosed — extract the tag name
        const after = text.slice(i + 1)
        if (after.startsWith('/')) return null // closing tag
        const match = after.match(/^(\w[\w-]*)/)
        return match ? match[1] : null
      }
    }
  }
  return null
}
