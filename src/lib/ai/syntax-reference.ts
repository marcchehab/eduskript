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
\`\`\`

PascalCase/camelCase doesn't error — the parser silently lowercases both tag AND attribute names before anything else runs. So \`<Question>\` becomes \`<question>\` (harmless), but an attribute like \`startTime\` silently becomes \`starttime\` and the component receives nothing — a much quieter failure than an error. Always author tags and attributes lowercase (kebab-case for multi-word attributes) to begin with.`)

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

**Executable languages** (the editor actually runs the code):
- \`python\` - Pyodide / Skulpt, runs in the browser
- \`javascript\` - sandboxed Web Worker, no DOM access
- \`sql\` - sql.js (SQLite WASM), needs \`db="..."\`
- \`html\` - sandboxed iframe with a live preview pane (see below)

Other language identifiers (java, cpp, go, rust, php, css, json, yaml, xml, …) only get syntax highlighting when used with \`editor\` — there is no runtime to execute them.

**Options:**
- \`single\` - Hide file tabs for simple examples
- \`exam\` - Exam mode: pair with a \`python-check\` block to grade silently. The student runs the code but does NOT see whether checks passed (no green/red feedback, no solution reveal). Use for graded assessments; use plain \`python editor\` (no \`exam\`) for practice exercises where students should see immediate feedback.
- \`id="unique-id"\` - Persistent state across page loads. **Required** when pairing with \`python-check\` (the check uses \`for="<id>"\`).
- \`file="name.py"\` - Multi-file editor: repeat the fence with the same \`id\` and a different \`file=\` to add a tab. \`\`\`python editor id="ex1" file="main.py"\`\`\` followed by \`\`\`python editor id="ex1" file="helper.py"\`\`\` merges into one two-tab editor. Not wired up for \`html\` yet (one file per HTML editor).
- \`assets="a.csv,b.png"\` - Teacher-attached read-only files (resolved from skript file storage) the student's code can open, e.g. \`pd.read_csv('a.csv')\`. Python only.
- \`allow-upload\` / \`accept="image/*,.csv"\` - Lets the student upload their own file into the editor (in-browser only, never sent to the server); \`accept\` restricts the file picker by MIME type/extension. Python only.
- \`db="database.db"\` - For SQL: specify database file
- \`solution="SELECT ..."\` - For SQL: expected solution query. Enables automatic pass/fail verification after each run. Multi-line solutions use \`\\n\` literals: \`solution="SELECT a, b\\nFROM t"\`
- \`schema-image="name"\` - For SQL: override the auto-generated ER diagram with a specific Excalidraw/image asset instead of deriving it from \`db\`
- \`height="500"\` - Pixel height of the editor. For HTML, this is the total height of the editor + preview pane (default 400).
- \`output-only\` - Auto-runs once on load and starts with the code panel collapsed, so only the output/plot shows. Ideal for displaying a matplotlib figure without the reader running anything. The reader can click "Show code" to reveal, edit, and rerun. Works with \`python\`; combine with \`height="..."\` to size the plot area.

Both the code panel and the plot panel can be collapsed and re-opened live (buttons on each panel); the Run button stays reachable while the code panel is collapsed.

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

### HTML editor (live preview)

\`\`\`html editor\`\`\` renders a split view: CodeMirror on the left, a sandboxed iframe on the right that re-renders ~500 ms after each keystroke. Use it to teach HTML/CSS/JS together — students see the page they are building as they type.

\`\`\`markdown
\`\`\`html editor
<style>h1 { color: crimson }</style>
<h1>Hallo</h1>
<button onclick="alert('Klick!')">Klick</button>
\`\`\`
\`\`\`

Behaviour and constraints (different from the other editors):
- The iframe sandbox is \`allow-scripts allow-modals allow-forms\`. Inline event handlers, \`<script>\`, \`alert\`/\`prompt\`, and \`<form>\` work. There is no \`allow-same-origin\`, so user code cannot reach Eduskript's window, cookies, or storage. There is no \`allow-top-navigation\`, so the host tab cannot be redirected.
- External resources (CDN scripts, Google Fonts, remote images) load normally — no CSP blocks them.
- No \`exam\` mode and no \`python-check\` pairing — HTML editors are not auto-graded.
- One file per editor for now; \`file=\` multi-block grouping is not yet wired up for HTML.
- \`id\` and \`height\` work as documented above; persistence and Reset behave like the other editors.

### Python Checks (auto-grading)

Pair a \`python editor\` with a \`python-check\` block to verify student code with \`assert\` statements. The editor MUST have an \`id\`, and the check block references it via \`for="<id>"\`. The check block is never rendered — it only runs when the student clicks "Check".

\`\`\`markdown
\`\`\`python editor id="fib"
def fibonacci(n):
    # Your code here
    pass
\`\`\`

\`\`\`python-check for="fib" points="10" max-checks="5"
assert fibonacci(0) == 0, "fibonacci(0) should return 0."
assert fibonacci(1) == 1, "fibonacci(1) should return 1."
assert fibonacci(5) == 5, "fibonacci(5) should return 5."
\`\`\`
\`\`\`

**python-check attributes:**
- \`for="<id>"\` — **required**, must match the editor's \`id\`
- \`points="<n>"\` — optional score value
- \`max-checks="<n>"\` — optional limit on check attempts

**Available in checks:**
- All names defined by the student's code (variables, functions) are accessible directly.
- \`output\` — the student's captured **stdout as a single string** (not a list). Includes trailing newlines from \`print()\`. To compare line-by-line, use \`output.splitlines()\` against a list of strings, or compare \`output\` against a literal string with \`\\n\` separators. **Never** compare \`output\` directly to a list — \`str == list\` is always \`False\`.
  - ✅ \`assert output.splitlines() == ["0", "1", "Done!"], "..."\`
  - ✅ \`assert output == "0\\n1\\nDone!\\n", "..."\`
  - ✅ \`assert "Done!" in output, "..."\`  (substring check)
  - ❌ \`assert output == ["0", "1", "Done!"], "..."\`  (always fails)

**Writing good checks — DOs and DON'Ts:**

- ✅ **Test behavior directly.** Each \`assert\` should test one observable outcome (an output, a return value, a side effect).
- ✅ **The message is the test name shown to the student.** Plain strings work: \`assert fn(5) == 25, "fn(5) should return 25."\` So do f-strings — \`{var}\` placeholders are evaluated at runtime against the student's namespace, so \`f"got {x}"\` renders the actual value. If a placeholder can't be evaluated (variable out of scope, bad expression) it falls back to \`…\` so the student never sees raw braces.
- ✅ **Optional pass message** via a \`|\` separator: \`"fail message|pass message"\`. The fail message shows on failure, the pass message shows on success. Without \`|\` the same message is shown for both states — use that for a neutral test description. Example: \`assert fn(5) == 25, f"fn(5) should return 25 but got {fn(5)}.|Nice — fn(5) = 25!"\`
- ❌ **Don't add preflight checks that pass on stub code**, e.g. \`assert "fn_name" in globals()\` or \`assert result is not None\`. These pass *before the student does anything*, inflating the score from 0% to ~30% and giving false reassurance. If the student's function is missing, the runner already surfaces a clear error on every test that uses it — that's enough.
- ✅ **For open challenges with multiple valid solutions**, test *behavior* with multiple inputs/edge cases, not implementation form. Example: \`assert "umbrella" in advise(10, True).lower(), "Cold rainy weather should suggest an umbrella."\`
- ❌ **Don't repeat the same test path with different inputs**. Three asserts that all hit the same code branch waste score signal.

If you omit \`for\` or the editor \`id\`, the check block is silently dropped.

**Multi-stage checks:** several \`python-check for="x"\` blocks targeting the same editor become ordered stages (document order = stage order) instead of one flat check — the student clears one stage before the next unlocks. Each stage can add \`gate-at="<points>"\` (minimum score to unlock the next stage) and \`label="..."\` (stage name shown to the student).

### Copy button (plain, non-\`editor\` code blocks)

A fenced block WITHOUT \`editor\` (just \`\`\`python \`\`\`) is not interactive — it's a read-only, syntax-highlighted display block (see the "Code Blocks" reference for plain blocks and inline code). It shows a copy button on hover; add \`copy=false\` (or \`no-copy\`) to the info string to hide it, \`copy\`/\`copy=true\` to force it on. Hidden by default on exam pages.

### Line annotations (plain, non-\`editor\` code blocks)

Mark individual lines of a read-only block as added, removed, highlighted or focused — Shiki's notation, stripped from the code before it renders:

\`\`\`python
import turtle
import os              # [!code ++]
ship = turtle.Turtle() # [!code ++]
turtle.done()          # [!code --]
window.tracer(0)       # [!code highlight]
ship.setx(new_x)       # [!code focus]
\`\`\`

- \`++\` green (added), \`--\` red (removed), \`highlight\` neutral tint, \`focus\` blurs every other line until the block is hovered.
- \`[!code ++:3]\` applies the mark to that line and the 2 following — useful for a block of new lines.
- A line whose only content is the marker becomes an empty added line.
- Any comment token works (\`#\`, \`//\`, \`--\`, \`;\`, \`%\`, \`/* */\`, \`<!-- -->\`), and the comment is removed with the marker.
- Without comments: line ranges in the info string — \`\`\`python {2,5-7} add={3-4} del={9} focus={1}\`\`\` (a bare \`{...}\` means highlight).
- Only plain blocks; an \`editor\` block keeps its text verbatim (students edit it).

### Turtle auto-grading

Turtle exercises are gradeable through the same \`python-check\` mechanism. Pyodide's stdlib doesn't ship turtle, so the runner installs a recording stub that captures every move into a global \`turtle_path\` list (tuples of \`(x, y, pen_down)\`). Three helper functions are then available inside any \`python-check\`:

- **\`turtle_solution_matches(solution_code, tolerate_rotation=True, match_colors=False)\`** — preferred. Pass a string of teacher-written turtle code; the runner exec's it through the same recording stub and compares the figures. No need to enumerate vertices by hand. Set \`match_colors=True\` to also require each segment to have the same pen color in solution and student (call \`t.color("red")\` etc. consistently on both sides — strings are compared lowercased).
- **\`turtle_matches(expected, tolerate_rotation=True)\`** — comparison against a hand-written list of segments \`[((x1,y1),(x2,y2)), …]\`. Use when the figure is short enough to type out.
- **\`turtle_path_matches(expected, tolerance=1.0, tolerate_rotation=True)\`** — strict vertex-order comparison. Use only when the order of moves is part of the exercise; for "did the student draw the right figure?" use \`turtle_solution_matches\` or \`turtle_matches\`.

All three are translation-invariant (bounding-box origin) and, by default (\`tolerate_rotation=True\`), try the four cardinal rotations — pass \`tolerate_rotation=False\` if orientation is part of what you're grading. \`turtle_matches\` and \`turtle_solution_matches\` compare the **set of drawn segments** — direction of strokes, order of strokes, and retracing don't matter; only the figure matters. So a student drawing a square CW vs CCW vs starting from a different corner all match.

Example using a reference solution:

\`\`\`markdown
\`\`\`python editor id="stairs"
import turtle
t = turtle.Turtle()
# student writes their solution here
\`\`\`

\`\`\`python-check for="stairs"
solution = """
import turtle
t = turtle.Turtle()
def square(t, side):
    for _ in range(4):
        t.forward(side)
        t.left(90)
square(t, 30)
t.penup()
t.goto(30, 30)
t.pendown()
square(t, 30)
"""
assert turtle_solution_matches(solution), "Draw a 2-step stairs of two 30×30 squares."
\`\`\`
\`\`\`

**Limitations:**
- Pyodide's turtle is a recording stub, not a renderer. Style methods (\`fillcolor\`, \`pensize\`, \`hideturtle\`, \`speed\`, \`tracer\`, …) are accepted but no-ops. \`color\`/\`pencolor\` are recorded per segment so \`turtle_solution_matches(..., match_colors=True)\` can grade colours; everything else is figure-only. The Skulpt run the student sees on Run renders all style methods correctly; only the auto-grader ignores the no-op ones.
- Multi-line \`assert\` with backslash continuations works (the parser handles it), but multi-line strings inside an assert (triple-quoted) confuse the splitter. Put long solution strings as a setup-line assignment first, then assert on the variable.`)

  // Inline code language highlighting
  sections.push(`## Inline Code Language Highlighting

Append \`{:lang}\` right after the closing backtick of inline code to color it like a fenced code block, without breaking it out into its own block:

\`\`\`markdown
The expression \`[x**2 for x in range(10)]\`{:python} is a list comprehension.
\`\`\`

Same language set as \`editor\`/fenced code blocks: python, javascript/js, typescript/ts, sql, php, java, cpp, rust, go, html, css, json, xml, yaml. No marker → plain, uncolored inline code (the default).`)

  // Flag icons
  sections.push(`## Flag Icons

\`:flag-en-gb:\` or \`:flag-de-ch:\` drops an inline flag icon anywhere in text, e.g. a heading: \`## User Manual :flag-en-gb:\`. Only these two codes exist (matching the signup page's language picker); any other code is left as literal text.`)

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
\`\`\`

**Chemistry (mhchem):** \`\\ce{...}\` inside \`$...$\`/\`$$...$$\` for reaction equations — auto-subscripts numbers, \`<=>\` for equilibrium arrows, \`^2+\`/\`^-\` for charges. Prefer this over hand-rolled \`\\mathrm{}\`.
\`\`\`markdown
$$
\\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}
$$
\`\`\`

**Colored terms:** use \`\\textcolor{color}{...}\` (scoped to its argument), NEVER \`\\color{color}\` (a switch that colors everything until the end of the math group or the next \`\\color\`). \`\\color\` requires a \`\\color{black}\`-style "reset" to stop coloring the rest of the expression — but \`black\` is hardcoded and breaks in dark mode (invisible text on a dark background). \`\\textcolor\` needs no reset; text outside its braces just inherits the page's normal (theme-aware) color.
\`\`\`markdown
$\\textcolor{orange}{8 \\cdot 1} + \\textcolor{blue}{4 \\cdot 1} + \\textcolor{green}{2 \\cdot 0} + \\textcolor{red}{1 \\cdot 1} = 13_{10}$
\`\`\`
Wrong: \`$\\color{orange}8 \\cdot 1 + \\color{blue}4 \\cdot 1 \\color{black} = ...$\` — the trailing \`\\color{black}\` is unreadable in dark mode.`)

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
- \`nozoom="true"\` — Suppress the fullscreen/zoom button and lightbox (e.g. a UI screenshot that's itself a link)

A \`{key=value;key2}\` attribute block right after the image (e.g. \`{invert}\`, \`{invert=light;saturate=70}\`) IS implemented, but only for \`invert\`/\`saturate\` — \`{width=...}\` is parsed but silently has no effect (use \`style="width: X%"\` instead).

Excalidraw diagrams: Reference \`.excalidraw\` files directly. The system auto-detects light/dark SVG variants. Use \`<excali src="name" lightonly />\` (or the \`lightonly\` attribute on the shorthand) to always show the light variant regardless of viewer theme, e.g. for diagrams without a meaningful dark version. Use \`<excali src="name" nozoom />\` to suppress the fullscreen/zoom button and lightbox.`)

  // Text alignment
  sections.push(`## Text alignment

Wrap content in a \`<left>\`, \`<center>\`, or \`<right>\` block to align it. Inner content is parsed as markdown with or without surrounding blank lines.

\`\`\`markdown
<center>
## Centered heading
A centered paragraph below.
</center>
\`\`\`

The closing tag is required.`)

  // Flex layouts
  sections.push(`## Flex Layouts (\`<flex>\` / \`<flex-item>\`)

Side-by-side columns that stack on mobile (\`flex-col\` below md, \`flex-row\` at md+).

\`\`\`html
<flex gap="medium">
  <flex-item>
    Left column content. Markdown works inside.
  </flex-item>
  <flex-item>
    Right column content.
  </flex-item>
</flex>
\`\`\`

**\`<flex>\` attributes** (all optional):
- \`gap="none|small|medium|large"\` (default \`medium\`)
- \`direction="row|column"\` — currently has no visible effect (a CSS-merge bug always forces column-on-mobile/row-on-desktop regardless of this attribute); don't rely on it to force a row on mobile.
- \`justify="start|center|end|between|around|evenly"\`
- \`align="start|center|end|stretch|baseline"\`
- \`wrap="true|false"\` (default \`true\`)
- \`style="..."\` and \`class="..."\` pass through

**\`<flex-item>\` attributes** (all optional):
- \`width="49%"\` — explicit width (overrides equal-share distribution)
- \`grow="false"\` — opt out of growing
- \`style="..."\` (e.g. \`background-color\`, \`padding\`) and \`class="..."\` pass through

**Equal columns:** omit \`width\` entirely — items default to \`flex: 1\` with \`flex-basis: 0\`, so they divide space equally regardless of content. Only set \`width\` when you want a deliberately uneven split (e.g. \`width="30%"\` + an auto-growing sibling).

Markdown inside \`<flex-item>\` is parsed whether or not you leave blank lines around it.`)

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

\`![Video description](lecture.mp4)\`

The alt text is the caption. Playback options are attributes on the tag form (valueless):

\`\`\`html
<muxvideo src="geogebra-class.mp4" gif />
<muxvideo src="intro.mp4" alt="Overview" autoplay loop />
<muxvideo src="lecture.mp4" poster="cover.png" pin />
\`\`\`

**Attributes:** \`gif\` — play it like an animated GIF (muted autoplay, looping, no controls, not clickable; browsers only autoplay muted video); \`autoplay\` (muted), \`loop\`, \`pin\` (pins into a corner overlay when scrolled past), \`poster\` (filename or URL overriding the auto thumbnail), \`alt\` (caption).

In the dashboard preview these toggle from a toolbar in the video's top-right corner.`)

  // YouTube
  sections.push(`## YouTube Embeds

Three equivalent forms — all render the same player. Pick whichever reads best.

**Markdown image syntax** (recognised YouTube URL → embed; alt becomes a caption beneath):

\`\`\`markdown
![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)
![Caption shown beneath](https://youtu.be/dQw4w9WgXcQ?t=120)
![](https://www.youtube.com/playlist?list=PLxyz)
\`\`\`

**JSX-style tag** (case-insensitive):

\`\`\`html
<youtube id="dQw4w9WgXcQ" />
<youtube id="dQw4w9WgXcQ" startTime={120} caption="Caption" />
<youtube playlist="PLxyz..." />
<youtube id="dQw4w9WgXcQ" thumbnail="custom-teaser.png" />
\`\`\`

\`thumbnail\` overrides the default YouTube-hosted teaser image (auto maxresdefault/hqdefault) with a custom one. Accepts an uploaded filename, resolved via the skript's files, or an absolute URL.

**Custom element** (the underlying form, data-prefixed attributes):

\`\`\`html
<youtube-embed data-id="dQw4w9WgXcQ"></youtube-embed>
<youtube-embed data-id="dQw4w9WgXcQ" data-start-time="120" data-caption="Caption"></youtube-embed>
<youtube-embed data-playlist="PLxyz..."></youtube-embed>
<youtube-embed data-id="dQw4w9WgXcQ" data-thumbnail="custom-teaser.png"></youtube-embed>
\`\`\`

**Attributes:** \`id\`/\`data-id\` (video ID) OR \`playlist\`/\`data-playlist\` — one is required. \`startTime\`/\`data-start-time\` (seconds) and \`caption\`/\`data-caption\` are optional.`)

  // GeoGebra
  sections.push(`## GeoGebra Applets

Embed an interactive GeoGebra applet by its online material id (the code at the end of a geogebra.org share link, e.g. \`geogebra.org/m/dNPHaqgb\`). Self-closing, lowercase tag, string attributes.

\`\`\`html
<geogebra material-id="dNPHaqgb" />
<geogebra material-id="dNPHaqgb" height="500" show-toolbar="true" show-algebra-input="true" />
\`\`\`

**Attributes:** \`material-id\` (required), \`height\` (px — OPTIONAL; omit it and the applet auto-fits its content so nothing is clipped; set it only to pin a fixed height), \`width\` (px, default fits the page), \`show-toolbar\` and \`show-algebra-input\` (default off — a clean read-only embed), \`correct-when\` (name of a boolean object in the construction that is true when the answer is right — captures per-student correctness for the teacher's class tally). Students can use the applet without a GeoGebra account; on exam pages their construction is captured for grading automatically.`)

  // Spacer writing area
  sections.push(`## Spacer (writing area)

A blank vertical space students write on by hand with the annotation pens — e.g. room to solve an equation, sketch, or show working below an exercise. Choose a background pattern: \`checkered\` (grid/graph paper), \`lines\`, \`dots\`, or \`blank\`. Self-closing, lowercase tag.

\`\`\`html
<spacer id="sp-solve1" pattern="checkered" height="200" />
<spacer pattern="lines" height="300" />
\`\`\`

**Attributes (all optional):** \`pattern\` — \`checkered\` (default) | \`lines\` | \`dots\` | \`blank\`; \`height\` — px (default 200, range 40–1000); \`id\` — stable identifier (auto-added when inserted from the toolbar; keeps in-preview resize/restyle edits pointing at the right tag). In the editor the spacer shows a bottom drag-handle to change height and a top-right toolbar to switch pattern or delete it; on the published page it renders as a plain patterned area.`)

  // Call-to-action button
  sections.push(`## CTA button

A call-to-action link styled as a button, matching the site's own UI and theme. Use it for signup or "read more" links on landing and front pages — never draw a button as an image.

\`\`\`html
<cta href="/auth/signup">Create free account</cta>
<cta href="https://example.org/docs" label="Read the docs" variant="outline" size="default" align="left" />
\`\`\`

**Attributes:** \`href\` (required); label from the children or from \`label\` when self-closing; \`variant\` — \`default\` (default) | \`secondary\` | \`outline\` | \`ghost\`; \`size\` — \`lg\` (default) | \`default\` | \`sm\`; \`align\` — \`center\` (default) | \`left\` | \`right\`; \`external\` — \`true\`/\`false\` to force or prevent opening in a new tab (absolute URLs open in a new tab by default).`)

  // Newsletter signup
  sections.push(`## Newsletter signup

An email capture box. Addresses go to the site's Brevo list, which owns the confirmation mail and the unsubscribe link — nothing is stored on the page.

\`\`\`html
<newsletter />
<newsletter title="Stay in the loop" description="One mail a month about new material." button="Sign me up" />
\`\`\`

**Attributes (all optional):** \`title\`, \`description\`, \`button\` — label on the submit button; \`list-id\` — a specific Brevo list, otherwise the site default.`)

  // AI feedback
  sections.push(`## AI Feedback

A button students press to get AI feedback on what they drew or wrote by hand on the page (with the annotation pens) — e.g. a math derivation written next to an exercise. The strokes in the surrounding section (from the previous h1, h2 or h3 heading to the next one) are rendered to an image and sent to a vision model together with the section's markdown and the teacher's prompt. Students can alternatively paste a screenshot (hover the dashed box, Ctrl+V) — useful when they marked up content like tables or diagrams. Self-closing, lowercase tag.

\`\`\`html
<ai-feedback prompt="Check each simplification step. Point out the first error, do not reveal the solution." />
<ai-feedback id="fb-quadratics" label="Check my solution" prompt="..." />
\`\`\`

**Attributes:** \`prompt\` — teacher instructions for the AI (not shown to students); \`id\` — optional stable identifier (components map to their prompt by position automatically, even with several per page); \`label\` — button text (default "Get AI feedback"). Place the tag inside the exercise's own heading section; an h3 per exercise keeps the context tight. Requires a logged-in user; requests are rate-limited.`)

  // Ping terminal
  sections.push(`## Ping Terminal

An interactive terminal where students type the ping command themselves
(\`ping wairualodge.co.nz\`, \`ping -c 6 8.8.8.8\`). Useful where a school network
blocks ICMP, since the measurement runs from the server. Self-closing, lowercase tag.

\`\`\`html
<ping />
<ping host="wairualodge.co.nz" count="4" os="windows" />
\`\`\`

**Attributes (all optional):** \`host\` — auto-runs \`ping <host>\` once on first view as a demo, then students keep typing; \`count\` — probe count for that demo run (1–8, default 4); \`os\` — initial output style (\`linux\` | \`macos\` | \`windows\`; defaults to auto-detecting the viewer's OS). A top-right button switches the OS style live across all output. Students type \`ping [-c N] <host>\`; \`clear\` clears the screen; up/down arrows recall history.

**Honest note:** it is NOT ICMP — it times a TCP connect (port 443, then 80) from the server. RTT, resolved IP and packet loss are real; \`bytes\`/\`icmp_seq\` are cosmetic and TTL is omitted. Because it runs from the server, RTT reflects the server's location, not the student's connection. **Requires a logged-in user**; private/internal addresses are blocked and requests are rate-limited.`)

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

  // Function plots
  sections.push(`## Function Plots

Use a \`\`\`plot\`\`\` code fence for a graph of one or more functions. It renders as a static SVG image (light + dark), so students can draw on it with the annotation pens and an \`<ai-feedback>\` tag in the same section picks the graph up automatically.

\`\`\`markdown
\`\`\`plot
x: -4..4
y: -3..3
grid
f(x) = 1/3x^3 - x
g(x) = 2sin(x), blue, dashed
A = (-1, 2/3), label="A"
vline x=-1 dashed
\`\`\`
\`\`\`

**One entry per line, order does not matter, \`#\` starts a comment:**
- \`f(x) = <term>\`, \`y = <term>\` or a bare \`<term>\` — a curve. Later curves may use earlier ones: \`g(x) = f(x) + 2\`.
- \`A = (a, b)\` — a point. \`vline x=-1\` / \`hline y=2\` — a guide line.
- \`x: -4..4\`, \`y: -3..3\` — the window. Leave \`y:\` out and it is derived from the curve.
- Flags: \`grid\` / \`nogrid\`, \`axes\` / \`noaxes\`, \`legend\` / \`nolegend\`, \`aspect: equal\`, \`size: 640x400\`, \`caption: …\`.
- Options after a comma: a colour word (\`red\`, \`blue\`, \`green\`, \`orange\`, \`purple\`, \`teal\`, \`pink\`, \`brown\`, \`gray\`, \`grey\`, \`black\`) or \`color=#2563eb\`, \`label="…"\`, \`dashed\`, \`dotted\`, \`thick\`.

**Terms:** implicit multiplication works the way it is written on paper (\`2x\`, \`2sin(x)\`, \`1/3x^3\`). Functions: \`sin cos tan asin acos atan sinh cosh tanh exp ln log log2 sqrt abs sign floor ceil round min max mod\` — \`ln\` is the natural logarithm, \`log\`/\`lg\` are both base 10. Constants \`pi\` and \`e\`. Poles (\`1/x\`, \`tan\`) are detected, so no vertical line is drawn through an asymptote.

\`x: -4..4\` sets the window; \`x = 3\` draws a vertical line. Colon versus equals is the difference.

A fence with only a window and \`grid\` gives an empty coordinate system to draw on.`)

  // Structural formulas
  sections.push(`## Structural Formulas (Chemistry)

\`<molecule>\` draws a structural formula from a SMILES string. Self-closing, lowercase tag.

\`\`\`html
<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" name="Aspirin" />
<molecule smiles="O" name="Wasser" width="240" height="180" />
\`\`\`

**Attributes:** \`smiles\` (required — the standard molecule notation: \`CCO\` ethanol, \`c1ccccc1\` benzene, \`O\` water), \`name\` (caption below the drawing), \`width\` / \`height\` in px (default 420×300), plus the same layout attributes an image takes: \`display-width\` (percent of the column), \`align="left|center|right"\`, \`wrap="true"\`. In the editor these come from the drag handles, so they rarely need typing.

Rendered server-side as an \`<img>\`, so students can draw on it with the annotation pens and an \`<ai-feedback>\` tag in the same section captures it. Element colours follow the usual convention; dark mode only lightens the black ink. A SMILES that cannot be parsed renders an image stating the problem — it never breaks the page.`)

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
  - \`mod\` (default 7), \`modmax\` (default 29, slider cap, max 200), \`max\` (default 500), \`font\` (default 7), \`lang\`
- \`${owner}/diffie-hellman\` — DH key exchange simulator
  - \`p\` (default 23), \`g\` (default 5), \`a\` (default 4), \`b\` (default 3), \`lang\`
- \`${owner}/dijkstra-visualizer\` — Dijkstra's algorithm on a draggable graph
  - \`initialnodecount\` (default 7), \`initialdirected\` (default false), \`initialspeed\` (100–2000, higher = faster; default 1300), \`lang\`
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

**IMPORTANT:** Each tab's content goes inside \`<tab-item>\` tags. The \`data-items\` array defines tab labels in order. Markdown inside a tab is parsed with or without surrounding blank lines.`)

  // Quiz
  sections.push(`## Quizzes

Interactive multiple choice using \`<question>\` and \`<answer>\` HTML tags. Put the question text inside the tag, on the line before the answers — it renders as the card's heading. Prompt and answers support markdown and \`$math$\`:

\`\`\`markdown
<question id="q1" type="single">
What is 2 + 2?
<answer correct="true">4</answer>
<answer feedback="Too low">3</answer>
<answer feedback="Too high">5</answer>
</question>
\`\`\`

**question attributes:**
- \`id="unique-id"\` — Optional, auto-generated if omitted
- \`type="multiple"\` — Multiple choice / checkboxes (the default if \`type\` is omitted). **Always set \`type\` explicitly** — omitting it silently gives checkboxes, not a single-select radio group. Other types: \`single\` (radio, one answer), \`text\` (free-text answer), \`number\` (slider), \`range\` (two-handle slider)
- \`showFeedback="true"\` — reveal correct/wrong feedback (and the auto-check score/diff) to the student during the attempt. **OFF by default for students** in both exams and practice (there's no Submit button, so default-on would leak the answer the moment they type). Teachers always see correctness when grading, and students see it on their returned/graded exam.
- \`points="2"\` — max points for grading (default 1). Text questions get partial credit by similarity; single/multiple-choice score full points on an exact match of the correct set, else 0. Teachers can override any per-question score when grading an exam. For an explicit id (so the score is reliably attributed), set \`id="..."\`.

**Number sliders** (\`type="number"\`) — set the range with \`minValue\` / \`maxValue\` / \`step\`. Use \`minLabel\` / \`maxLabel\` to caption the two ends; the captions render beneath the slider at either end, so don't bake them into the body text:

\`\`\`markdown
<question id="python-rating" type="number" minValue="1" maxValue="10" step="0.1" minLabel="irrelevant" maxLabel="would use it">
How relevant is Python for your work?
</question>
\`\`\`

**Slider auto-check** — give a \`number\` or \`range\` question an \`expected\` target and it grades itself, with partial credit and graded hints:

\`\`\`markdown
<question id="hochpunkt" type="number" points="2" showFeedback="true"
          minValue="-2" maxValue="2" step="0.1" expected="-1" tolerance="0.15">
At which $x$ does $f$ have its maximum?
<answer from="1" feedback="Correct — $f'(x) = x^2 - 1 = 0$ and $f''(-1) < 0$."></answer>
<answer from="0.7" feedback="Close. Set $f'(x) = x^2 - 1$ to zero."></answer>
<answer feedback="Not yet. Differentiate first, then solve $f'(x) = 0$."></answer>
</question>
\`\`\`

- \`expected="-1"\` for \`type="number"\`, \`expected="-1..1"\` for \`type="range"\` (two handles).
- \`tolerance\` — distance that still counts as fully correct (number only, default half a step). \`window\` — distance beyond the tolerance over which the score fades to zero (default a quarter of the slider span). Range questions score by interval overlap divided by union, so guessing too wide costs as much as too narrow.
- \`<answer from="0.7" feedback="…">\` are feedback bands: the highest threshold the student's ratio reaches wins, a band without \`from\` is the catch-all. Bands only pick the wording — the points come from the ratio × \`points\`.
- Without \`expected\` a slider stays ungraded and the teacher scores it by hand, as before.

**answer attributes:**
- \`correct="true"\` — Marks the correct answer
- \`feedback="..."\` — Shown when this wrong option is selected. Markdown and \`$math$\` are rendered.
- \`from="0.7"\` — Feedback band threshold for slider questions (see above)

Spacing is forgiving: a prompt line and blank lines around the \`<answer>\` tags are optional — the question renders correctly either way.

**Free-text auto-check (predict-the-output):** a \`type="text"\` question can be auto-graded against an expected output written as an \`\`\`expected fenced block inside the question (leave a blank line before it). The typed answer gets **partial credit** by a line-exact-match ratio (× \`points\`, default 1, rounded to 0.1 pts) with a diff — the fraction of expected lines matched exactly (LCS-based), not fuzzy character similarity, so a one-character typo loses that whole line's credit. An exact match (after normalizing: each line trimmed, surrounding blank lines dropped; comparison is strictly line-by-line) is fully correct. Optional flags: \`ignore-case="true"\`, \`ignore-whitespace="true"\`. Example:

<question id="predict1" type="text" points="2">
Predict the output:

\`\`\`expected
0
2
4
\`\`\`
</question>

**Migration:** If you encounter \`<Option>\`, \`<quiz-option>\`, or any PascalCase variant, convert them to \`<answer>\`.

**Do NOT use** the \`:::quiz\` fence syntax — it is not implemented.`)

  // Staged exam pages
  sections.push(`## Staged pages (\`<next-stage>\`)

Split a single document into sequential, hand-in-locked **stages** with a \`<next-stage>\` divider on its own line. Only stages up to the current one are shown; the student clicks a button (with a confirm modal) to advance, which **locks the previous stage read-only and cannot be undone** (it persists across reloads).

Use it to gate later material on handing in earlier work — e.g. **predict-the-output questions in stage 1, runnable code editors in stage 2**, so a student can't run the shown program to obtain the prediction (they must lock their stage-1 answers first). Example:

## Stage 1 — predict the output
…questions + read-only code blocks…

<next-stage label="Hand in & continue">

## Stage 2 — write the program
\`\`\`python editor id="task"
\`\`\`

- Put \`<next-stage>\` on its own line at the top level (not inside a code block).
- All button/modal strings are optional and **overridable for localization**: \`label\` (advance + confirm button), \`title\` (modal heading), \`confirm\` (modal body), \`cancel\` (cancel button).
- One-way: once advanced, the student cannot return to a handed-in stage.
- Most useful on exam pages, but works on any page.`)

  // Slide presentations
  sections.push(`## Slide presentations (\`---\`, \`---/\`, \`---x\`)

Any page can be presented full-screen as slides — the same source renders as a scrolling page OR as a deck, so there is **no special wrapper**. Slides are split from the markdown you already write.

A new slide starts at:
- a level-1 or level-2 heading (\`#\` / \`##\`) — the heading leads the new slide;
- a \`---\` thematic break (this also renders as a horizontal rule on the page);
- a \`---/\` divider on its own line — an **invisible** break that splits slides but renders nothing on the page.

A \`---x\` line **excludes** the following content from the deck, up to the next break/heading — the text still shows on the scrolling page, just not on the slides. Use it for long background prose you don't want projected. Example:

## Photosynthesis
The headline reaction…

---/

## Two stages
- Light reactions
- Calvin cycle

---x

### Teacher notes
Background reading kept on the page but off the slides.

---

## Recap

- Put each marker on its own line at the top level (not inside a fenced code block).
- Empty slides (adjacent breaks, a divider right before a heading) are dropped automatically.
- Interactive components (code editors, quizzes, math) work inside slides.
- Exam pages are not presentable.`)

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
  - Wrong: \`<Question initialCount={7}>\` (PascalCase, JSX) — doesn't error, silently lowercases to \`<question initialcount="{7}">\`, so the attribute is just lost

**Callouts:** \`> [!type] Title on same line\` - CRITICAL: title MUST be on same line as [!type]
  - Types: ${baseTypes.join(', ')}
  - Aliases: lernziele→success, hint→tip, exercise→abstract
  - Collapsible: \`> [!type]-\` (closed) or \`> [!type]+\` (open)
  - WRONG: \`> [!tip]\\n> **Title**\` - NEVER put title on new line!

**Code Editors:** \`\`\`language editor [single] [exam] [output-only] [id="x"] [file="name.py"] [assets="a.csv,b.png"] [allow-upload] [accept="..."] [db="file.db"] [solution="SELECT ..."] [schema-image="name"] [height="500"]\`\`\` — \`output-only\` auto-runs on load and shows just the output/plot (collapsed code, expandable); great for matplotlib figures.
  - Executable: python, javascript, sql, html. Other language IDs only get syntax highlighting.
  - \`html editor\` is special: split view with a sandboxed iframe live-preview (\`allow-scripts allow-modals allow-forms\`, no \`allow-same-origin\`). No exam/python-check pairing.
  - \`single\`: hides file tabs (single-file mode).
  - \`exam\`: silent grading — pair with python-check; student runs code but never sees pass/fail feedback. Use for assessments, NOT practice. Default (no \`exam\`) shows feedback after each "Check" click.
  - \`file="name.py"\`: repeat the fence with the same \`id\` and a different \`file=\` to merge into one multi-tab editor (Python/JS/SQL only, not HTML yet).
  - \`assets="a.csv,b.png"\` / \`allow-upload\` + \`accept="..."\`: teacher-attached read-only files, or let the student upload their own (Python only).
  - \`solution="SELECT ..."\`: SQL only — shows pass/fail after each run. Multi-line: use \`\\n\` literals inside the quotes. \`schema-image="name"\` overrides the auto-generated ER diagram.
  - \`height="500"\`: pixel height of the editor (any language); for HTML this is the editor + preview pane total (default 400).

**Python Checks:** pair \`\`\`python editor id="x"\`\`\` with \`\`\`python-check for="x"\`\`\` containing \`assert\` statements.
  - \`for="<id>"\` is REQUIRED and must match the editor's \`id\` — otherwise the check block is silently dropped.
  - Optional: \`points="10"\`, \`max-checks="5"\`. Check block is never rendered, only runs on "Check".
  - Several \`python-check for="x"\` blocks targeting the same editor become ordered stages (document order) instead of one flat check; each stage can add \`gate-at="<points>"\` and \`label="..."\`.
  - **Turtle exercises:** \`turtle_solution_matches(solution_code, tolerate_rotation=True, match_colors=False)\` (preferred), \`turtle_matches(expected, tolerate_rotation=True)\`, \`turtle_path_matches(expected, tolerance=1.0, tolerate_rotation=True)\`. The first runs a teacher-supplied reference solution through the same recording stub; the runner compares the set of drawn segments. Translation-invariant and, by default, rotation-tolerant. Pass \`match_colors=True\` to also require matching pen colours per segment. Put long solution strings as a setup variable, then \`assert turtle_solution_matches(solution), "..."\`.

**Math:** \`$inline$\` and \`$$display$$\` (KaTeX). Chemistry: \`\\ce{N2(g) + 3 H2(g) <=> 2 NH3(g)}\` (mhchem) — prefer over hand-rolled \`\\mathrm{}\`. Colored terms: \`\\textcolor{orange}{8 \\cdot 1}\`, NEVER \`\\color{orange}...\` — \`\\color\` is an unscoped switch needing a \`\\color{black}\` reset that breaks dark mode (black text invisible on dark background); \`\\textcolor{}{}\` is scoped, so text outside it just stays the normal theme-aware color.

**Images:** \`![alt](img.png)\` or \`<img src="img.png" alt="alt" style="width: 50%" align="left" wrap="true" />\` — add \`nozoom="true"\` to suppress the fullscreen/zoom button (also works on \`<excali>\`).

**Text alignment:** wrap content in \`<left>\`, \`<center>\`, or \`<right>\` — markdown parses inside with or without surrounding blank lines. Closing tag required.

**Videos (Mux):** \`![caption](lecture.mp4)\` — the alt text becomes the caption. Playback options via \`<muxvideo>\`: \`<muxvideo src="intro.mp4" gif />\` (muted autoplay loop, GIF-style), \`autoplay\` (muted), \`loop\`, \`pin\` (corner overlay when scrolled past), \`poster="cover.png"\`, \`alt="caption"\`.

**Custom CSS:** \`<style>.my-class { ... }</style>\` — scoped CSS blocks are supported. Inline \`style="..."\` also works on any element.

**Flex layouts:** \`<flex gap="medium"><flex-item>Left</flex-item><flex-item>Right</flex-item></flex>\` — side-by-side columns that stack on mobile. Items divide space equally by default (no \`width\` needed); set \`width="30%"\` only for deliberately uneven splits. \`<flex>\` takes \`gap\`, \`direction\`, \`justify\`, \`align\`, \`wrap\`. \`<flex-item>\` accepts \`style\`/\`class\` for backgrounds and padding.

**Tabs:** HTML syntax only:
  \`<tabs-container data-items='["Tab1", "Tab2"]'><tab-item>Content1</tab-item><tab-item>Content2</tab-item></tabs-container>\`

**Quiz:** \`<question id="q1" type="single" points="1"><answer correct="true">Right</answer><answer feedback="Nope">Wrong</answer></question>\` — \`points\` (default 1) is the gradable max; choice questions auto-score full points on an exact match, teacher-overridable when grading.
  - \`type\` defaults to \`multiple\` (checkboxes) if omitted — **always set \`type="single"\` explicitly** for a one-answer radio group.
  - Put the question text inside the tag before the answers; it renders as the card heading. Markdown and \`$math$\` work in the prompt, in the answers and in \`feedback="…"\`.
  - Sliders auto-grade when given a target: \`<question type="number" expected="-1" tolerance="0.15">\` (or \`type="range" expected="-1..1"\`), with \`<answer from="0.7" feedback="…">\` bands from best to worst.
  - Use \`correct="true"\` to mark the correct answer
  - If you see \`<Option>\` or \`<quiz-option>\`, convert to \`<answer>\`
  - Do NOT use \`:::quiz\` syntax — it is not implemented

**Free-text auto-check (predict-output):** \`<question id="x" type="text" points="2">\` with an \`\`\`expected fenced block inside (blank line before it) → partial-credit grading by line-exact-match ratio (not fuzzy similarity) of a predicted output, with a diff. Flags: \`ignore-case\`, \`ignore-whitespace\`. Feedback is hidden from students by default (exams AND practice) — set \`showFeedback="true"\` to reveal it during the attempt; teachers see it when grading.

**Staged pages:** \`<next-stage label="..." title="..." confirm="..." cancel="...">\` on its own line splits a document into one-way, hand-in-locked stages (only stages up to the current one render; advancing locks the previous one read-only). Ideal for exams: predict-output questions in stage 1, runnable editors in stage 2. All strings optional/localizable.

**Slide presentations:** any page can be presented full-screen as slides, split from the markdown itself (same source reads as a page OR a deck). A new slide starts at each \`#\`/\`##\` heading, each \`---\` (also a horizontal rule on the page), or \`---/\` (invisible break — splits slides, draws no rule). A \`---x\` line drops the following content from the deck until the next break/heading (still shown on the page) — for background prose you don't want projected. Markers go on their own line outside code blocks; empty slides are dropped; exam pages aren't presentable.

**Code-block copy button:** plain \`\`\`lang code blocks show a copy button; add \`copy=false\` (or \`no-copy\`) to the info string to hide it, \`copy\`/\`copy=true\` to force it. Hidden by default on exam pages.

**Code-block line annotations:** in plain \`\`\`lang blocks, a trailing \`# [!code ++]\` marks a line as added (green), \`[!code --]\` removed (red), \`[!code highlight]\` highlighted, \`[!code focus]\` focused (rest blurred until hover). The marker and its comment are stripped from the rendered code. \`[!code ++:3]\` covers 3 lines; info-string ranges work too: \`\`\`python {2,5-7} add={3} del={9}\`\`\`. Not available in \`editor\` blocks.

**Inline code with a language:** \`code\`{:python} — a language marker right after the closing backtick of inline code gets the same per-token color highlighting as a fenced block, without breaking it out of the sentence. Same language set as code editors/blocks (python, javascript/js, typescript/ts, sql, php, java, cpp, rust, go, html, css, json, xml, yaml). No marker → plain, uncolored inline code (the default).

**YouTube:** \`![caption](https://youtu.be/VIDEO_ID?t=120)\` is the simplest form (alt becomes caption). Or \`<youtube id="VIDEO_ID" startTime={120} caption="..." />\`, or the underlying \`<youtube-embed data-id="VIDEO_ID" data-start-time="120" data-caption="..."></youtube-embed>\`. Use \`playlist\`/\`data-playlist\` for playlists, \`thumbnail\`/\`data-thumbnail\` (filename or URL) for a custom teaser image.

**Flag icons:** \`:flag-en-gb:\` / \`:flag-de-ch:\` inline anywhere in text, e.g. \`## User Manual :flag-en-gb:\`. Only these two codes exist.

**GeoGebra:** \`<geogebra material-id="dNPHaqgb" [show-toolbar="true"] [correct-when="correct"] />\` — embeds an interactive GeoGebra applet by material id (from a geogebra.org share link); auto-fits height by default (add \`height="450"\` to pin). \`correct-when\` captures per-student correctness for the teacher's class tally.

**Spacer:** \`<spacer [pattern="checkered|lines|dots|blank"] [height="200"] [id="sp1"] />\` — blank writing area students solve on by hand with the pens; \`checkered\` is graph paper. Editor gives drag-to-resize + a pattern/delete toolbar; publishes as a plain patterned box.

**CTA button:** \`<cta href="/auth/signup">Create free account</cta>\` — a link styled as a button in the site's own theme; \`label\` instead of children when self-closing, plus \`variant\` (default|secondary|outline|ghost), \`size\` (lg|default|sm), \`align\` (center|left|right). Never draw a button as an image.

**Newsletter:** \`<newsletter [title="..."] [description="..."] [button="..."] />\` — email capture; addresses go to the site's Brevo list, which owns confirmation and unsubscribe.

**AI feedback:** \`<ai-feedback prompt="teacher instructions for the AI" [id="fb1"] [label="Check my solution"] />\` — button for students: sends their pen strokes in the surrounding h1/h2/h3 section (rendered to an image) + the section markdown to a vision model for feedback; pasting a screenshot (hover box, Ctrl+V) works as alternative input. Several tags per page map to their prompts by position (\`id\` optional); requires login.

**Ping:** \`<ping [host="wairualodge.co.nz"] [count="4"] [os="linux|macos|windows"] />\` — interactive terminal; students type \`ping [-c N] host\`. Server-side TCP connect (not ICMP; works where school wifi blocks ICMP). RTT/IP/loss are real; \`host\` auto-runs a demo; requires login; private addresses blocked; top-right button switches OS style.

**Mermaid:** \`\`\`mermaid fenced code block — renders natively, theme-aware.

**Structural formulas:** \`<molecule smiles="CC(=O)Oc1ccccc1C(=O)O" [name="Aspirin"] [width="420"] [height="300"] />\` — chemistry structural formula from SMILES (\`CCO\` ethanol, \`O\` water), server-rendered as an \`<img>\`, so pens and \`<ai-feedback>\` work on it.

**Function plots:** \`\`\`plot fenced code block, one entry per line: \`f(x) = 1/3x^3 - x\` (curve, implicit multiplication allowed), \`x: -4..4\` / \`y: -3..3\` (window, y optional), \`A = (2, 1)\` (point), \`vline x=-1\` / \`hline y=2\`, flags \`grid\`/\`nogrid\`/\`aspect: equal\`/\`size: 640x400\`/\`caption: …\`, per-entry options after a comma (colour word, \`label="…"\`, \`dashed\`, \`thick\`). \`ln\` natural, \`log\` base 10. Renders as a static SVG \`<img>\`, so \`<ai-feedback>\` in the same section captures the graph — the way to build "draw the tangent" tasks.

**Built-in plugins:** \`<plugin src="${BUILTIN_PLUGIN_OWNER}/<slug>" [attrs] [height="500"]></plugin>\` — user-scoped; built-ins on this deployment under \`${BUILTIN_PLUGIN_OWNER}\`:
  - \`mod-calc\` (\`formula\`, \`base\`, \`exp\`, \`mod\`, \`lang\`), \`color-sliders\`, \`cipher-lab\` (\`cipher\`, \`cipherkey\`, \`text\`, \`lang\`)
  - \`mod-clock\` (\`mod\`, \`modmax\`, \`max\`, \`font\`, \`lang\`), \`diffie-hellman\` (\`p\`, \`g\`, \`a\`, \`b\`, \`lang\`)
  - \`dijkstra-visualizer\` (\`initialnodecount\`, \`initialdirected\`, \`initialspeed\` 100..2000 higher=faster, \`lang\`), \`data-cube-visualizer\` (\`lang\`)`
}
