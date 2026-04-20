# Custom Plugins

When the built-in features stop short, build your own. A plugin is a single HTML file that runs as an interactive widget inside your lesson — a modular-arithmetic clock, a Dijkstra visualizer, a 3D molecule viewer, anything.

Sandboxed by default: a strict CSP prevents network access, DOM escape, or data exfiltration. Safe to embed plugins written by anyone.

---

## Embed one in a lesson

```markdown
<plugin src="author-page-slug/plugin-slug" />
```

Pass config as attributes:

```markdown
<plugin src="informatikgarten/mod-clock" mod="7" font="14" lang="de" />
```

The plugin author defines which attributes matter. Browse plugins at **Dashboard → Plugins → Browse**.

---

## Build one in ~30 lines

```html
<div id="app" style="font: 24px sans-serif; padding: 1rem;">
  <button id="dec">−</button>
  <span id="val">0</span>
  <button id="inc">+</button>
</div>

<script>
  const p = eduskript.init()
  let count = 0
  const val = document.getElementById('val')

  p.onReady(({ data, theme }) => {
    count = data?.count ?? 0
    val.textContent = count
    applyTheme(theme)
  })

  p.onThemeChange(applyTheme)

  document.getElementById('inc').onclick = () => {
    val.textContent = ++count
    p.setData({ count })  // saved per student
  }
  document.getElementById('dec').onclick = () => {
    val.textContent = --count
    p.setData({ count })
  }

  function applyTheme(theme) {
    document.body.style.color = theme === 'dark' ? '#eee' : '#222'
  }
</script>
```

Save via **Dashboard → Plugins → New Plugin**. Embed with `<plugin src="your-slug/counter" />`. Done.

---

## SDK cheat sheet

```javascript
const p = eduskript.init()

p.onReady(({ config, data, theme }) => { ... })  // starting state
p.onThemeChange(theme => { ... })                // light/dark toggle
p.onDataChanged(data => { ... })                 // external updates
p.setData({ anything: 'json-serializable' })     // persist per student
p.requestFullscreen()                            // take over the viewport
```

---

## What plugins can load

Scripts from jsdelivr, unpkg, cdnjs. Google Fonts CSS. Nothing else (strict CSP):

```html
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script src="https://unpkg.com/p5@1.7.0/lib/p5.min.js"></script>
```

No `fetch()` to arbitrary URLs. No access to cookies, storage, or the parent page. Fully sandboxed.

---

## AI-assisted generation

**Dashboard → Plugins → New** has a "Generate with AI" option. Describe what you want, get a starting HTML file. Review and iterate.

---

## See in the wild

- `marcchehab/mod-clock` — modular arithmetic visualizer
- `marcchehab/dijkstra` — interactive Dijkstra on a graph
- `marcchehab/excalidraw` — Excalidraw as a plugin (yes, plugins can host plugins)

Full plugin-building guide is in the developer docs.
