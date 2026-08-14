/**
 * Markdown autocompletion for the dashboard editor.
 *
 * Provides contextual suggestions for:
 * 1. Custom HTML tags (on `<`)
 * 2. Tag-specific attributes (inside an open tag)
 * 3. Known attribute values (inside quotes)
 * 4. Callout types (after `> [!`)
 *
 * Keep this in sync with src/lib/ai/syntax-reference.ts — that file is the
 * canonical list of supported components/attributes.
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
  { label: 'question', info: 'Quiz question: multiple/single choice, text, number, or range', apply: '<question type="multiple">\n\n<answer correct>Answer</answer>\n<answer>Wrong</answer>\n</question>' },
  { label: 'answer', info: 'Answer option inside a <question>', apply: '<answer>Text</answer>' },
  { label: 'mark', info: 'Highlight text', apply: '<mark></mark>' },
  { label: 'style', info: 'Scoped CSS block', apply: '<style>\n\n</style>' },
  { label: 'tabs-container', info: 'Tabbed content sections', apply: '<tabs-container data-items=\'["Tab 1","Tab 2"]\'>\n<tab-item>\n\n</tab-item>\n<tab-item>\n\n</tab-item>\n</tabs-container>' },
  { label: 'tab-item', info: 'Tab inside a <tabs-container> (label comes from the container\'s data-items)', apply: '<tab-item>\n\n</tab-item>' },
  { label: 'yt', info: 'YouTube timestamp link', apply: '<yt time="" label="" />' },
  { label: 'youtube', info: 'Embed a YouTube video (also works as ![caption](youtube-url))', apply: '<youtube id="" />', cursorOffset: 13 },
  { label: 'molecule', info: 'Structural formula from a SMILES string', apply: '<molecule smiles="" />', cursorOffset: 18 },
  { label: 'geogebra', info: 'Embed an interactive GeoGebra applet by material id', apply: '<geogebra material-id="" />', cursorOffset: 23 },
  { label: 'spacer', info: 'Blank writing area for students to solve on by hand', apply: '<spacer pattern="checkered" height="200" />' },
  { label: 'cta', info: 'Call-to-action link styled as a button', apply: '<cta href="">Text</cta>', cursorOffset: 11 },
  { label: 'newsletter', info: 'Email signup box (Brevo list)', apply: '<newsletter />' },
  { label: 'ai-feedback', info: 'Button: send pen strokes/section content to a vision model for feedback', apply: '<ai-feedback prompt="" />', cursorOffset: 21 },
  { label: 'ping', info: 'Interactive ping terminal', apply: '<ping />' },
  { label: 'next-stage', info: 'One-way divider that hands in the previous stage and reveals the next', apply: '<next-stage label="" />', cursorOffset: 19 },
  { label: 'muxvideo', info: 'Mux video with playback options (gif, autoplay, loop, pin, poster)', apply: '<muxvideo src="" />', cursorOffset: 15 },
  { label: 'left', info: 'Left-align block content', apply: '<left>\n\n</left>' },
  { label: 'center', info: 'Center-align block content', apply: '<center>\n\n</center>' },
  { label: 'right', info: 'Right-align block content', apply: '<right>\n\n</right>' },
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
  ],
  'question': [
    { label: 'id', info: 'Unique question ID' },
    { label: 'type', info: 'single | multiple | text | number | range (default: multiple)' },
    { label: 'showFeedback', info: 'Show per-answer feedback after submitting' },
    { label: 'points', info: 'Points awarded for a correct answer' },
    { label: 'minValue', info: 'Range: minimum value' },
    { label: 'maxValue', info: 'Range: maximum value' },
    { label: 'step', info: 'Range: step size' },
    { label: 'minLabel', info: 'Range: label at the minimum end' },
    { label: 'maxLabel', info: 'Range: label at the maximum end' },
    { label: 'expected', info: 'Text/number: the expected answer' },
    { label: 'tolerance', info: 'Number: allowed +/- tolerance' },
    { label: 'ignore-case', info: 'Text: ignore letter casing when checking' },
    { label: 'ignore-whitespace', info: 'Text: ignore whitespace differences when checking' },
  ],
  'answer': [
    { label: 'correct', info: 'Mark as the correct answer' },
    { label: 'feedback', info: 'Feedback shown after answering' },
    { label: 'from', info: 'Range: threshold (0-1) this feedback band starts at' },
  ],
  'tabs-container': [
    { label: 'data-items', info: 'JSON array of tab labels, e.g. \'["Tab 1","Tab 2"]\'' },
  ],
  'tab-item': [],
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
    { label: 'thumbnail', info: 'Custom teaser image (uploaded filename or URL), overrides the YouTube thumbnail' },
  ],
  'stickme': [],
  'fullwidth': [],
  'mark': [],
  'style': [],
  'molecule': [
    { label: 'smiles', info: 'Molecule in SMILES notation (e.g. CCO ethanol, O water)' },
    { label: 'name', info: 'Caption below the drawing' },
    { label: 'width', info: 'Width in px (default: 420)' },
    { label: 'height', info: 'Height in px (default: 300)' },
    { label: 'display-width', info: 'Percent of the column' },
    { label: 'align', info: 'left | center | right' },
    { label: 'wrap', info: 'Float with text wrap (true)' },
  ],
  'geogebra': [
    { label: 'material-id', info: 'GeoGebra material id (from a geogebra.org share link)' },
    { label: 'height', info: 'Pin a fixed height in px (default: auto-fit)' },
    { label: 'width', info: 'Width' },
    { label: 'show-toolbar', info: 'Show the GeoGebra toolbar (true)' },
    { label: 'show-algebra-input', info: 'Show the algebra input bar (true)' },
    { label: 'correct-when', info: 'Captures per-student correctness for the teacher\'s class tally' },
  ],
  'spacer': [
    { label: 'pattern', info: 'checkered | lines | dots | blank' },
    { label: 'height', info: 'Height in px (e.g. 200)' },
    { label: 'id', info: 'Unique spacer ID' },
  ],
  'cta': [
    { label: 'href', info: 'Link target' },
    { label: 'label', info: 'Button text (alternative to children when self-closing)' },
    { label: 'variant', info: 'default | secondary | outline | ghost' },
    { label: 'size', info: 'lg | default | sm' },
    { label: 'align', info: 'center | left | right' },
    { label: 'external', info: 'Open in a new tab' },
  ],
  'newsletter': [
    { label: 'title', info: 'Heading text' },
    { label: 'description', info: 'Description text' },
    { label: 'button', info: 'Button text' },
    { label: 'list-id', info: 'Brevo list id' },
  ],
  'ai-feedback': [
    { label: 'prompt', info: 'Teacher instructions for the AI' },
    { label: 'id', info: 'Unique feedback instance ID (optional)' },
    { label: 'label', info: 'Button text (default: Check my solution)' },
  ],
  'ping': [
    { label: 'host', info: 'Auto-runs a demo ping to this host' },
    { label: 'count', info: 'Ping count (e.g. 4)' },
    { label: 'os', info: 'linux | macos | windows' },
  ],
  'next-stage': [
    { label: 'label', info: 'Advance/confirm button text' },
    { label: 'title', info: 'Confirm modal heading' },
    { label: 'confirm', info: 'Confirm modal body text' },
    { label: 'cancel', info: 'Cancel button text' },
  ],
  'muxvideo': [
    { label: 'src', info: 'Video filename' },
    { label: 'gif', info: 'Muted autoplay loop, GIF-style' },
    { label: 'autoplay', info: 'Autoplay (muted)' },
    { label: 'loop', info: 'Loop playback' },
    { label: 'pin', info: 'Corner overlay when scrolled past' },
    { label: 'poster', info: 'Poster image filename' },
    { label: 'alt', info: 'Caption text' },
  ],
  'left': [],
  'center': [],
  'right': [],
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
  'type': ['single', 'multiple', 'text', 'number', 'range'],
  'grow': ['true', 'false'],
  'class': ['invert-dark'],
  'pattern': ['checkered', 'lines', 'dots', 'blank'],
  'variant': ['default', 'secondary', 'outline', 'ghost'],
  'size': ['lg', 'default', 'sm'],
  'os': ['linux', 'macos', 'windows'],
}

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
