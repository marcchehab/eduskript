# Mathematik und Funktionsplotter

Mathematische Notation, gerendert mit [KaTeX](https://katex.org/). Schnell, schön, unterstützt fast alle Standard-LaTeX-Befehle. Diese Seite behandelt auch die zwei Wege, eine Funktion zu plotten — nativ oder mit Python — sowie das Einbetten interaktiver GeoGebra-Applets.

---

## Inline und Block

**Inline-Mathematik**: mit einfachem `$` umschliessen.

```markdown
Die Fläche eines Kreises ist $A = \pi r^2$.
```

Die Fläche eines Kreises ist $A = \pi r^2$.

**Block-Mathematik**: mit doppeltem `$$` umschliessen.

```markdown
$$
E = mc^2
$$
```

$$
E = mc^2
$$

Block-Mathematik wird zentriert und erhält einen eigenen Absatz. Inline-Mathematik fliesst mit dem umgebenden Text.

---

## Gängige Syntax

### Brüche

```latex
$\frac{a}{b}$
$\frac{x+1}{x-1}$
$\dfrac{1}{2}$  → Display-Stil (immer gross)
$\tfrac{1}{2}$  → Text-Stil (immer klein)
```

$\frac{a}{b}$, $\frac{x+1}{x-1}$, $\dfrac{1}{2}$, $\tfrac{1}{2}$

### Exponenten und Indizes

```latex
$x^2$            → x hoch 2
$x_i$            → x mit Index i
$x_i^2$          → beides
$x^{2n+1}$       → mehrstelliger Exponent (geschweifte Klammern verwenden)
```

$x^2$, $x_i$, $x_i^2$, $x^{2n+1}$

### Wurzeln

```latex
$\sqrt{x}$
$\sqrt[3]{x}$
$\sqrt[n]{x+y}$
```

$\sqrt{x}$, $\sqrt[3]{x}$, $\sqrt[n]{x+y}$

### Griechische Buchstaben

```latex
$\alpha, \beta, \gamma, \delta, \epsilon$
$\pi, \sigma, \theta, \omega$
$\Gamma, \Delta, \Pi, \Sigma, \Omega$  → Grossbuchstaben
```

$\alpha, \beta, \gamma, \delta, \epsilon, \pi, \sigma, \theta, \omega$

### Summen, Produkte, Integrale

```latex
$\sum_{i=1}^{n} x_i$
$\prod_{i=1}^{n} x_i$
$\int_0^1 x^2 \, dx$
$\iint_D f(x,y) \, dx \, dy$
$\lim_{x \to \infty} f(x)$
```

$\sum_{i=1}^{n} x_i$, $\prod_{i=1}^{n} x_i$, $\int_0^1 x^2 \, dx$, $\lim_{x \to \infty} f(x)$

### Matrizen

```latex
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$
```

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

Matrix-Varianten: `pmatrix` (runde Klammern), `bmatrix` (eckige Klammern), `Bmatrix` (geschweifte Klammern), `vmatrix` (einfache Striche), `Vmatrix` (doppelte Striche).

### Ausgerichtete Gleichungen

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

Das `&` richtet die Gleichungen aus; hier alle am Gleichheitszeichen.

### Fallunterscheidungen

```latex
$$
f(x) = \begin{cases}
  x^2 & \text{falls } x \geq 0 \\
  -x^2 & \text{falls } x < 0
\end{cases}
$$
```

$$f(x) = \begin{cases} x^2 & \text{falls } x \geq 0 \\ -x^2 & \text{falls } x < 0 \end{cases}$$

### Gängige Operatoren

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

## Theme-abhängige Farben in Mathematik

Der KaTeX-Befehl `\textcolor` unterstützt Eduskripts benannte Farbpalette — jede Farbe hat einen separaten Wert für den hellen und den dunklen Modus, gewählt für Lesbarkeit auf beiden Hintergründen.

```latex
$$\textcolor{cyan}{x}^{\textcolor{lightgreen}{n}} + \textcolor{orange}{y}^{\textcolor{lightgreen}{n}} = \textcolor{red}{z}^{\textcolor{lightgreen}{n}}$$
```

$$\textcolor{cyan}{x}^{\textcolor{lightgreen}{n}} + \textcolor{orange}{y}^{\textcolor{lightgreen}{n}} = \textcolor{red}{z}^{\textcolor{lightgreen}{n}}$$

Wechsle das Seiten-Theme — jede Farbe bleibt klar lesbar.

**Verfügbare Palettenfarben:** `cyan`, `lightgreen`, `green`, `orange`, `red`, `blue`, `violet`, `purple`, `lightblue`, `pink`, `yellow`, `white`, `black`, `gray`.

Du kannst auch rohe Hex-Werte verwenden (`\textcolor{#ff0000}{x}`), diese passen sich aber nicht dem Theme an.

---

## Text in Mathematik

Verwende `\text{...}` für Wörter innerhalb eines mathematischen Ausdrucks:

```latex
$P(\text{Kopf}) = 0.5$
$\text{Geschwindigkeit} = \frac{\text{Strecke}}{\text{Zeit}}$
```

$P(\text{Kopf}) = 0.5$, $\text{Geschwindigkeit} = \frac{\text{Strecke}}{\text{Zeit}}$

---

## Abstände anpassen

LaTeX wählt meist die richtigen Abstände, aber manchmal willst du nachhelfen:

| Befehl | Abstand |
|---------|---------|
| `\,` | kleiner Abstand |
| `\;` | mittlerer Abstand |
| `\quad` | grosser Abstand |
| `\qquad` | sehr grosser Abstand |
| `\!` | negativer kleiner Abstand |

Nützlich für Differentiale in Integralen: `\int x^2 \, dx`.

---

## Wo die Grenzen von KaTeX relevant werden

KaTeX rendert schnell (synchron, kein asynchrones Laden), unterstützt aber nur eine Teilmenge von LaTeX. Die meisten Unterrichtsinhalte liegen innerhalb dieser Teilmenge. Was nicht funktioniert:

- Eigene Pakete (z.B. `\usepackage{tikz}` — KaTeX hat kein Präambel-System)
- Einige seltenere Umgebungen (z.B. `gather*` — verwende `aligned` oder `gathered`)
- Eigene Makros, die im Quelltext definiert werden (definiere sie vorgelagert, falls du sie brauchst)

Vollständige Liste der unterstützten Befehle: [katex.org/docs/supported](https://katex.org/docs/supported).

---

## Funktionsplots

Ein ```` ```plot ````-Code-Block zeichnet einen Funktionsgraphen nativ — kein Python, kein Editor, nur ein statisches SVG. Ein Eintrag pro Zeile:

````markdown
```plot
f(x) = 1/3x^3 - x
x: -4..4
y: -3..3
A = (2, 1)
vline x=-1
grid
caption: Eine kubische Funktion mit markiertem Punkt
```
````

**Eintragstypen:**

| Eintrag | Bedeutung |
|-------|---------|
| `f(x) = ...` | eine Kurve (implizite Multiplikation erlaubt: `1/3x^3` funktioniert) |
| `x: -4..4` | der x-Bereich |
| `y: -3..3` | der y-Bereich (optional — automatische Anpassung, wenn weggelassen) |
| `A = (2, 1)` | ein beschrifteter Punkt |
| `vline x=-1` | eine vertikale Linie |
| `hline y=2` | eine horizontale Linie |

**Flags:** `grid` / `nogrid`, `aspect: equal`, `size: 640x400`, `caption: ...`.

Optionen pro Eintrag folgen nach einem Komma auf derselben Zeile: ein Farbwort, `label="..."`, `dashed`, `thick` — z.B. `f(x) = x^2, red, thick, label="parabola"`. Verwende `ln` für den natürlichen Logarithmus, `log` für Basis 10.

Weil der Plot als statisches `<img>` gerendert wird, erfasst ein `<ai-feedback>`-Tag im selben Abschnitt ihn zusammen mit allen darüber gezeichneten Stiftstrichen — so baust du Aufgaben wie «Skizziere die Tangente bei x=1». Siehe **Code-Editoren und Bewertung** für Details zu `<ai-feedback>`.

---

## Plotten mit Python (matplotlib)

Der native `plot`-Block oben deckt die meisten «zeichne diese Funktion»-Bedürfnisse ab. Für alles, was zuerst echte Berechnung braucht — Daten plotten, eine numerische Simulation, eine matplotlib-Figur mit Subplots — verwende stattdessen einen normalen Python-Editor:

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

`output-only` führt den Code beim Laden der Seite automatisch aus und zeigt nur die resultierende Figur (Code eingeklappt, ausklappbar) — siehe **Code-Editoren und Bewertung** für den vollständigen Überblick über Editor-Optionen, Bewertung und die Python/JavaScript/SQL-Laufzeiten.

---

## GeoGebra

Bette ein interaktives GeoGebra-Applet über seine Material-ID ein (die ID aus einem geogebra.org-Freigabelink):

```html
<geogebra material-id="dNPHaqgb" show-toolbar="true" />
```

- `material-id` (erforderlich) — aus dem GeoGebra-Freigabelink
- `show-toolbar="true"` — zeigt GeoGebras eigene Bearbeitungs-Toolbar (weglassen für eine reine Ansicht)
- `height="450"` — legt eine feste Höhe fest; standardmässig passt sich die Einbettung ihrem Inhalt an
- `correct-when="correct"` — erfasst die Korrektheit pro Schüler für die Klassenübersicht der Lehrperson, bei Applets, die einen Korrektheitszustand bereitstellen

Gut für Konstruktionen, die Schülerinnen und Schüler direkt manipulieren — Punkte ziehen, Transformationen erkunden — statt eines statischen Plots.

---

## Spickzettel Mathematik und Plotten

| Ziel | Syntax |
|------|--------|
| Inline-Mathematik | `$x = y$` |
| Block-Mathematik | `$$x = y$$` |
| Bruch | `\frac{num}{den}` |
| Exponent | `x^2`, `x^{n+1}` |
| Index | `x_i`, `x_{ij}` |
| Griechischer Buchstabe | `\alpha`, `\Sigma` |
| Quadratwurzel | `\sqrt{x}` |
| Summe | `\sum_{i=1}^{n}` |
| Integral | `\int_a^b` |
| Matrix | `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` |
| Ausgerichtete Gleichungen | `\begin{aligned} ... \\ ... \end{aligned}` |
| Fallunterscheidung | `\begin{cases} ... \\ ... \end{cases}` |
| Text in Mathematik | `\text{word}` |
| Theme-Farbe | `\textcolor{cyan}{x}` |
| Kleiner Abstand | `\,` |
| Nativer Funktionsplot | ` ```plot `-Code-Block |
| Python/matplotlib-Plot | ` ```python editor output-only ` |
| GeoGebra-Applet | `<geogebra material-id="..." />` |
