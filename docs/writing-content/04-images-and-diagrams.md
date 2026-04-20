# Images and Diagrams

Drag, drop, done. But a few of Eduskript's image features go beyond the basics — theme-aware Excalidraw drawings that swap with light/dark mode, a curated color palette that stays readable in both themes, and `invert` for hand-drawn black-on-white sketches.

---

## Adding images

### Drag and drop

Drag any image file (PNG, JPG, WebP, GIF, SVG) into the editor. It uploads to your skript's file storage and the markdown is inserted at your cursor automatically.

### Markdown syntax

```markdown
![Caption text](my-image.png)
```

The alt text becomes the visible caption beneath the image. For accessibility, write something descriptive — students using screen readers depend on it.

### HTML syntax with attributes

For more control, use the `<image>` tag:

```html
<image src="my-image.png" width="50%" align="right" wrap />
```

| Attribute | Values | Effect |
|-----------|--------|--------|
| `src` | filename or URL | Image source (required) |
| `alt` | string | Alt text / caption |
| `width` | %, px | Set image width |
| `align` | `left`, `center`, `right` | Horizontal alignment |
| `wrap` | (boolean) | Float image so text wraps around it |
| `invert` | (boolean) | Auto-invert in dark mode (great for hand-drawn sketches) |
| `saturate` | number | Adjust color saturation |

Hovering over an image in the live preview shows resize handles and an alignment toolbar — usually faster than typing attributes.

---

## Excalidraw — theme-aware diagrams

[Excalidraw](https://excalidraw.com) is a sketching tool with a hand-drawn aesthetic. Eduskript integrates it deeply — including a built-in editor (no leaving the page) and **automatic theme switching**: you supply both a light-mode and a dark-mode SVG, and Eduskript serves the right one based on the student's theme.

### The fast path: in-page editor

Click the **Excalidraw button** in the toolbar → opens a drawing canvas inline. Sketch your diagram, click Save. Eduskript:

1. Generates two SVGs (light and dark themes)
2. Uploads both to your skript files
3. Inserts the markdown reference for you

That's the entire workflow. The drawing remains editable — click it later in the preview to re-open the editor.

### The manual path: external Excalidraw

If you prefer Excalidraw's standalone web app or desktop app:

1. Draw your diagram at [excalidraw.com](https://excalidraw.com)
2. **Export → SVG**, with light theme → save as `mydiagram.excalidraw.light.svg`
3. Switch the canvas to dark theme, export again → `mydiagram.excalidraw.dark.svg`
4. Upload both files to your skript
5. Reference in markdown:

```markdown
![A caption for screen readers](mydiagram.excalidraw)
```

Eduskript looks up the `.light.svg` / `.dark.svg` siblings automatically. The `.excalidraw` reference is symbolic — there's no actual `.excalidraw` file (just the two SVGs).

### When to use Excalidraw vs other diagram tools

> [!example] Excalidraw shines for
> - Algorithm flowcharts and state diagrams
> - Database ER diagrams (auto-detected next to SQL editors — see *SQL Studio*)
> - Concept maps and mind diagrams
> - Network topologies, UML class diagrams
> - Anything where a sketchy/hand-drawn look fits better than CAD precision

> [!warning] Excalidraw is less great for
> - Photos (use JPG)
> - Pixel-perfect diagrams (use a vector tool like Figma or Inkscape)
> - Very large diagrams that don't fit in a normal page width

---

## Theme-aware named colors

Markdown colors are a usability trap — `#00BFFF` looks great on white and disappears on black. Eduskript ships a curated **color palette** where each named color has separate light-mode and dark-mode values, picked for legibility in both.

### In running text

The toolbar has a text-color and highlight picker. Either click a swatch from the palette, or write the spans by hand:

```html
The result is <span class="es-color-cyan">42</span>, highlighted in
<span class="es-bg-yellow">yellow</span> for emphasis.
```

**Available text colors** (`es-color-*`): cyan, lightgreen, green, orange, red, blue, violet, purple, lightblue, pink, yellow, white, black, gray.

**Available highlights** (`es-bg-*`): yellow, green, blue, pink, orange, red, purple.

Each switches its hue automatically when the student toggles between light and dark mode.

### In math (KaTeX)

KaTeX's `\textcolor` command accepts the same color names:

```latex
$$\textcolor{cyan}{x}^2 + \textcolor{orange}{y}^2 = \textcolor{lightgreen}{r}^2$$
```

This renders the equation with `x` in cyan, `y` in orange, `r` in lightgreen — and all three swap to their dark-mode-friendly variants when the theme toggles.

> [!info] Custom hex colors
> The toolbar's "Custom color..." picker emits a plain inline-style span with a fixed hex code. It works, but it won't theme-adapt — pick from the palette when you want cross-theme legibility.

---

## Inverting hand-drawn sketches in dark mode

You scanned a chalkboard photo or drew a sketch on white paper. In light mode it looks great. In dark mode it's a glaring white block.

Solution: add `invert`:

```html
<image src="chalk-sketch.jpg" invert />
```

In dark mode, the image is auto-inverted (white becomes dark, black becomes light). Works best for high-contrast black-on-white content like sketches, scanned diagrams, and pen-on-paper notes.

---

## Supported formats

| Format | Best for |
|--------|----------|
| **PNG** | Screenshots, sharp graphics with transparency |
| **JPG** | Photos, anything large you want compressed |
| **WebP** | Better-compressed photos (modern browsers) |
| **SVG** | Vector graphics, icons, diagrams from other tools |
| **GIF** | Short animations |
| **Excalidraw** (`.excalidraw.light.svg` + `.excalidraw.dark.svg`) | Theme-aware editable diagrams |

For videos, see the **Video** chapter — they're handled separately via Mux.

---

## Image cheat sheet

| Goal | Syntax |
|------|--------|
| Centered image with caption | `![Caption](file.png)` |
| Right-aligned at 50% width | `<image src="file.png" width="50%" align="right" />` |
| Floated with text wrapping | `<image src="file.png" width="40%" align="left" wrap />` |
| Theme-aware Excalidraw diagram | `![Caption](mydiagram.excalidraw)` |
| Hand-drawn sketch (auto-invert dark) | `<image src="sketch.png" invert />` |
| Inline themed text color | `<span class="es-color-cyan">text</span>` |
| Inline themed highlight | `<span class="es-bg-yellow">text</span>` |
| Math with theme-aware color | `$\textcolor{orange}{x}$` |
