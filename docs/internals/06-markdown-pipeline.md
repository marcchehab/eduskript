# Markdown Pipeline

Markdown rendering goes through the React processor below. `src/lib/markdown.ts` is a separate *utility* module — not a processor.

1. **Markdown processor** (`src/components/markdown/markdown-renderer.client.tsx`,
   with a `markdown-renderer.server.tsx` SSR variant)
   - **Used by**: Public pages, dashboard, interactive preview
   - **Output**: React components via `rehype-react`
   - **When to modify**: For all remark/rehype plugin additions

2. **Markdown utilities** (`src/lib/markdown.ts`)
   - Not a processor — small helpers used by API routes/services:
     `generateSlug`, `generateExcerpt`, `isReservedSlug`, `validateMarkdown`

## Primary Processor Architecture

**File:** `src/components/markdown/markdown-renderer.tsx`

**Processing Flow:**
- Entry point: React component renders markdown via `unified()` pipeline
- Transforms: Markdown String → MDAST → HAST → React JSX
- Uses `rehype-react` to convert HTML AST to React components
- Renders directly as React JSX (no HTML string intermediate)
- Custom components: `<CodeMirrorCodeBlock>`, `<ImageWithResize>`, `<Heading>`, etc.

**Used By:**
- `src/app/[domain]/[collectionSlug]/[skriptSlug]/[pageSlug]/page.tsx` - Public pages
- `src/components/public/annotatable-content.tsx` - Annotatable content
- `src/components/dashboard/interactive-preview.tsx` - Dashboard preview

## Markdown utilities (`src/lib/markdown.ts`)

Not a markdown *processor* — a small utility module. Exports:
- `generateSlug(title)` / `isReservedSlug(slug)` — URL slug generation + reserved-word guard
- `generateExcerpt(content)` — plain-text excerpt for previews/SEO
- `validateMarkdown(content)` — lightweight content validation

Used by API routes and `src/lib/services/{skripts,pages}.ts`.

## Plugin Execution Order

The markdown transformation follows this **exact plugin order** (critical for proper rendering):

### Remark Plugins (Operate on Markdown AST)

1. **`remarkParse`** - Parse markdown string into MDAST (Markdown Abstract Syntax Tree)

2. **`remarkImageResolver`** (`src/lib/remark-plugins/image-resolver.ts`)
   - **Hybrid plugin**: Queries DB on server (skriptId), uses fileList on client
   - Resolves relative image paths to `/api/files/{id}` URLs
   - Skips absolute URLs, .excalidraw files, and video files (handled by other plugins)
   - Sets `data-original-src` attribute for reference

3. **`remarkExcalidraw`** (`src/lib/remark-plugins/excalidraw.ts`)
   - **Hybrid plugin**: Queries DB on server (skriptId), uses fileList on client
   - Handles `.excalidraw` files by finding light/dark SVG variants
   - Sets `data-light-src`, `data-dark-src`, `data-excalidraw` attributes
   - Falls back to `/missing-file/` URL with `?missing=` query param if variants not found

4. **`remarkMuxVideo`** (`src/lib/remark-plugins/mux-video.ts`)
   - **Hybrid plugin**: Queries DB on server (skriptId), uses fileList on client
   - Transforms `.mp4`/`.mov` references to Mux video components
   - Looks up `{video}.json` metadata file for playback ID, poster, blur data
   - Creates custom `<muxvideo>` element with Mux-specific data attributes

5. **`remarkCodeEditor`** (`src/lib/remark-plugins/code-editor.ts`)
   - Converts code blocks with `editor` keyword to interactive editors
   - Syntax: ` ```python editor``` ` or ` ```sql editor db="database.db"``` `
   - Transforms to custom `<code-editor>` element with `data-*` attributes
   - Supports multi-file syntax, IDs, and database references

6. **`remarkCallouts`** (`src/lib/remark-plugins/callouts.ts`)
   - Transforms Obsidian-style callouts: `> [!type]` syntax
   - **41 callout types** with aliases:
     - Base types: note, tip, warning, abstract, info, todo, success, question, failure, danger, bug, example, quote, solution, discuss
     - Aliases: `lernziele`→`success`, `hint`→`tip`, `exercise`→`abstract`, etc.
   - Foldable syntax: `> [!note]-` (folded) or `> [!note]+` (open)
   - Generates structure:
     ```html
     <blockquote class="callout callout-{type} [callout-foldable] [callout-folded]">
       <div class="callout-title {type}"></div>
       <div class="callout-content">...</div>
     </blockquote>
     ```

7. **`remarkMath`** - Parse LaTeX math (`$...$` or `$$...$$`)

8. **`remarkGfm`** - GitHub-Flavored Markdown (tables, strikethrough, task lists)

9. **`remarkServerImageOptimizer`** (Server-only, dynamically added)
   - Downloads remote images and caches in `/public/cache/images/[domain]/[skriptId]/`
   - Only runs in Node.js environment

### Rehype Plugins (Operate on HTML AST)

1. **`remarkRehype`** - Convert MDAST → HAST (HTML AST)
   - `allowDangerousHtml: true` preserves custom elements

2. **`rehypeSlug`** - Add IDs to headings
   - `# My Heading` → `<h1 id="my-heading">My Heading</h1>`

3. **`rehypeHeadingSectionIds`** (`src/lib/rehype-plugins/heading-section-ids.ts`)
   - Adds `data-section-id` (e.g., "h1-my-heading")
   - Adds `data-heading-text` (extracted text content)
   - Used by annotation system for precise targeting

4. **`rehypeAutolinkHeadings`** - Add anchor links to headings
   - Creates `<a class="heading-link" href="#...">` inside headings
   - `behavior: 'wrap'` wraps entire heading content

5. **`rehypeExcalidrawDualImage`** (`src/lib/rehype-plugins/excalidraw-dual-image.ts`)
   - Handles theme-aware Excalidraw drawings
   - Wraps in `<figure>` with both light/dark SVG variants
   - CSS shows appropriate variant based on theme class

6. **`rehypeImageOptimizer`** (`src/lib/rehype-plugins/image-optimizer.ts`)
   - Adds `loading="lazy"` and `decoding="async"` to all images

7. **`rehypeKatex`** - Process LaTeX math to HTML

8. **`rehypeHighlight`** - Syntax highlighting (non-editor code blocks only)

9. **`rehypeStringify`** - Convert HAST → HTML string
   - `allowDangerousHtml: true` preserves custom elements

## Client-Side Hydration

After server-side processing, the client performs selective hydration:

1. **Code Editors**: Finds `<code-editor>` custom elements, extracts `data-*` attributes, looks up DB file URL via fileList, mounts React `<CodeEditor>` in place.

2. **Callout Interactivity**: Finds `blockquote.callout-foldable`, attaches click handlers that toggle `.callout-folded`.

3. **Theme Updates**: Re-renders all code editors when theme changes, preserving user state.

## Markdown Context

The `MarkdownContext` object flows through the pipeline:

```typescript
interface MarkdownContext {
  pageId?: string              // For user data persistence
  domain?: string              // Username for file resolution
  skriptId?: string            // For file API lookups
  fileList?: Array<{           // Pre-fetched files for this skript
    id: string
    name: string
    url?: string
    isDirectory?: boolean
  }>
  theme?: 'light' | 'dark'     // For Excalidraw theme selection
}
```

**File List Usage:**
1. Server: Passed to `remarkImageResolver` and other file-resolving plugins
2. Client: Fetched via `/api/upload?skriptId={id}` during hydration
3. Used to resolve filenames → URLs for images and databases

## Key Design Patterns

1. **Data Attributes for Hydration** — plugins store metadata in `node.data.hProperties` (becomes HTML attributes); client reads via `getAttribute()` / `querySelectorAll()`.

2. **HTML Entity Escaping** — code content escaped to prevent XSS; client decodes via textarea trick.

3. **Lazy Hydration** — full HTML rendered immediately; React components only loaded for interactive elements.

4. **Theme-Aware Rendering** — Excalidraw light/dark variants both in DOM, CSS controls visibility; code editors re-render on theme change.

5. **Plugin Composition** — single responsibility per plugin; order matters (file resolution before image processing).

## Custom container tags (blank-line independence)

Author-written container tags (`<flex>/<flex-item>`, `<tabs-container>/<tab-item>`,
`<fullwidth>`, `<stickme>`, `<left>/<center>/<right>`, `<question>/<answer>`) are raw HTML,
so CommonMark's blank-line HTML-block rules would otherwise make them fragile (inner markdown
not rendered without blank lines; structure breaking). Two mechanisms make them robust:

- **`rehype-plugins/markdown-children.ts`** (`rehypeMarkdownChildren`) runs after `rehype-raw`
  (and **before** `rehypeAlignTags`) and re-parses the literal-text children of registered
  containers as markdown. Registry: `stickme, tab-item, flex-item, fullwidth, left, center,
  right`. It only touches `text` children, so content already parsed via blank lines is left
  alone (blank / no-blank input converge). Nested containers are resolved by walking the
  freshly-parsed subtree, capped by `MAX_REPARSE_GENERATIONS`. Pure wrappers (`flex`,
  `tabs-container`, `survey`) are NOT registered — their content lives in the inner tags.

- **`markdown-compiler.ts` → `normalizeQuestionSpacing`** (a pre-parse string pass alongside
  `expandSelfClosingTags`) collapses blank lines adjacent to `<answer>`/`</question>` tags.
  This keeps `<answer>` as **direct children** of `<question>` (a blank line before an answer
  makes CommonMark wrap the run in a `<p>`, detaching the options and rendering an empty quiz).
  It deliberately leaves prompt-text and ```` ```expected ```` fence spacing untouched.

Quiz option indices are **dense element-only** positions (0,1,2,…): `extractOptionsInfo` and the
render map in `components/markdown/quiz.tsx` count only `<answer>` elements, skipping the prompt
text and inter-answer whitespace text nodes.

## GFM footnotes

Footnotes come from `remarkGfm` + `remark-rehype`'s footnote handler. Two things
make them work here:

- **Anchor/backref links** — `remark-rehype` prefixes footnote ids *and* their
  matching `#…` hrefs with `user-content-` (e.g. `id="user-content-fn-x"` ↔
  `href="#user-content-fn-x"`). `rehype-sanitize`'s `defaultSchema` ALSO has
  `clobberPrefix: 'user-content-'` and clobbers `id`, so it re-prefixes only the
  `id` (not the href fragment) → `user-content-user-content-fn-x`, and every
  footnote jump (forward and backref) lands nowhere. Fix: `sanitizeSchema` sets
  `clobberPrefix: ''` so sanitize leaves the already-namespaced ids alone. See
  `markdown-compiler.ts`.
- **Visible, localized heading** — `remark-rehype` defaults to a `sr-only`
  "Footnotes" `<h2>`. We pass `footnoteLabelProperties: {}` (drops `sr-only`,
  making it visible) and `footnoteLabel` from `footnoteLabelForLang(pageLanguage)`
  (de → "Fussnoten", fr/it variants, else "Footnotes"). `pageLanguage` is the
  site-level language, threaded from the page routes through
  `ServerMarkdownRenderer` / `MarkdownRenderer`. Styling lives in `globals.css`
  under `.prose-theme .footnotes`.

## Debugging Tips

**Plugin not running:** check TypeScript types (especially `tree: Root` parameter). Add `console.log()` to verify execution.

**Wrong output:** plugin order matters. File resolver must run before image processing.

**Hydration fails:** custom element attributes missing or HTML entities not decoded.

**Theme not switching:** CSS classes not applied or images not duplicated.
