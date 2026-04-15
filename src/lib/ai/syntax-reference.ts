/**
 * Auto-generated syntax reference for the AI assistant.
 * Pulls from actual plugin implementations to stay in sync.
 */

import { calloutTypes } from '@/lib/remark-plugins/callouts'

/**
 * pageSlug of the user that owns the built-in plugins (mod-calc, cipher-lab, etc.).
 * Configurable via BUILTIN_PLUGIN_OWNER env var; defaults to "eduadmin",
 * which is autoseeded on every deployment.
 */
const BUILTIN_PLUGIN_OWNER = process.env.BUILTIN_PLUGIN_OWNER || 'eduadmin'

/**
 * Generates markdown syntax documentation for the AI assistant.
 * This ensures the AI always knows about current supported features.
 */
export function generateSyntaxReference(): string {
  const sections: string[] = []

  // General rules
  sections.push(`## HTML Component Rules

All custom tags and attributes must be **lowercase** with **string values**. This is not MDX — no PascalCase tags or JSX expressions.

**Self-closing tags** are supported and preferred for components without children: \`<plugin src="eduadmin/mod-calc" />\`. Do NOT expand them to open+close pairs.

**Correct:**
\`\`\`html
<plugin src="eduadmin/mod-calc" formula="rsa-enc" />
<plugin src="eduadmin/color-sliders" />
<question id="q1" type="single">...</question>
\`\`\`

**Wrong:**
\`\`\`html
<Question id="q1" type="single">          <!-- PascalCase tag -->
<plugin src="eduadmin/mod-calc" formula={rsa}>  <!-- JSX expression -->
\`\`\``)

  // Callouts
  const baseTypes = Object.entries(calloutTypes)
    .filter(([key, value]) => key === value)
    .map(([key]) => key)

  const aliases = Object.entries(calloutTypes)
    .filter(([key, value]) => key !== value)
    .map(([alias, base]) => `${alias} → ${base}`)

  sections.push(`## Callouts (Obsidian-style)

**CRITICAL SYNTAX:** The title MUST be on the SAME LINE as \`[!type]\`. Never put the title on a new line.

Syntax: \`> [!type] Title text here\` (title on same line!)
Collapsible: \`> [!type]- Title\` (closed) or \`> [!type]+ Title\` (open)

**Base types:** ${baseTypes.join(', ')}

**Aliases:** ${aliases.join(', ')}

**CORRECT examples:**
\`\`\`markdown
> [!tip] Pro Tip
> This is helpful information.

> [!warning] Wichtiger Hinweis
> Be careful with this.

> [!lernziele] Lernziele
> - Objective 1
> - Objective 2

> [!info]- Click to expand (starts collapsed)
> Hidden content here.
\`\`\`

**WRONG - DO NOT DO THIS:**
\`\`\`markdown
> [!tip]
> **Pro Tip**
> Content here.
\`\`\`
The title "Pro Tip" must be on the \`[!tip]\` line, not below it!`)

  // Code Editors
  sections.push(`## Interactive Code Editors

Syntax: \`\`\`language editor [options]\`\`\`

**Supported languages:** python, javascript, sql, java, cpp, go, rust, php, html, css, json, yaml, xml

**Options:**
- \`single\` - Hide file tabs for simple examples
- \`id="unique-id"\` - Persistent state across page loads
- \`db="database.db"\` - For SQL: specify database file
- \`solution="SELECT ..."\` - For SQL: expected solution query. Enables automatic pass/fail verification after each run. Multi-line solutions use \`\\n\` literals: \`solution="SELECT a, b\\nFROM t"\`

Examples:
\`\`\`markdown
\`\`\`python editor
print("Hello, World!")
\`\`\`

\`\`\`sql editor db="netflix.db"
SELECT * FROM movies LIMIT 10;
\`\`\`

\`\`\`sql editor db="chinook.db" solution="SELECT Name FROM Track"
-- Schreib deine Abfrage hier
\`\`\`

\`\`\`javascript editor single
console.log("Simple example");
\`\`\`
\`\`\`

### Python Checks (auto-grading)

Pair a \`python editor\` with a \`python-check\` block to verify student code with \`assert\` statements. The editor MUST have an \`id\`, and the check block references it via \`for="<id>"\`. The check block is never rendered — it only runs when the student clicks "Check".

\`\`\`markdown
\`\`\`python editor id="fib"
def fibonacci(n):
    pass

print(fibonacci(5))
\`\`\`

\`\`\`python-check for="fib" points="10" max-checks="5"
assert fibonacci(0) == 0, "fibonacci(0) should return 0"
assert fibonacci(5) == 5, "fibonacci(5) should return 5"
\`\`\`
\`\`\`

**python-check attributes:**
- \`for="<id>"\` — **required**, must match the editor's \`id\`
- \`points="<n>"\` — optional score value
- \`max-checks="<n>"\` — optional limit on check attempts

If you omit \`for\` or the editor \`id\`, the check block is silently dropped.`)

  // Math
  sections.push(`## Math (KaTeX)

**Inline math:** \`$expression$\`
**Display math:** \`$$expression$$\`

Examples:
- Inline: \`The formula $E = mc^2$ is famous.\`
- Display:
\`\`\`markdown
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$
\`\`\``)

  // Images
  sections.push(`## Images

**Basic markdown:** \`![alt text](image.png)\` — renders centered at full width

**With size/layout control:** Use HTML \`<img>\` tags with attributes:

\`\`\`html
<img src="image.png" alt="Description" style="width: 50%" />

<img src="image.png" alt="Left-aligned" style="width: 40%" align="left" />

<img src="image.png" alt="Floated left with text wrap" style="width: 40%" align="left" wrap="true" />

<img src="diagram.png" alt="Dark-mode friendly" invert="dark" />
\`\`\`

**Attributes:**
- \`style="width: X%"\` — Image width (percentage)
- \`align="left|center|right"\` — Alignment (default: center)
- \`wrap="true"\` — Float image so text wraps around it
- \`invert="dark|light|always"\` — Invert colors (useful for diagrams)
- \`saturate="70"\` — Saturation adjustment when inverted

**Do NOT use** the \`{width=;align=}\` attribute syntax — it is not implemented.

Excalidraw diagrams: Reference \`.excalidraw\` files directly. The system auto-detects light/dark SVG variants.`)

  // Custom CSS
  sections.push(`## Custom CSS

Use \`<style>\` blocks to add scoped CSS for custom styling:

\`\`\`html
<style>
.my-table td, .my-table th {
  padding: 0.4rem 1rem;
  text-align: center;
}
</style>

<table class="my-table">
<thead><tr><th>Header</th></tr></thead>
<tbody><tr><td>Data</td></tr></tbody>
</table>
\`\`\`

Inline \`style="..."\` attributes also work on any element.`)

  // Videos
  sections.push(`## Videos (Mux)

Reference video files by name. The system looks up the corresponding \`.json\` metadata file for Mux playback.

\`![Video description](lecture.mp4)\``)

  // YouTube
  sections.push(`## YouTube Embeds

Use the \`<youtube-embed>\` custom element (lowercase, data-prefixed attributes):

\`\`\`html
<youtube-embed data-id="dQw4w9WgXcQ"></youtube-embed>
<youtube-embed data-id="dQw4w9WgXcQ" data-start-time="120"></youtube-embed>
<youtube-embed data-playlist="PLxyz..."></youtube-embed>
\`\`\`

**Attributes:** \`data-id\` (video ID) OR \`data-playlist\` (playlist ID) — one is required. \`data-start-time\` is optional (seconds).`)

  // Mermaid
  sections.push(`## Mermaid Diagrams

Use a \`\`\`mermaid\`\`\` code fence. Diagrams render directly in the page with automatic light/dark theme switching.

\`\`\`markdown
\`\`\`mermaid
graph LR
  A --> B --> C
\`\`\`
\`\`\`

Supports all mermaid diagram types: flowcharts, sequence diagrams, class diagrams, state, ER, gantt, etc.`)

  // Plugins
  const owner = BUILTIN_PLUGIN_OWNER
  sections.push(`## Built-in Plugins

Embed interactive plugins with \`<plugin src="<author>/<slug>" [attrs]></plugin>\`. Plugins are user-scoped; on this deployment the built-ins live under the \`${owner}\` namespace.

**Available built-in plugins:**

- \`${owner}/mod-calc\` — Modular exponentiation calculator (cryptography)
  - \`formula="dlog|rsa-enc|rsa-dec"\`, \`base\`, \`exp\`, \`mod\`, \`lang="en|de"\`
- \`${owner}/color-sliders\` — RGB/hex color picker (no attrs)
- \`${owner}/cipher-lab\` — Caesar/Vigenère cipher tool
  - \`cipher="caesar|vigenere"\`, \`cipherkey\`, \`text\`, \`lang="en|de"\`
- \`${owner}/mod-clock\` — Modular arithmetic clock
  - \`mod\` (default 7), \`max\` (default 500), \`font\` (default 7), \`lang\`
- \`${owner}/diffie-hellman\` — DH key exchange simulator
  - \`p\` (default 23), \`g\` (default 5), \`a\` (default 4), \`b\` (default 3), \`lang\`
- \`${owner}/dijkstra-visualizer\` — Dijkstra's algorithm on a draggable graph
  - \`initialnodecount\` (default 7), \`initialdirected\` (default false), \`lang\`
- \`${owner}/data-cube-visualizer\` — 3D RGB data cube for image quantization
  - \`lang="en|de"\`

**Universal attribute:** \`height="500"\` (optional, pixels) overrides the plugin's default height.

Example:
\`\`\`html
<plugin src="${owner}/mod-clock" mod="12" max="144" lang="de" height="500"></plugin>
<plugin src="${owner}/cipher-lab" cipher="caesar" text="HELLO" lang="en"></plugin>
\`\`\`

All attributes are lowercase string values (not JSX expressions). Self-closing form \`<plugin ... />\` is also valid.`)

  // Tabs
  sections.push(`## Tabs

Create tabbed content using HTML elements (markdown inside tabs is supported):

\`\`\`markdown
<tabs-container data-items='["Python", "JavaScript"]'>
<tab-item>

\`\`\`python
print("Hello")
\`\`\`

</tab-item>
<tab-item>

\`\`\`javascript
console.log("Hello");
\`\`\`

</tab-item>
</tabs-container>
\`\`\`

**IMPORTANT:** Each tab's content goes inside \`<tab-item>\` tags. The \`data-items\` array defines tab labels in order. Leave blank lines around markdown content inside tabs.`)

  // Quiz
  sections.push(`## Quizzes

Interactive multiple choice using \`<question>\` and \`<answer>\` HTML tags:

\`\`\`markdown
<question id="q1" type="single">
<answer correct="true">4</answer>
<answer feedback="Too low">3</answer>
<answer feedback="Too high">5</answer>
</question>
\`\`\`

**question attributes:**
- \`id="unique-id"\` — Optional, auto-generated if omitted
- \`type="single"\` — Single choice (default)

**answer attributes:**
- \`correct="true"\` — Marks the correct answer
- \`feedback="..."\` — Shown when this wrong option is selected

**Migration:** If you encounter \`<Option>\`, \`<quiz-option>\`, or any PascalCase variant, convert them to \`<answer>\`.

**Do NOT use** the \`:::quiz\` fence syntax — it is not implemented.`)

  return sections.join('\n\n')
}

/**
 * Get a condensed version for token-constrained contexts.
 */
export function getCondensedSyntaxReference(): string {
  const baseTypes = Object.entries(calloutTypes)
    .filter(([key, value]) => key === value)
    .map(([key]) => key)

  return `## Supported Markdown Syntax

**HTML component rules:** All custom tags and attributes must be lowercase with string values. No PascalCase, no JSX expressions.
  - Use self-closing tags for components without children: \`<plugin src="eduadmin/mod-calc" />\`
  - Correct: \`<plugin src="eduadmin/mod-calc" />\`, \`<question id="q1" type="single">\`
  - Wrong: \`<Question initialCount={7}>\` (PascalCase, JSX)

**Callouts:** \`> [!type] Title on same line\` - CRITICAL: title MUST be on same line as [!type]
  - Types: ${baseTypes.join(', ')}
  - Aliases: lernziele→success, hint→tip, exercise→abstract
  - Collapsible: \`> [!type]-\` (closed) or \`> [!type]+\` (open)
  - WRONG: \`> [!tip]\\n> **Title**\` - NEVER put title on new line!

**Code Editors:** \`\`\`language editor [single] [id="x"] [db="file.db"] [solution="SELECT ..."]\`\`\`
  - Languages: python, javascript, sql, java, cpp, go, rust, etc.
  - \`solution="SELECT ..."\`: SQL only — shows pass/fail after each run. Multi-line: use \`\\n\` literals inside the quotes.

**Python Checks:** pair \`\`\`python editor id="x"\`\`\` with \`\`\`python-check for="x"\`\`\` containing \`assert\` statements.
  - \`for="<id>"\` is REQUIRED and must match the editor's \`id\` — otherwise the check block is silently dropped.
  - Optional: \`points="10"\`, \`max-checks="5"\`. Check block is never rendered, only runs on "Check".

**Math:** \`$inline$\` and \`$$display$$\` (KaTeX)

**Images:** \`![alt](img.png)\` or \`<img src="img.png" alt="alt" style="width: 50%" align="left" wrap="true" />\`

**Custom CSS:** \`<style>.my-class { ... }</style>\` — scoped CSS blocks are supported. Inline \`style="..."\` also works on any element.

**Tabs:** HTML syntax only:
  \`<tabs-container data-items='["Tab1", "Tab2"]'><tab-item>Content1</tab-item><tab-item>Content2</tab-item></tabs-container>\`

**Quiz:** \`<question id="q1" type="single"><answer correct="true">Right</answer><answer feedback="Nope">Wrong</answer></question>\`
  - Use \`correct="true"\` to mark the correct answer
  - If you see \`<Option>\` or \`<quiz-option>\`, convert to \`<answer>\`
  - Do NOT use \`:::quiz\` syntax — it is not implemented

**YouTube:** \`<youtube-embed data-id="VIDEO_ID" data-start-time="120"></youtube-embed>\` (or \`data-playlist="..."\`). Lowercase, data-prefixed attrs only.

**Mermaid:** \`\`\`mermaid fenced code block — renders natively, theme-aware.

**Built-in plugins:** \`<plugin src="${BUILTIN_PLUGIN_OWNER}/<slug>" [attrs] [height="500"]></plugin>\` — user-scoped; built-ins on this deployment under \`${BUILTIN_PLUGIN_OWNER}\`:
  - \`mod-calc\` (\`formula\`, \`base\`, \`exp\`, \`mod\`, \`lang\`), \`color-sliders\`, \`cipher-lab\` (\`cipher\`, \`cipherkey\`, \`text\`, \`lang\`)
  - \`mod-clock\` (\`mod\`, \`max\`, \`font\`, \`lang\`), \`diffie-hellman\` (\`p\`, \`g\`, \`a\`, \`b\`, \`lang\`)
  - \`dijkstra-visualizer\` (\`initialnodecount\`, \`initialdirected\`, \`lang\`), \`data-cube-visualizer\` (\`lang\`)`
}
