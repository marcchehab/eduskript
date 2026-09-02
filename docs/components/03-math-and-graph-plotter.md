# Math and Graph Plotter

Mathematical notation rendered with [KaTeX](https://katex.org/). Fast, beautiful, supports nearly all standard LaTeX commands. This page also covers the two ways to plot a function — natively, or with Python — and embedding interactive GeoGebra applets.

---

## Inline and block

**Inline math**: wrap with single `$`.

```markdown
The area of a circle is $A = \pi r^2$.
```

The area of a circle is $A = \pi r^2$.

**Block math**: wrap with double `$$`.

```markdown
$$
E = mc^2
$$
```

$$
E = mc^2
$$

Block math is centered and gets its own paragraph. Inline math flows with the surrounding text.

---

## Common syntax

### Fractions

```latex
$\frac{a}{b}$
$\frac{x+1}{x-1}$
$\dfrac{1}{2}$  → display-style (always large)
$\tfrac{1}{2}$  → text-style (always small)
```

$\frac{a}{b}$, $\frac{x+1}{x-1}$, $\dfrac{1}{2}$, $\tfrac{1}{2}$

### Exponents and subscripts

```latex
$x^2$            → x squared
$x_i$            → x subscript i
$x_i^2$          → both
$x^{2n+1}$       → multi-character exponent (use braces)
```

$x^2$, $x_i$, $x_i^2$, $x^{2n+1}$

### Roots

```latex
$\sqrt{x}$
$\sqrt[3]{x}$
$\sqrt[n]{x+y}$
```

$\sqrt{x}$, $\sqrt[3]{x}$, $\sqrt[n]{x+y}$

### Greek letters

```latex
$\alpha, \beta, \gamma, \delta, \epsilon$
$\pi, \sigma, \theta, \omega$
$\Gamma, \Delta, \Pi, \Sigma, \Omega$  → uppercase
```

$\alpha, \beta, \gamma, \delta, \epsilon, \pi, \sigma, \theta, \omega$

### Sums, products, integrals

```latex
$\sum_{i=1}^{n} x_i$
$\prod_{i=1}^{n} x_i$
$\int_0^1 x^2 \, dx$
$\iint_D f(x,y) \, dx \, dy$
$\lim_{x \to \infty} f(x)$
```

$\sum_{i=1}^{n} x_i$, $\prod_{i=1}^{n} x_i$, $\int_0^1 x^2 \, dx$, $\lim_{x \to \infty} f(x)$

### Matrices

```latex
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$
```

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

Matrix variants: `pmatrix` (parens), `bmatrix` (brackets), `Bmatrix` (braces), `vmatrix` (single bars), `Vmatrix` (double bars).

### Aligned equations

```latex
$$
\begin{aligned}
x + y &= 10 \\
x - y &= 4 \\
2x &= 14 \\
x &= 7
\end{aligned}
$$
```

$$\begin{aligned} x + y &= 10 \\ x - y &= 4 \\ 2x &= 14 \\ x &= 7 \end{aligned}$$

The `&` aligns the equations; in this case, all on the equals sign.

### Cases

```latex
$$
f(x) = \begin{cases}
  x^2 & \text{if } x \geq 0 \\
  -x^2 & \text{if } x < 0
\end{cases}
$$
```

$$f(x) = \begin{cases} x^2 & \text{if } x \geq 0 \\ -x^2 & \text{if } x < 0 \end{cases}$$

### Common operators

```latex
$\sin x, \cos x, \tan x, \log x, \ln x, \exp x$
$\min, \max, \arg, \det, \dim$
$x \cdot y, x \times y, x \div y$
$x \leq y, x \geq y, x \neq y, x \approx y, x \equiv y$
$x \in A, A \subset B, A \cup B, A \cap B$
$\forall x, \exists y, \nexists z$
$\to, \rightarrow, \Rightarrow, \mapsto$
```

---

## Theme-aware colors in math

KaTeX's `\textcolor` command supports Eduskript's named color palette — every color has a separate light-mode and dark-mode value, picked for legibility on both backgrounds.

```latex
$$\textcolor{cyan}{x}^{\textcolor{lightgreen}{n}} + \textcolor{orange}{y}^{\textcolor{lightgreen}{n}} = \textcolor{red}{z}^{\textcolor{lightgreen}{n}}$$
```

$$\textcolor{cyan}{x}^{\textcolor{lightgreen}{n}} + \textcolor{orange}{y}^{\textcolor{lightgreen}{n}} = \textcolor{red}{z}^{\textcolor{lightgreen}{n}}$$

Toggle the page theme — every color stays clearly readable.

**Available palette colors:** `cyan`, `lightgreen`, `green`, `orange`, `red`, `blue`, `violet`, `purple`, `lightblue`, `pink`, `yellow`, `white`, `black`, `gray`.

You can also use raw hex values (`\textcolor{#ff0000}{x}`), but those won't theme-adapt.

---

## Text inside math

Use `\text{...}` for words inside a math expression:

```latex
$P(\text{heads}) = 0.5$
$\text{velocity} = \frac{\text{distance}}{\text{time}}$
```

$P(\text{heads}) = 0.5$, $\text{velocity} = \frac{\text{distance}}{\text{time}}$

---

## Spacing tweaks

LaTeX usually picks correct spacing, but sometimes you want to nudge it:

| Command | Spacing |
|---------|---------|
| `\,` | small space |
| `\;` | medium space |
| `\quad` | large space |
| `\qquad` | extra large space |
| `\!` | negative small space |

Useful for differentials in integrals: `\int x^2 \, dx`.

---

## When KaTeX limits matter

KaTeX renders fast (synchronous, no async load) but supports a subset of LaTeX. Most teaching content fits within the supported subset. Things that don't work:

- Custom packages (e.g. `\usepackage{tikz}` — KaTeX has no preamble system)
- Some less-common environments (`gather*` for example — use `aligned` or `gathered`)
- Custom macros defined in the source (define them upstream if you need them)

Full supported-commands list: [katex.org/docs/supported](https://katex.org/docs/supported).

---

## Function plots

A ```` ```plot ```` fenced code block draws a function graph natively — no Python, no editor, just a static SVG. One entry per line:

````markdown
```plot
f(x) = 1/3x^3 - x
x: -4..4
y: -3..3
A = (2, 1)
vline x=-1
grid
caption: A cubic with a marked point
```
````

**Entry types:**

| Entry | Meaning |
|-------|---------|
| `f(x) = ...` | a curve (implicit multiplication allowed: `1/3x^3` works) |
| `x: -4..4` | the x window |
| `y: -3..3` | the y window (optional — auto-fit if omitted) |
| `A = (2, 1)` | a labeled point |
| `vline x=-1` | a vertical line |
| `hline y=2` | a horizontal line |

**Flags:** `grid` / `nogrid`, `aspect: equal`, `size: 640x400`, `caption: ...`.

Per-entry options go after a comma on the same line: a colour word, `label="..."`, `dashed`, `thick` — e.g. `f(x) = x^2, red, thick, label="parabola"`. Use `ln` for natural log, `log` for base 10.

Because the plot renders as a static `<img>`, an `<ai-feedback>` tag in the same section captures it along with any pen strokes drawn on top — the way to build "sketch the tangent at x=1" tasks. See **Code Editors & Scoring** for `<ai-feedback>` details.

---

## Plotting with Python (matplotlib)

The native `plot` block above covers most "graph this function" needs. For anything that needs real computation first — plotting data, a numerical simulation, a matplotlib figure with subplots — use a regular Python editor instead:

````markdown
```python editor output-only
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(-4, 4, 200)
plt.plot(x, x**3 / 3 - x)
plt.grid(True)
plt.show()
```
````

`output-only` auto-runs the code on page load and shows just the resulting figure (code collapsed, expandable) — see **Code Editors & Scoring** for the full rundown of editor options, scoring, and the Python/JavaScript/SQL runtimes.

---

## GeoGebra

Embed an interactive GeoGebra applet by its material ID (the id from a geogebra.org share link):

```html
<geogebra material-id="dNPHaqgb" show-toolbar="true" />
```

- `material-id` (required) — from the GeoGebra share link
- `show-toolbar="true"` — shows GeoGebra's own editing toolbar (omit for a clean viewer)
- `height="450"` — pins a fixed height; by default the embed auto-fits its content
- `correct-when="correct"` — captures per-student correctness for the teacher's class tally, for applets that expose a correctness state

Good for constructions students manipulate directly — dragging points, exploring transformations — rather than a static plot.

---

## Math and plotting cheat sheet

| Goal | Syntax |
|------|--------|
| Inline math | `$x = y$` |
| Block math | `$$x = y$$` |
| Fraction | `\frac{num}{den}` |
| Exponent | `x^2`, `x^{n+1}` |
| Subscript | `x_i`, `x_{ij}` |
| Greek letter | `\alpha`, `\Sigma` |
| Square root | `\sqrt{x}` |
| Sum | `\sum_{i=1}^{n}` |
| Integral | `\int_a^b` |
| Matrix | `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` |
| Aligned equations | `\begin{aligned} ... \\ ... \end{aligned}` |
| Cases | `\begin{cases} ... \\ ... \end{cases}` |
| Text in math | `\text{word}` |
| Themed color | `\textcolor{cyan}{x}` |
| Small space | `\,` |
| Native function plot | ` ```plot ` fenced block |
| Python/matplotlib plot | ` ```python editor output-only ` |
| GeoGebra applet | `<geogebra material-id="..." />` |
