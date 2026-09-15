/**
 * Markdown autocompletion for the dashboard editor.
 *
 * Provides contextual suggestions for:
 * 1. Custom HTML tags (on `<`)
 * 2. Tag-specific attributes (inside an open tag)
 * 3. Known attribute values (inside quotes)
 * 4. Callout types (after `> [!`)
 * 5. Code-fence info strings (```python editor id="…" …, ```plot, ```python-check for="…")
 * 6. ```plot body keywords (settings at line start, curve options after a comma)
 * 7. Ctrl+Space on plain text: every tag plus block snippets
 * PhET sim slugs inside `<phet sim="…">` come from the async phetSimCompletions.
 *
 * Keep this in sync with src/lib/ai/syntax-reference.ts — that file is the
 * canonical list of supported components/attributes.
 */

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete'
import { startCompletion } from '@codemirror/autocomplete'
import { calloutTypes } from '@/lib/remark-plugins/callouts'
import { phetTitle, searchPhetSims, type PhetSimSummary } from '@/lib/phet'

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
  { label: 'pricing', info: 'Public price table with live plan prices', apply: '<pricing lang="de" />' },
  { label: 'phet', info: 'Embed a PhET simulation (Insert → PhET to browse)', apply: '<phet sim="" locale="de" />', cursorOffset: 11 },
  { label: 'spacer', info: 'Blank writing area for students to solve on by hand', apply: '<spacer pattern="checkered" height="200" />' },
  { label: 'cta', info: 'Call-to-action link styled as a button', apply: '<cta href="">Text</cta>', cursorOffset: 11 },
  { label: 'newsletter', info: 'Email signup box (Brevo list)', apply: '<newsletter />' },
  { label: 'banner', info: 'Sticky announcement bar at the top of the page', apply: '<banner>\n\n</banner>' },
  { label: 'ai-feedback', info: 'Button: send pen strokes/section content to a vision model for feedback', apply: '<ai-feedback prompt="" />', cursorOffset: 21 },
  { label: 'ping', info: 'Interactive ping terminal', apply: '<ping />' },
  { label: 'next-stage', info: 'One-way divider that hands in the previous stage and reveals the next', apply: '<next-stage label="" />', cursorOffset: 19 },
  { label: 'muxvideo', info: 'Mux video with playback options (gif, autoplay, loop, pin, poster)', apply: '<muxvideo src="" />', cursorOffset: 15 },
  { label: 'left', info: 'Left-align block content', apply: '<left>\n\n</left>' },
  { label: 'center', info: 'Center-align block content', apply: '<center>\n\n</center>' },
  { label: 'right', info: 'Right-align block content', apply: '<right>\n\n</right>' },
  { label: 'onlyfor', info: 'Show content only to an audience: auth | anon | students | class="3a"', apply: '<onlyfor students>\n\n</onlyfor>' },
  { label: 'audio', info: 'Audio player for an uploaded file', apply: '<audio controls src=""></audio>', cursorOffset: 21 },
  { label: 'iframe', info: 'Raw embed (sandboxed automatically)', apply: '<iframe src="" width="100%" height="400"></iframe>', cursorOffset: 13 },
  { label: 'nobr', info: 'Keep the wrapped words on one line', apply: '<nobr></nobr>', cursorOffset: 6 },
  { label: 'u', info: 'Underlined text', apply: '<u></u>', cursorOffset: 3 },
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
    { label: 'inline', info: 'Render inline in the text flow (true)' },
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
    { label: 'lightonly', info: 'Always show the light theme, ignore viewer theme (true)' },
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
  ],
  'question': [
    { label: 'id', info: 'Unique question ID' },
    { label: 'type', info: 'single | multiple | text | number | range (default: multiple)' },
    { label: 'feedback', info: 'check (Check button, default) | instant (on every change) | none (silent poll). Ignored on exam pages' },
    { label: 'attempts', info: 'Check mode: presses before the question locks (default 1), or "unlimited"' },
    { label: 'showFeedback', info: 'Legacy: "true" = feedback="instant", "false" = feedback="none"' },
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
    { label: 'gate-at', info: 'Staged page: points needed before the next stage unlocks' },
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
    { label: 'pin', info: 'Corner overlay when scrolled past (true)' },
  ],
  'stickme': [
    { label: 'id', info: 'Keys the saved size' },
  ],
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
  'pricing': [
    { label: 'lang', info: 'de | en (default en)' },
    { label: 'signup', info: 'CTA target (default /auth/signup)' },
  ],
  'phet': [
    { label: 'sim', info: 'PhET sim slug, e.g. projectile-motion (from phet.colorado.edu/…/simulations/<slug>)' },
    { label: 'locale', info: 'Sim language: de | en | fr | it | … (untranslated sims fall back to English)' },
    { label: 'height', info: 'Pin a fixed height in px (default: PhET 1024×618 ratio)' },
    { label: 'title', info: 'Accessible iframe title' },
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
    { label: 'font', info: 'heading | body' },
    { label: 'weight', info: 'normal | medium | semibold | bold' },
    { label: 'fontsize', info: 'sm | base | lg | xl | 2xl | 3xl or a CSS length (1.4rem)' },
    { label: 'note', info: 'Small muted text under the button' },
    { label: 'notehref', info: 'Link target for the note (e.g. #pricing)' },
  ],
  'banner': [
    { label: 'id', info: 'Keys the per-browser dismiss state (default: text hash)' },
    { label: 'dismissible', info: 'false hides the close button' },
    { label: 'color', info: 'Background: palette name (paper|muted|yellow|green|blue|pink|orange|red|purple, theme-aware) or CSS color' },
    { label: 'text', info: 'Text: palette name (text = normal text color, red|blue|green|…, theme-aware) or CSS color' },
  ],
  'newsletter': [
    { label: 'title', info: 'Heading text' },
    { label: 'description', info: 'Description text' },
    { label: 'button', info: 'Button text' },
    { label: 'list-id', info: 'Brevo list id' },
  ],
  'ai-feedback': [
    { label: 'prompt', info: 'Teacher instructions for the AI' },
    { label: 'solution', info: 'Hidden reference: Excalidraw drawing name or image file the AI compares against' },
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
  'onlyfor': [
    { label: 'auth', info: 'Any signed-in user' },
    { label: 'anon', info: 'Only signed-out viewers' },
    { label: 'students', info: 'Your students (any class)' },
    { label: 'class', info: 'Students of one class (name or invite code)' },
    { label: 'prompt', info: 'Text shown to everyone else' },
  ],
  'audio': [
    { label: 'src', info: 'Audio filename' },
    { label: 'controls', info: 'Show the player controls' },
    { label: 'loop', info: 'Loop playback' },
    { label: 'preload', info: 'none | metadata | auto' },
  ],
  'iframe': [
    { label: 'src', info: 'Embed URL' },
    { label: 'width', info: 'Width (e.g. 100%)' },
    { label: 'height', info: 'Height in px' },
    { label: 'title', info: 'Accessible title' },
    { label: 'loading', info: 'lazy | eager' },
    { label: 'allowfullscreen', info: 'Allow fullscreen' },
  ],
  'nobr': [],
  'u': [],
}

// ── Per-plugin attribute definitions (keyed by plugin slug) ─────────
// These attrs are merged in addition to the generic `plugin` attrs above
// when the slug part of the current `<plugin src="owner/slug">` matches.
// Keyed by slug, not owner/slug: the built-in owner differs per deployment
// (BUILTIN_PLUGIN_OWNER, e.g. `informatikgarten` in prod, `eduadmin` locally),
// and forks keep the slug. A user plugin that reuses a built-in slug gets
// these suggestions too.
const PLUGIN_SRC_ATTRS: Record<string, AttrDef[]> = {
  'dijkstra-visualizer': [
    { label: 'initialnodecount', info: 'Initial node count (3..200, default 7)' },
    { label: 'initialdirected', info: 'Start in directed mode (true | false)' },
    { label: 'initialspeed', info: 'Animation speed 100..2000, higher = faster (default 1300)' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'mod-calc': [
    { label: 'formula', info: 'Initial formula' },
    { label: 'base', info: 'Initial base' },
    { label: 'exp', info: 'Initial exponent' },
    { label: 'mod', info: 'Initial modulus' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'cipher-lab': [
    { label: 'cipher', info: 'Initial cipher (e.g. caesar, vigenere)' },
    { label: 'cipherkey', info: 'Initial cipher key' },
    { label: 'text', info: 'Initial plaintext' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'mod-clock': [
    { label: 'mod', info: 'Initial modulus' },
    { label: 'modmax', info: 'Modulus slider max' },
    { label: 'max', info: 'Counter max' },
    { label: 'font', info: 'Custom font' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'diffie-hellman': [
    { label: 'p', info: 'Prime modulus' },
    { label: 'g', info: 'Generator' },
    { label: 'a', info: 'Alice secret' },
    { label: 'b', info: 'Bob secret' },
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'data-cube-visualizer': [
    { label: 'lang', info: 'UI language (en | de)' },
  ],
  'inclined-plane': [
    { label: 'scenario', info: 'Initial tab: endless | slide | sled | lift | pulley' },
    { label: 'tabs', info: '"false" hides the scenario tab bar' },
    { label: 'lang', info: 'UI language (en | de)' },
    { label: 'alpha', info: 'Start angle in degrees; above arctan(μs) the block slides on load' },
    { label: 'mus', info: 'Static friction coefficient μs / μ_H (alias: muh)' },
    { label: 'muk', info: 'Kinetic friction coefficient μk / μ_G (alias: mug)' },
    { label: 'm', info: 'Mass in kg (m₁ in the pulley scenario)' },
    { label: 'm2', info: 'Counterweight mass in kg (pulley scenario)' },
    { label: 'vlift', info: 'Lift speed in m/s (lift scenario)' },
    { label: 'beta', info: 'Rope angle in degrees (lift scenario)' },
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
  'scenario': ['endless', 'slide', 'sled', 'lift', 'pulley'],
  'lang': ['de', 'en'],
  'preload': ['none', 'metadata', 'auto'],
  'loading': ['lazy', 'eager'],
}

/**
 * Values that only make sense on one tag. Checked before ATTR_VALUES, so the
 * same attribute name can mean different things (flex align vs img align,
 * question feedback vs answer feedback text). An empty list = free text.
 */
const TAG_ATTR_VALUES: Record<string, Record<string, string[]>> = {
  'flex': {
    'align': ['start', 'center', 'end', 'stretch', 'baseline'],
    'wrap': ['true', 'false'],
  },
  'question': {
    'feedback': ['check', 'instant', 'none'],
    'attempts': ['1', '2', '3', 'unlimited'],
  },
  'answer': {
    'feedback': [],
    'correct': ['true'],
  },
  'cta': {
    'font': ['heading', 'body'],
    'weight': ['normal', 'medium', 'semibold', 'bold'],
    'fontsize': ['sm', 'base', 'lg', 'xl', '2xl', '3xl'],
    'external': ['true', 'false'],
  },
  'phet': {
    'locale': ['de', 'en', 'fr', 'it'],
  },
  'banner': {
    'color': ['paper', 'muted', 'yellow', 'green', 'blue', 'pink', 'orange', 'red', 'purple'],
    'text': ['text', 'red', 'blue', 'green', 'orange', 'purple'],
    'dismissible': ['false'],
  },
  'excali': { 'lightonly': ['true'] },
  'geogebra': { 'show-toolbar': ['true'], 'show-algebra-input': ['true'] },
  'youtube': { 'pin': ['true'] },
  'img': { 'inline': ['true'] },
}

// ── Code fences ──────────────────────────────────────────────────────

const RUNNABLE_LANGS = ['python', 'javascript', 'sql', 'html']

/** What may follow ``` — runnable editors first, then the special fences. */
const FENCE_KINDS: Completion[] = [
  ...RUNNABLE_LANGS.map((lang) => ({ label: `${lang} editor`, type: 'keyword', info: `Runnable ${lang} editor`, boost: 2 })),
  { label: 'python-check', type: 'keyword', info: 'Hidden asserts for a python editor: python-check for="id"', apply: 'python-check for=""', boost: 1 },
  { label: 'plot', type: 'keyword', info: 'Function plot from one entry per line', boost: 1 },
  { label: 'mermaid', type: 'keyword', info: 'Mermaid diagram', boost: 1 },
  { label: 'expected', type: 'keyword', info: 'Expected output inside a <question type="text">' },
  ...['python', 'javascript', 'typescript', 'sql', 'html', 'css', 'json', 'yaml', 'java', 'cpp', 'rust', 'go', 'php', 'bash', 'markdown']
    .map((lang) => ({ label: lang, type: 'keyword', info: 'Syntax highlighting only' })),
]

const EDITOR_FLAGS: AttrDef[] = [
  { label: 'editor', info: 'Make the block runnable' },
  { label: 'id', info: 'Editor id (pair with python-check for="…")' },
  { label: 'single', info: 'Hide the file tabs' },
  { label: 'exam', info: 'Silent grading with python-check' },
  { label: 'output-only', info: 'Run on load, show only the output' },
  { label: 'file', info: 'Tab name; repeat the fence with the same id for more files' },
  { label: 'height', info: 'Editor height in px' },
  { label: 'assets', info: 'Read-only files for the code (a.csv,b.png)' },
  { label: 'allow-upload', info: 'Students may upload their own files' },
  { label: 'accept', info: 'Allowed upload types (e.g. .csv)' },
]
const SQL_FLAGS: AttrDef[] = [
  { label: 'db', info: 'SQLite file' },
  { label: 'solution', info: 'Expected query — pass/fail after each run' },
  { label: 'schema-image', info: 'Override the generated ER diagram' },
]
const CODE_BLOCK_FLAGS: AttrDef[] = [
  { label: 'copy=false', info: 'Hide the copy button' },
]
const PYTHON_CHECK_FLAGS: AttrDef[] = [
  { label: 'for', info: 'Id of the python editor to check (required)' },
  { label: 'points', info: 'Points for passing all asserts' },
  { label: 'max-checks', info: 'Limit Check presses' },
  { label: 'gate-at', info: 'Stage: points needed to unlock the next stage' },
  { label: 'label', info: 'Stage label' },
]
/** Flags written bare (no ="…"). */
const BARE_FLAGS = new Set(['editor', 'single', 'exam', 'output-only', 'allow-upload', 'copy=false'])

/** ```plot settings and entries, offered at the start of a line. */
const PLOT_LINES: Completion[] = [
  { label: 'x: -5..5', type: 'keyword', info: 'x window' },
  { label: 'y: -5..5', type: 'keyword', info: 'y window (optional)' },
  { label: 'grid', type: 'keyword', info: 'Grid lines' },
  { label: 'nogrid', type: 'keyword', info: 'No grid' },
  { label: 'caption: ', type: 'keyword', info: 'Caption under the plot' },
  { label: 'aspect: equal', type: 'keyword', info: 'Same scale on both axes' },
  { label: 'size: 640x400', type: 'keyword', info: 'Size in px' },
  { label: 'axes: off', type: 'keyword', info: 'Hide the axes' },
  { label: 'legend: off', type: 'keyword', info: 'Hide the legend' },
  { label: 'f(x) = ', type: 'function', info: 'Curve (up to 8)' },
  { label: 'A = (1, 2)', type: 'variable', info: 'Point' },
  { label: 'vline x=', type: 'keyword', info: 'Vertical guide' },
  { label: 'hline y=', type: 'keyword', info: 'Horizontal guide' },
]
/** ```plot options after a comma: `f(x) = x^2, red, dashed, label="…"`. */
const PLOT_OPTIONS: Completion[] = [
  ...['red', 'blue', 'green', 'orange', 'purple', 'teal', 'pink', 'brown', 'gray', 'black']
    .map((c) => ({ label: c, type: 'constant', info: 'Colour' })),
  { label: 'dashed', type: 'keyword' },
  { label: 'dotted', type: 'keyword' },
  { label: 'thick', type: 'keyword' },
  { label: 'label=""', type: 'property', info: 'Legend/point label' },
]

/** Block snippets for Ctrl+Space at the start of an empty line. */
const BLOCK_SNIPPETS: Completion[] = [
  { label: '```python editor', type: 'keyword', info: 'Runnable Python', apply: '```python editor\n\n```' },
  { label: '```sql editor', type: 'keyword', info: 'Runnable SQL on an uploaded database', apply: '```sql editor db=""\n\n```' },
  { label: '```html editor', type: 'keyword', info: 'HTML with live preview', apply: '```html editor\n\n```' },
  { label: '```plot', type: 'keyword', info: 'Function plot', apply: '```plot\nx: -5..5\ngrid\nf(x) = x^2\n```' },
  { label: '```mermaid', type: 'keyword', info: 'Diagram from text', apply: '```mermaid\nflowchart TD\n    A --> B\n```' },
  { label: '> [!note]', type: 'keyword', info: 'Callout', apply: '> [!note] ' },
  { label: '$$', type: 'keyword', info: 'Display math', apply: '$$\n\n$$' },
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

  // 5. Code-fence info string: ```lang flags…
  const fenceLine = textBefore.match(/^\s*```(.*)$/)
  if (fenceLine && !/([\w-]+)="([^"]*)$/.test(textBefore)) {
    return fenceInfoCompletions(context, fenceLine[1])
  }

  // 6. Inside a ```plot body
  const fence = openFenceAt(context.state.doc.sliceString(0, line.from))
  if (fence !== null) {
    return fence === 'plot' ? plotCompletions(context, textBefore) : null
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

    // python-check for="…": the ids of python editors on this page
    if (attrName === 'for' && /^\s*```python-check\b/.test(textBefore)) {
      const ids = [...context.state.doc.toString().matchAll(/^\s*```python\b[^\n]*\bid="([^"]+)"/gm)].map(m => m[1])
      if (ids.length === 0) return null
      return {
        from: context.pos - valueMatch[2].length,
        options: [...new Set(ids)].map(id => ({ label: id, type: 'variable' })),
        validFor: /^[^"]*$/,
      }
    }

    const tagName = findOpenTag(context.state.doc.sliceString(0, context.pos))
    const scoped = tagName ? TAG_ATTR_VALUES[tagName]?.[attrName] : undefined
    const values = scoped ?? ATTR_VALUES[attrName]
    if (values && values.length > 0) {
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
  if (tagContext && /\s[\w-]*$/.test(textBefore)) {
    const attrMatch = textBefore.match(/\s([\w-]*)$/)
    if (attrMatch) {
      const tagAttrs = TAG_ATTRS[tagContext] || []
      // Merge plugin-source-specific attrs when inside a <plugin src="…">
      const pluginAttrs = tagContext === 'plugin'
        ? (PLUGIN_SRC_ATTRS[(findPluginSrc(fullTextBefore) || '').split('/').pop() || ''] || [])
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
        validFor: /^[\w-]*$/,
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

  // 7. Ctrl+Space on plain text: every tag (with its `<`) and, at the start
  // of a line, the block snippets.
  if (context.explicit && !tagContext) {
    const word = textBefore.match(/(?:^|\s)(\w*)$/)
    if (word) {
      const atLineStart = textBefore.trim() === word[1]
      const tags: Completion[] = TAG_COMPLETIONS.map(t => ({
        label: `<${t.label}>`,
        type: 'type',
        info: t.info,
        apply: t.cursorOffset != null
          ? (view: import('@codemirror/view').EditorView, _c: Completion, from: number, to: number) => {
              view.dispatch({ changes: { from, to, insert: t.apply }, selection: { anchor: from + t.cursorOffset! } })
              startCompletion(view)
            }
          : t.apply,
      }))
      return {
        from: context.pos - word[1].length,
        options: atLineStart ? [...BLOCK_SNIPPETS, ...tags] : tags,
        validFor: /^\w*$/,
      }
    }
  }

  return null
  }
}

/** Completions on a ``` line: the fence kind, then the flags it accepts. */
function fenceInfoCompletions(context: CompletionContext, info: string): CompletionResult | null {
  // Still typing the language: ```pyt|
  const kind = info.match(/^([\w-]*)$/)
  if (kind) {
    return { from: context.pos - kind[1].length, options: FENCE_KINDS, validFor: /^[\w-]*$/ }
  }
  const lang = info.split(/\s+/)[0]
  const flag = info.match(/\s([\w-]*)$/)
  if (!flag) return null

  let flags: AttrDef[]
  if (lang === 'python-check') flags = PYTHON_CHECK_FLAGS
  else if (RUNNABLE_LANGS.includes(lang) || lang === 'js') {
    // assets / allow-upload / accept are Python-only; SQL's own flags first.
    const pythonOnly = new Set(['assets', 'allow-upload', 'accept'])
    flags = /\beditor\b/.test(info)
      ? [
          ...(lang === 'sql' ? SQL_FLAGS : []),
          ...EDITOR_FLAGS.filter(f => f.label !== 'editor' && (lang === 'python' || !pythonOnly.has(f.label))),
        ]
      : [EDITOR_FLAGS[0], ...CODE_BLOCK_FLAGS]
  } else if (lang === 'plot' || lang === 'mermaid' || lang === 'expected') return null
  else flags = CODE_BLOCK_FLAGS

  // Don't offer what's already on the line.
  const present = new Set([...info.matchAll(/([\w-]+)(?:=|\s|$)/g)].map(m => m[1]))
  return {
    from: context.pos - flag[1].length,
    options: flags.filter(f => !present.has(f.label.split('=')[0])).map((f, i) => ({
      label: f.label,
      boost: -i, // keep the list order above instead of alphabetical
      type: 'property',
      info: f.info,
      apply: BARE_FLAGS.has(f.label)
        ? f.label
        : (view: import('@codemirror/view').EditorView, _c: Completion, from: number, to: number) => {
            view.dispatch({ changes: { from, to, insert: `${f.label}=""` }, selection: { anchor: from + f.label.length + 2 } })
            startCompletion(view)
          },
    })),
    validFor: /^[\w-]*$/,
  }
}

/** Plot body: settings/entries at the start of a line, options after a comma. */
function plotCompletions(context: CompletionContext, textBefore: string): CompletionResult | null {
  const opt = textBefore.match(/,\s*(\w*)$/)
  if (opt) return { from: context.pos - opt[1].length, options: PLOT_OPTIONS, validFor: /^\w*$/ }
  const start = textBefore.match(/^\s*(\w*)$/)
  if (start && (start[1] || context.explicit)) {
    return { from: context.pos - start[1].length, options: PLOT_LINES, validFor: /^\w*$/ }
  }
  return null
}

/**
 * The info word of the code fence the text ends inside (```plot → 'plot',
 * bare ``` → ''), or null when outside any fence.
 */
function openFenceAt(textBeforeLine: string): string | null {
  let open: string | null = null
  for (const m of textBeforeLine.matchAll(/^\s*(```+|~~~+)\s*([\w-]*)/gm)) {
    open = open === null ? m[2] : null
  }
  return open
}

// ── PhET sim completions ─────────────────────────────────────────────

let phetSims: Promise<PhetSimSummary[]> | null = null

/**
 * Async source: inside `<phet sim="…">` suggest sims. Uses the picker's
 * search (slug, titles and descriptions in de/en/fr/it) instead of
 * CodeMirror's fuzzy match on the label, so "wurf" finds Projektilbewegung
 * via its description. Loads /api/phet/sims once per session.
 */
export async function phetSimCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const line = context.state.doc.lineAt(context.pos)
  const textBefore = line.text.slice(0, context.pos - line.from)
  const m = textBefore.match(/<phet\b[^>]*\bsim="([^"]*)$/)
  if (!m) return null

  phetSims ??= fetch('/api/phet/sims')
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((json: { sims: PhetSimSummary[] }) => json.sims)
    .catch(() => { phetSims = null; return [] })
  const hits = searchPhetSims(await phetSims, m[1])
  if (hits.length === 0) return null

  return {
    from: context.pos - m[1].length,
    filter: false,
    options: hits.map(s => ({ label: phetTitle(s, 'de'), detail: s.sim, type: 'variable', apply: s.sim })),
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
