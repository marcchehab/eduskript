# Custom Plugins

When the built-in features stop short, build your own. A plugin is a single HTML file that runs as an interactive widget inside your lesson — a modular-arithmetic clock, a Dijkstra visualizer, a custom polling tool, anything you can build with HTML/CSS/JS.

The whole system is two things: a sandboxed iframe in the page, and a tiny JavaScript SDK that connects it to the host. That's it.

---

## Embedding a plugin

Once a plugin exists (yours or someone else's), embedding it is one line:

```markdown
<plugin src="author-page-slug/plugin-slug" />
```

Pass any custom config as attributes:

```markdown
<plugin
  src="informatikgarten/mod-clock"
  max="100" mod="7" font="14" lang="de"
/>
```

Those attributes are forwarded to the plugin as a config object — see *receiving config* below. Plugin authors can use any attribute names they want; the host doesn't validate against an allowlist.

> [!info] Sandboxed by default
> Every plugin runs in a sandboxed `<iframe>` with a strict Content-Security-Policy. It can't `fetch()` arbitrary URLs, can't access cookies, can't escape into the parent page. The only communication channel is `postMessage` — handled for you by the SDK.

---

## How plugins work, in one diagram

```
┌────────────────────────────────────────────┐
│  Eduskript page                            │
│                                            │
│   ┌─────────────────────────────────┐      │
│   │  <iframe sandbox>               │      │
│   │                                 │      │
│   │   Your plugin HTML + JS         │      │
│   │                                 │      │
│   │   const p = eduskript.init()    │      │
│   │   p.onReady(({config, data,     │      │
│   │              theme}) => {...})  │      │
│   │   p.setData({score: 5})         │      │
│   │                                 │      │
│   └────────────┬────────────────────┘      │
│                │                           │
│                ▼ postMessage               │
│         Host receives, persists,           │
│         relays theme changes               │
└────────────────────────────────────────────┘
```

When the page loads:
1. The host renders an iframe and injects the SDK script
2. The plugin calls `eduskript.init().onReady(...)` to declare it's ready
3. The host responds with `host:init` containing **config** (your attributes), **data** (per-student saved state), and **theme** (`'light'` or `'dark'`)
4. The plugin renders accordingly

When the student interacts:
- Plugin calls `setData({...})` → host saves it to the user's `UserData` row, keyed per page + per plugin
- Plugin calls `resize(h)` → host resizes the iframe (auto-handled by the SDK via ResizeObserver, so you usually don't need this)

When the student switches theme:
- Host sends `host:themeChange` → plugin's `onThemeChange` callback fires

---

## Building your first plugin

A plugin is a single HTML file. Here's a complete example — a counter that remembers its value per student:

```html
<div id="counter" style="font: 24px sans-serif; padding: 1rem;">
  <button id="dec">−</button>
  <span id="val">0</span>
  <button id="inc">+</button>
</div>

<script>
  const p = eduskript.init()

  let count = 0
  const val = document.getElementById('val')

  p.onReady(({ config, data, theme }) => {
    // Restore saved state if it exists
    count = data?.count ?? 0
    val.textContent = count

    // Apply theme — config.background or theme === 'dark' would let you swap CSS
    if (theme === 'dark') document.body.style.color = '#eee'
  })

  p.onThemeChange((theme) => {
    document.body.style.color = theme === 'dark' ? '#eee' : '#222'
  })

  document.getElementById('inc').onclick = () => {
    count++
    val.textContent = count
    p.setData({ count })  // persist per student
  }
  document.getElementById('dec').onclick = () => {
    count--
    val.textContent = count
    p.setData({ count })
  }
</script>
```

Save this as your plugin's entry HTML. The next section covers how to upload it.

---

## The SDK API

`eduskript.init()` returns an object with these methods:

| Method | What it does |
|--------|--------------|
| `onReady(cb)` | Register a callback that fires once with `{ config, data, theme }`. Call this on plugin startup. |
| `onThemeChange(cb)` | Fires when the user switches between light/dark mode. Argument is `'light'` or `'dark'`. |
| `onDataChanged(cb)` | Fires when the persisted data changes from somewhere other than this plugin instance (e.g. another tab). |
| `getData()` | Returns a Promise resolving to the current saved data. Mostly redundant with `onReady`. |
| `setData(data)` | Persists `data` (any JSON-serializable object) for this plugin + this student + this page. |
| `resize(height)` | Manually request a height. Usually not needed — the SDK auto-resizes via ResizeObserver. |
| `requestFullscreen()` / `exitFullscreen()` | Toggle plugin fullscreen mode. `onFullscreenChange(cb)` fires on transitions. |

---

## Publishing a plugin

Go to **Dashboard → Plugins**. Create a new plugin with:

- **Slug** — URL-safe identifier (e.g. `mod-clock`). Becomes part of the embed URL: `your-page-slug/mod-clock`.
- **Name** — human-readable title shown in the plugin browser.
- **Description** — one-liner shown in the listings.
- **Entry HTML** — the file you just wrote.
- **Manifest** — small JSON describing defaults:

```json
{
  "defaultHeight": 400,
  "configSchema": {
    "max": { "type": "number", "default": 100 },
    "mod": { "type": "number", "default": 7 }
  }
}
```

`defaultHeight` is the iframe's initial height (the SDK will auto-resize after content renders). `configSchema` is informational for now — it documents what attributes the plugin understands, helpful for whoever embeds it.

Once published, anyone can embed your plugin with `<plugin src="your-page-slug/your-plugin-slug" />`. They can also **fork** it to make their own variant.

> [!tip] AI-assisted plugin generation
> The plugins dashboard has a "Generate with AI" option — describe what you want, get a starting HTML file. Useful for prototyping; review and edit before publishing.

---

## Loading external libraries

The plugin sandbox's CSP allows scripts from a few CDNs:
- `cdn.jsdelivr.net`
- `unpkg.com`
- `cdnjs.cloudflare.com`
- Google Fonts (CSS)

So you can `<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>` and use D3, or `<script src="https://unpkg.com/p5@1.7.0/lib/p5.min.js"></script>` for p5.js sketches. `fetch()` to other origins is blocked — by design, to prevent plugins from leaking student data anywhere.

---

## Plugin examples in the wild

Real plugins built with this system:

- **`marcchehab/mod-clock`** — modular arithmetic visualizer; click numbers, see residue classes
- **`marcchehab/dijkstra`** — interactive Dijkstra walkthrough on a graph
- **`marcchehab/excalidraw`** — embedded Excalidraw drawing tool (yes, plugins can host plugins)

Browse them in **Dashboard → Plugins → Browse**.

---

## Plugin cheat sheet

| Goal | Syntax / API |
|------|--------------|
| Embed a plugin | `<plugin src="owner-slug/plugin-slug" />` |
| Pass config | `<plugin src="..." myparam="value" myflag="true" />` (any attribute name) |
| Set initial height | `<plugin src="..." height="500" />` |
| Read config inside plugin | `p.onReady(({ config }) => { ... })` |
| Persist student state | `p.setData({ ...anything... })` |
| React to theme change | `p.onThemeChange(theme => { ... })` |
| Load a library | `<script src="https://cdn.jsdelivr.net/npm/lib"></script>` |
