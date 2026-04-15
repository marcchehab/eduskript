# Plugins

Create custom interactive components that run in sandboxed iframes. No code review needed — plugins are isolated from the host page.

## Quick Start

### 1. Create a Plugin

Go to **Dashboard > Plugins > New Plugin**, or use the AI generator to describe what you want.

A plugin is a single HTML file with inline CSS and JS:

```html
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; margin: 0; }
  button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; }
</style>

<div id="app">
  <button id="btn">Count: 0</button>
</div>

<script>
  var plugin = eduskript.init();
  var count = 0;

  plugin.onReady(function(ctx) {
    // ctx.config  — attributes from the <plugin> tag
    // ctx.data    — previously saved state, or null
    // ctx.theme   — "light" or "dark"
    if (ctx.data && ctx.data.state) {
      count = ctx.data.state.count || 0;
    }
    document.getElementById('btn').textContent = 'Count: ' + count;
  });

  plugin.onThemeChange(function(theme) {
    document.body.style.background = theme === 'dark' ? '#1a1a1a' : '#fff';
    document.body.style.color = theme === 'dark' ? '#e0e0e0' : '#222';
  });

  document.getElementById('btn').addEventListener('click', function() {
    count++;
    document.getElementById('btn').textContent = 'Count: ' + count;
    plugin.setData({ state: { count: count }, updatedAt: Date.now() });
  });
</script>
```

### 2. Use in Markdown

```markdown
<plugin src="yourPageSlug/counter"></plugin>
```

The `src` format is `ownerPageSlug/pluginSlug` — like GitHub repos.

### 3. Pass Configuration

Attributes on the `<plugin>` tag become `config` properties:

```markdown
<plugin src="yourPageSlug/mod-calc" formula="rsa-enc"></plugin>
```

Inside the plugin, `ctx.config.formula` will be `"rsa-enc"`.

### 4. Pass Content

Text between tags is available as `ctx.config.content`:

```markdown
<plugin src="yourPageSlug/my-diagram">
start -> middle -> end
</plugin>
```

Inside the plugin, `ctx.config.content` will be the text between the tags.

## SDK Reference

The host injects the eduskript SDK into every plugin iframe. Use it like this:

```javascript
var plugin = eduskript.init();
```

### `plugin.onReady(callback)`

Called once when the host sends initial data. Always use this as your entry point.

```javascript
plugin.onReady(function(ctx) {
  // ctx.config  — object of attributes from the <plugin> tag
  // ctx.data    — previously saved state (from setData), or null
  // ctx.theme   — "light" or "dark"
});
```

### `plugin.setData(data)`

Persist state. Data is stored per-user per-page via the UserData service. Max 1MB, rate-limited to 2 calls/second.

```javascript
plugin.setData({ state: { score: 42 }, updatedAt: Date.now() });
```

### `plugin.getData()`

Request current saved state. Returns a Promise.

```javascript
plugin.getData().then(function(data) {
  console.log(data); // { state: { score: 42 }, updatedAt: ... }
});
```

### `plugin.onThemeChange(callback)`

Called when the user toggles light/dark mode.

```javascript
plugin.onThemeChange(function(theme) {
  // theme is "light" or "dark"
});
```

### `plugin.onDataChanged(callback)`

Called when data changes externally (teacher broadcast, multi-device sync).

```javascript
plugin.onDataChanged(function(newData) {
  // Update UI with new data
});
```

### `plugin.resize(height)`

Manually set iframe height. Usually not needed — the SDK auto-detects content height via `ResizeObserver`. Use this only if auto-detection doesn't work for your layout.

```javascript
plugin.resize(500);
```

## Auto-Height

Plugin iframes automatically resize to match their content. The SDK uses a `ResizeObserver` on `document.documentElement` to detect layout changes and reports the new height to the host. This is debounced (100ms) and deduped (only sends when height actually changes).

You don't need to do anything for this to work. If your plugin has dynamic content that changes height (accordions, tabs, etc.), the iframe will adjust automatically.

## Security Model

Plugins run in sandboxed iframes with a strict Content-Security-Policy:

- **No network access** — `connect-src` blocks `fetch()`, `XMLHttpRequest`, and `WebSocket`
- **CDN scripts only** — `script-src` allows inline scripts + jsdelivr, unpkg, cdnjs
- **No host access** — plugin cannot read the host page's DOM, cookies, or storage
- **Data is mediated** — all persistence goes through the host via `postMessage`, validated and rate-limited

### Allowed CDNs

You can load libraries from these CDNs:

- `https://cdn.jsdelivr.net`
- `https://unpkg.com`
- `https://cdnjs.cloudflare.com`

Example with Three.js:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
// ...
</script>
```

Example with Mermaid:

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
```

## Theme Support

Plugins should support both light and dark modes. The theme is provided in `onReady` and updated via `onThemeChange`.

The iframe's `<html>` element has `color-scheme: light` or `color-scheme: dark` set automatically, so browser defaults (scrollbars, form controls) match the theme.

A typical pattern:

```javascript
function applyTheme(theme) {
  var isDark = theme === 'dark';
  document.body.style.background = isDark ? '#1a1a1a' : '#fff';
  document.body.style.color = isDark ? '#e0e0e0' : '#222';
  // Update any other themed elements...
}

plugin.onReady(function(ctx) { applyTheme(ctx.theme); });
plugin.onThemeChange(applyTheme);
```

## Sharing

All plugins are visible to all teachers. Reference any teacher's plugin by `ownerPageSlug/pluginSlug`:

```markdown
<plugin src="marie/periodic-table"></plugin>
```

If Marie updates her plugin, everyone using it gets the update immediately. To customize someone else's plugin, fork it from the dashboard — this creates a copy under your namespace.

## Coding Guidelines

- Use `var` instead of `let`/`const` for maximum compatibility in the sandbox
- Always call `eduskript.init()` and use `plugin.onReady()` as your entry point
- Support both light and dark themes
- Don't include `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` tags — the host wraps your output
- Keep it self-contained — all CSS and JS inline

## Example Plugins

See `scripts/seed-plugins/` for reference implementations at various complexity levels:

| File | Complexity | Key Pattern |
|---|---|---|
| `color-sliders.html` | Simple | Pure vanilla JS, no dependencies |
| `mod-calc.html` | Simple | Config via attributes (`formula`), BigInt math |
| `cipher-lab.html` | Medium | Multiple modes, clipboard API, tabs |
| `data-cube-visualizer.html` | Complex | Three.js via ES module importmap, 3D rendering |
| `dijkstra-visualizer.html` | Complex | SVG canvas, algorithm visualization, drag/zoom |

Run `node scripts/seed-plugins.mjs [pageSlug]` to seed these into your local database.

## API

Plugins are stored in the database and managed via REST API:

- `GET /api/plugins` — list all plugins (optional `?author=pageSlug` filter)
- `POST /api/plugins` — create a plugin
- `GET /api/plugins/:ownerSlug/:pluginSlug` — get plugin details
- `PUT /api/plugins/:ownerSlug/:pluginSlug` — update (author only)
- `DELETE /api/plugins/:ownerSlug/:pluginSlug` — delete (author only)
- `POST /api/plugins/:ownerSlug/:pluginSlug/fork` — fork to your library
- `POST /api/plugins/generate` — AI-generate a plugin from a description
