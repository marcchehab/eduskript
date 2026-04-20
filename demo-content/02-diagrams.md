# Diagrams & Images

Images just work. Drag-and-drop in the editor uploads them. But the real trick: **theme-aware Excalidraw** and **a curated color palette that stays readable in both light and dark mode**.

---

## Theme-aware Excalidraw

Sketch a diagram in Excalidraw — export the SVG twice (once in light theme, once in dark), upload both files with matching names:

```
mydiagram.excalidraw.light.svg
mydiagram.excalidraw.dark.svg
```

Reference it in markdown as if it were one file:

```markdown
![A caption for screen readers](mydiagram.excalidraw)
```

Toggle the page theme — the diagram swaps instantly. No reload.

> [!tip] One-step sketching
> The toolbar's **Excalidraw button** opens a drawing canvas inline. Draw, Save, both SVGs are uploaded for you. No external tools needed.

---

## Theme-aware colors

Plain HTML colors look great in one theme and disappear in the other (cyan on white, dark blue on black). Eduskript ships a palette where each name has **separate light and dark values**.

**In math:**

$$\textcolor{cyan}{x}^2 + \textcolor{orange}{y}^2 = \textcolor{lightgreen}{r}^2$$

**In text:**

<span class="es-color-cyan">cyan</span>, <span class="es-color-lightgreen">lightgreen</span>, <span class="es-color-orange">orange</span>, <span class="es-color-red">red</span>, <span class="es-color-blue">blue</span>, <span class="es-color-violet">violet</span>, <span class="es-color-pink">pink</span>.

**Highlights:** <span class="es-bg-yellow">yellow</span>, <span class="es-bg-green">green</span>, <span class="es-bg-blue">blue</span>, <span class="es-bg-pink">pink</span>.

Toggle the theme. Everything stays clearly legible.

---

## Images with options

```markdown
![Caption](file.png)                                   → centered, full width
<image src="file.png" width="50%" align="right" />     → right-aligned
<image src="file.png" width="40%" align="left" wrap /> → text wraps around it
<image src="sketch.png" invert />                      → auto-invert in dark mode
```

The `invert` attribute is great for scanned sketches — black on white in light mode, white on black in dark mode, automatically.

---

## Cheat sheet

| Goal | Syntax |
|------|--------|
| Theme-aware diagram | `![](diagram.excalidraw)` (after uploading both SVGs) |
| Inline themed color | `<span class="es-color-cyan">text</span>` |
| Inline themed highlight | `<span class="es-bg-yellow">text</span>` |
| Math with themed color | `$\textcolor{orange}{x}$` |
| Auto-invert sketch in dark mode | `<image src="sketch.png" invert />` |
