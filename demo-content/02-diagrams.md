# Diagrams & Images

A picture is still worth a thousand words. Eduskript handles images the obvious way, plus a few not-so-obvious extras: theme-aware diagrams that look right in both light and dark mode, and a curated color palette that stays readable everywhere.

---

## Images

Drag and drop an image straight into the editor — Eduskript uploads it and inserts the markdown for you. Or write it by hand:

```markdown
![A descriptive caption](my-image.png)
```

The alt text becomes the visible caption beneath the image. Drag the corner handles in the rendered preview to resize. Width and alignment can be set directly:

```markdown
<image src="my-image.png" width="50%" align="right" />
```

Supported attributes: `width`, `align` (left, center, right), `wrap` (text flows around), `invert` (auto-invert in dark mode for hand-drawn black-on-white sketches), `saturate`.

---

## Excalidraw — diagrams that adapt to dark mode

[Excalidraw](https://excalidraw.com) is a sketching tool with a hand-drawn aesthetic. Eduskript's integration goes one step further: you upload **two** SVGs, one for light mode and one for dark, and the page automatically shows the right one for each student's theme.

**The workflow:**
1. Draw your diagram in Excalidraw
2. Export as SVG twice — once with the light theme, once with the dark
3. Upload both files to your skript:
   - `my-diagram.excalidraw.light.svg`
   - `my-diagram.excalidraw.dark.svg`
4. Reference it in markdown as if it were one file:

```markdown
![A caption for screen readers](my-diagram.excalidraw)
```

Eduskript figures out which variant to serve based on the active theme. Switch the page's theme with the toggle in the toolbar — the diagram swaps instantly without a page reload.

> [!tip] One-step sketches
> Use the **Excalidraw drawing button** in the toolbar to draw and save in one go — both light and dark SVGs are generated automatically. Great for quick sketches during lesson prep.

> [!example] What works well as Excalidraw
> - Algorithm flowcharts and state diagrams
> - Database ER diagrams (especially for the SQL editor — see *SQL Studio*)
> - Network topologies, UML class diagrams
> - Concept maps and mind diagrams
> - Anything where a polished CAD drawing would be overkill

---

## Theme-aware named colors

Markdown colors typically use literal hex codes or named CSS colors — both of which look terrible in one theme or the other (cyan is invisible on white; dark blue disappears on black). Eduskript ships a curated palette where each color has separate light and dark values, picked for legibility on the active background.

**In math** (KaTeX `\textcolor`):

$$\textcolor{cyan}{\text{plaintext}}^{\textcolor{lightgreen}{k_{pub}}} \mod n = \textcolor{lightgreen}{\text{ciphertext}}$$

$$\textcolor{lightgreen}{1388}^{\textcolor{orange}{k_{priv}}} \mod 3233 = \textcolor{cyan}{97}$$

**In running text** via the toolbar's text-color and highlight buttons (or by hand):

<span class="es-color-cyan">cyan</span>, <span class="es-color-lightgreen">lightgreen</span>, <span class="es-color-green">green</span>, <span class="es-color-orange">orange</span>, <span class="es-color-red">red</span>, <span class="es-color-blue">blue</span>, <span class="es-color-violet">violet</span>, <span class="es-color-purple">purple</span>, and <span class="es-color-lightblue">lightblue</span>.

Highlights work the same way: <span class="es-bg-yellow">yellow</span>, <span class="es-bg-green">green</span>, <span class="es-bg-blue">blue</span>, <span class="es-bg-pink">pink</span>, <span class="es-bg-orange">orange</span>, <span class="es-bg-red">red</span>, <span class="es-bg-purple">purple</span>.

Toggle the page theme — every color stays clearly readable. Old content using `\textcolor{cyan}{...}` or inline hex from the previous toolbar is auto-themed too, no migration needed.

> [!info] Custom hex
> Need a color that's not in the palette? The toolbar's "Custom color..." picker emits a plain inline-style span — it won't be theme-aware but it works. The palette is the recommended path for anything you want to stay legible across modes.

---

## Image cheat sheet

| Goal | Syntax |
|------|--------|
| Centered image with caption | `![Caption text](file.png)` |
| Right-aligned, half width | `<image src="file.png" width="50%" align="right" />` |
| Hand-drawn black-on-white sketch | `<image src="sketch.png" invert />` (auto-inverts in dark) |
| Theme-aware diagram | `![](my-diagram.excalidraw)` (after uploading both SVGs) |
| Inline themed text color | `<span class="es-color-cyan">like this</span>` |
| Inline themed highlight | `<span class="es-bg-yellow">like this</span>` |
