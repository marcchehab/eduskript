# Plugins

Custom interactive components that run in sandboxed iframes. A plugin is a single HTML file with inline CSS and JS, isolated from the host page via strict CSP — safe to embed untrusted code because it can't escape its iframe.

For the user-facing side (embedding in pages), see the **Plugins** chapter in the Components skript. This page covers **building** a plugin from scratch.

---

## Quick start

### 1. Create a plugin

Go to **Dashboard → Plugins → New Plugin**, or use the **AI generator** to describe what you want and get a starting HTML file.

A plugin is a single HTML fragment with inline CSS and JS:

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
    if (ctx.data && typeof ctx.data.count === 'number') {
      count = ctx.data.count;
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
    plugin.setData({ count: count });
  });
</script>
```

Don't include `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` — the host injects those.

### 2. Use in markdown

```markdown
<plugin src="yourPageSlug/counter"></plugin>
```

The `src` format is `ownerPageSlug/pluginSlug` — like GitHub repos.

### 3. Pass configuration

Attributes on the `<plugin>` tag become `config` properties:

```markdown
<plugin src="yourPageSlug/mod-calc" formula="rsa-enc"></plugin>
```

Inside the plugin, `ctx.config.formula` will be `"rsa-enc"`.

### 4. Pass content

Text between tags is available as `ctx.config.content`:

```markdown
<plugin src="yourPageSlug/my-diagram">
start -> middle -> end
</plugin>
```

Inside the plugin, `ctx.config.content` will be the text between the tags.

---

## SDK reference

The host injects the `eduskript` SDK into every plugin iframe:

```javascript
var plugin = eduskript.init();
```

### `plugin.onReady(callback)`

Called once when the host sends initial data. Always use this as your entry point — don't assume `ctx` is available before `onReady` fires.

```javascript
plugin.onReady(function(ctx) {
  // ctx.config  — object of attributes from the <plugin> tag
  // ctx.data    — previously saved state (from setData), or null
  // ctx.theme   — "light" or "dark"
});
```

### `plugin.setData(data)`

Persist state. Data is stored per-user per-page via the `UserData` service. Max 1MB, rate-limited to 2 calls/second.

```javascript
plugin.setData({ count: 42, updatedAt: Date.now() });
```

### `plugin.getData()`

Request current saved state. Returns a Promise.

```javascript
plugin.getData().then(function(data) {
  console.log(data);
});
```

Usually redundant with `onReady` — most plugins don't need this.

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

Manually set iframe height in pixels. Usually not needed — the SDK auto-detects content height via `ResizeObserver`. Use this only if auto-detection doesn't work for your layout (e.g. absolutely-positioned content).

```javascript
plugin.resize(500);
```

### `plugin.requestFullscreen()` / `plugin.exitFullscreen()`

Toggle plugin fullscreen mode. The iframe takes over the browser viewport; escape key and your own exit UI return to inline.

```javascript
document.getElementById('fullscreen-btn').onclick = function() {
  plugin.requestFullscreen();
};

plugin.onFullscreenChange(function(isFullscreen) {
  // Update UI if needed
});
```

Useful for visualization plugins (graphs, simulations, maps) that need more space than a page allows.

---

## Auto-height

Plugin iframes automatically resize to match their content. The SDK uses `ResizeObserver` on `document.documentElement` to detect layout changes and reports the new height to the host. This is debounced (100ms) and deduped (only sends when height actually changes).

You don't need to do anything for this to work. If your plugin has dynamic content that changes height (accordions, tabs, expanded sections), the iframe adjusts automatically.

---

## Security model

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
- Google Fonts CSS (`https://fonts.googleapis.com`, `https://fonts.gstatic.com`)

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

Example with D3:

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
```

---

## Theme support

Plugins should support both light and dark modes. Theme is provided in `onReady` and updated via `onThemeChange`.

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

---

## AI-generated plugins

The **Plugins → New Plugin** form has a "Generate with AI" option. Describe what you want, get a starting HTML file. Under the hood it uses Claude with access to the plugin SDK reference.

Useful for:
- Rapid prototyping ("give me a counter that shows primes")
- Exploring what's possible when you're not sure
- Creating variations on existing plugins

Always review and test the generated code before publishing — AI can produce plausible but broken output.

---

## Sharing

All plugins are visible to all teachers by default. Reference any teacher's plugin by `ownerPageSlug/pluginSlug`:

```markdown
<plugin src="marie/periodic-table"></plugin>
```

If Marie updates her plugin, everyone using it gets the update immediately. To customize someone else's plugin, **fork** it from the dashboard — this creates a copy under your namespace.

---

## Coding guidelines

- Use `var` instead of `let`/`const` for maximum compatibility in the sandbox (some older browsers still hit this)
- Always call `eduskript.init()` and use `plugin.onReady()` as your entry point
- Support both light and dark themes
- Don't include `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` tags — the host wraps your output
- Keep it self-contained — all CSS and JS inline
- Test at different iframe widths — the host doesn't guarantee a minimum width

---

## Reference implementations

See `scripts/seed-plugins/` for plugins at various complexity levels:

| File | Complexity | Key pattern |
|------|------------|-------------|
| `color-sliders.html` | Simple | Pure vanilla JS, no dependencies |
| `mod-calc.html` | Simple | Config via attributes (`formula`), BigInt math |
| `cipher-lab.html` | Medium | Multiple modes, clipboard API, tabs |
| `data-cube-visualizer.html` | Complex | Three.js via ES module importmap, 3D rendering |
| `dijkstra-visualizer.html` | Complex | SVG canvas, algorithm visualization, drag/zoom |

Run `node scripts/seed-plugins.mjs [pageSlug]` to seed these into your local database.

---

## API endpoints

Plugins are stored in the database and managed via REST:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plugins` | List plugins (optional `?author=pageSlug` filter) |
| POST | `/api/plugins` | Create a plugin |
| GET | `/api/plugins/:ownerSlug/:pluginSlug` | Get plugin details |
| PUT | `/api/plugins/:ownerSlug/:pluginSlug` | Update (author only) |
| DELETE | `/api/plugins/:ownerSlug/:pluginSlug` | Delete (author only) |
| POST | `/api/plugins/:ownerSlug/:pluginSlug/fork` | Fork to your library |
| POST | `/api/plugins/generate` | AI-generate a plugin from a description |

---

## Lifecycle summary

1. Teacher writes HTML + JS with the SDK
2. Saves via dashboard → stored in DB with `slug` and `ownerPageSlug`
3. Another teacher embeds `<plugin src="owner/slug" />` in a page
4. Rendered page loads iframe with CSP, host injects SDK
5. Plugin calls `eduskript.init().onReady(...)` to register
6. Host responds with `{ config, data, theme }` — plugin renders
7. On interaction, plugin calls `setData({...})` → host persists to UserData
8. On theme toggle, host sends `onThemeChange` → plugin re-renders
