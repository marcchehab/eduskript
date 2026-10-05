/**
 * Shared instructions for authoring a Plugin `entryHtml` — the Plugin SDK
 * contract, CSP constraints, and theming convention. Single source of truth
 * for anything that generates or writes plugin HTML: the dashboard's
 * AI generator (src/app/api/plugins/generate/route.ts) and the MCP
 * create_plugin tool (src/lib/mcp/tools/create-plugin.ts) both use this.
 *
 * Keep in sync with the actual sandbox implementation in src/lib/plugin-sdk.ts
 * (PLUGIN_SDK_SOURCE, PLUGIN_CSP) — this is documentation of that contract,
 * not the contract itself.
 */
export const PLUGIN_AUTHORING_PROMPT = `You are an expert plugin generator for Eduskript, an education platform.
You create self-contained HTML plugins that run inside sandboxed iframes.

## Plugin SDK

The host injects an SDK, but ONLY when embedded in Eduskript — always feature-detect
before using it, so the same HTML also runs standalone (e.g. pasted into a static page):

\`\`\`js
if (typeof window.eduskript !== 'undefined') {
  var plugin = eduskript.init();

  // Called once when the host sends initial data
  plugin.onReady(function(ctx) {
    // ctx.config  — attributes from markdown (e.g., { mode: "quiz" })
    // ctx.data    — previously saved state, or null
    // ctx.theme   — "light" or "dark"
  });

  // Persist state (host validates: <1MB, rate-limited 2/s)
  plugin.setData({ state: { /* your data */ }, updatedAt: Date.now() });

  // Request current saved state
  plugin.getData().then(function(data) { /* ... */ });

  // React to theme changes
  plugin.onThemeChange(function(theme) { /* "light" or "dark" */ });

  // React to external data changes (teacher broadcast, multi-device sync)
  plugin.onDataChanged(function(data) { /* ... */ });

  // Resize the iframe (host auto-adjusts)
  plugin.resize(height);
}
\`\`\`

## Constraints

- Output ONLY the HTML body content (no <!DOCTYPE>, <html>, <head>, or <body> tags — the host wraps your output)
- Use inline <style> and <script> tags
- Default to fully self-contained: no CDN libraries unless the task genuinely needs one.
  If you must, you CAN use cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com — but prefer inlining.
- You CANNOT use fetch(), XMLHttpRequest, or WebSocket (blocked by CSP)
- Theme with CSS, not just the JS callback: the host sets a data-theme="dark" /
  data-theme="light" attribute on <html>, so style with
  :root[data-theme="dark"] { ... } (and fall back to prefers-color-scheme for
  when there's no host). Still call onThemeChange for anything canvas/JS-drawn.
- Use 'var' instead of 'let/const' for maximum browser compatibility in the sandbox
- Keep it simple, educational, and visually polished
- Always feature-detect window.eduskript before calling init()/onReady()`


/**
 * Extract the plugin HTML from a model response.
 *
 * Models sometimes ignore "output only HTML" and answer with chat prose plus a
 * fenced block ("Here's a quiz...\n```html\n<style>..."). If a line-start fence
 * exists, keep only the content between the first opening fence and the LAST
 * line-start closing fence (or to the end if unclosed); prose before/after is
 * dropped. Without a fence, or when a line starting with "<" comes before the
 * first fence (fence is part of the plugin itself), the trimmed text is
 * returned as-is.
 *
 * Limitation: if the model emits two separate fenced blocks (e.g. html + a js
 * snippet), everything between the first opening and the last closing fence is
 * kept, including the inner fence lines and any prose between the blocks.
 */
export function extractPluginHtml(text: string): string {
  const open = /^```[\w-]*[ \t]*$/m.exec(text)
  if (!open) return stripUnfencedProse(text.trim())
  // HTML already started before the first fence: the fence is inside the
  // plugin (e.g. a markdown string in a <script>), not a wrapper.
  const firstTagLine = text.search(/^[ \t]*</m)
  if (firstTagLine !== -1 && firstTagLine < open.index) return stripUnfencedProse(text.trim())
  const body = text.slice(open.index + open[0].length)
  const closes = [...body.matchAll(/^```[ \t]*$/gm)]
  const last = closes[closes.length - 1]
  return (last ? body.slice(0, last.index) : body).trim()
}

/**
 * No fence: drop prose lines before the first line that starts with "<" and
 * after the last line that ends with ">". Heuristic — a plugin whose last line
 * is not a tag (rare: the model always closes with </script> or </div>) loses
 * that trailing text.
 */
function stripUnfencedProse(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^\s*</.test(l))
  if (start === -1) return text
  let end = lines.length - 1
  while (end > start && !/>\s*$/.test(lines[end])) end--
  return lines.slice(start, end + 1).join('\n').trim()
}

const SUMMARY_RE = /<!--\s*summary:\s*([\s\S]*?)-->/i
const QUESTION_RE = /<!--\s*question:\s*([\s\S]*?)-->/i
const NEEDS_TEMPLATE_RE = /<!--\s*needs-template:\s*([\s\S]*?)-->/i

/**
 * Split a generate response into the plugin HTML, the model's one-sentence
 * summary of the step, an optional clarifying question (asked instead of
 * guessing when the request was unclear) and an optional template request
 * (real outlines needed but no template fits). Question and template request
 * only count when no HTML came back.
 * Contract: see the "Output Format" section in api/plugins/generate/route.ts.
 */
export function parsePluginResponse(text: string): { html: string; summary: string | null; question: string | null; needsTemplate: string | null } {
  const summary = SUMMARY_RE.exec(text)?.[1].trim() || null
  const question = QUESTION_RE.exec(text)?.[1].trim() || null
  const needsTemplate = NEEDS_TEMPLATE_RE.exec(text)?.[1].trim() || null
  const html = extractPluginHtml(text.replace(SUMMARY_RE, '').replace(QUESTION_RE, '').replace(NEEDS_TEMPLATE_RE, ''))
  const hasHtml = /<[a-z!]/i.test(html)
  return { html: hasHtml ? html : '', summary, question: hasHtml ? null : question, needsTemplate: hasHtml ? null : needsTemplate }
}
