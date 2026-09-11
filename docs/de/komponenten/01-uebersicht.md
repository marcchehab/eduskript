# Übersicht

Eduskript erweitert Markdown um interaktive Komponenten. Dieses Skript ist die Referenz für jede eingebaute Komponente, mit vollständiger Syntax, Optionen und Beispielen.

---

## Wie Komponenten funktionieren

Eine Komponente ist ein spezieller Block in deinem Markdown — entweder ein Code-Block mit einem Schlüsselwort oder ein eigenes HTML-Element. Der Renderer wandelt ihn in eine React-Komponente auf der Seite um, oft mit interaktivem Verhalten (Code ausführen, eine Datenbank abfragen, auf die Leinwand zeichnen).

```
Markdown → AST-Transformation → Eigenes HTML-Element → React-Hydration → Interaktive Komponente
```

Du musst nichts davon wissen, um Komponenten zu verwenden — aber es erklärt, warum es zwei syntaktische Konventionen gibt (Markdown und HTML) und warum einige Einschränkungen bestehen.

---

## Die zwei Komponenten-Syntaxen

### Markdown-Stil (bevorzugt für Code-Blöcke)

````markdown
```python editor
print("Hello")
```
````

Wird für Code-Editoren und Code-Blöcke verwendet. Kompakt, natürlich lesbar.

### HTML-Stil (für alles andere, plus zusätzliche Optionen bei Code-Editoren)

```html
<code-editor data-language="python" data-code="print('Hello')"></code-editor>
```

Wird für Komponenten ohne klares Markdown-Äquivalent verwendet (Callouts haben Markdown via `> [!type]`, aber Quiz, Tabs, Plugins und eigene Elemente verwenden HTML).

> [!warning] HTML-Regeln — strikt
> Alles eigene HTML muss aus **kleingeschriebenen Tags** mit **kleingeschriebenen Attributen in Anführungszeichen** bestehen. Kein PascalCase, keine JSX-Ausdrücke.
>
> - ✅ `<question id="q1" type="single">`
> - ❌ `<Question id="q1" type="single">` (PascalCase-Tag — wird nicht gerendert)
> - ❌ `<question initialCount={7}>` (JSX-Ausdruck — schreibe stattdessen `initialcount="7"`)

Standard-HTML-Elemente (`<div>`, `<span>`, `<p>`, `<h1>` usw.) funktionieren ebenfalls — nützlich für Layout und Inline-Styling.

---

## Kurze Tour durch die eingebauten Komponenten

### Callout

```markdown
> [!tip] Profi-Tipp
> Callouts heben wichtige Informationen hervor.
```

> [!tip] Profi-Tipp
> Callouts heben wichtige Informationen hervor.

### Mathematik

Inline: $E = mc^2$ — Block:

$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$

### Code-Block (schreibgeschützt)

```python
def greet(name):
    return f"Hello, {name}!"
```

### Code-Editor (ausführbar)

```python editor
message = "Hello from Eduskript!"
print(message)
```

### Automatisch bewertete Übung

Ein Code-Editor + ein `python-check`-Block, der den Code der Schülerinnen und Schüler bewertet:

```python editor id="square-it"
def square(x):
    return x * 2  # falsch

# Beispiel
print("The area of a square with side 3 is:", square(3))
```

```python-check for="square-it"
assert square(5) == 25, "square(5) sollte 25 zurückgeben.|Super!"
```

### SQL-Editor

Frage eine SQLite-Datenbank im Browser ab. Das Beispiel unten holt die fünf zuletzt veröffentlichten TV-Serien aus `netflix.db` — absteigend nach `release_date` sortiert, auf 5 Zeilen begrenzt. Probiere, das `LIMIT` zu ändern oder `tv_show` durch `movie` zu ersetzen:

```sql editor db="netflix.db"
SELECT title, release_date
FROM tv_show
ORDER BY release_date DESC
LIMIT 5;
```

### Video

```markdown
![Eine kurze Bildunterschrift](my-video.mp4)
```

### Eigenes Plugin

```html
<plugin src="marie/mod-clock" mod="7"></plugin>
```

### Quiz (Einfachauswahl)

```html
<question id="q1" type="single">
  <p>Was ist 2 + 2?</p>
  <answer>3</answer>
  <answer correct>4</answer>
  <answer>5</answer>
</question>
```

### Tabs

```html
<tabs-container>
  <tab-item label="Python">Python-Inhalt</tab-item>
  <tab-item label="JavaScript">JavaScript-Inhalt</tab-item>
</tabs-container>
```

### Eigenes CSS

```html
<style>
  .my-class { color: red; }
</style>
```

---

## Kurzreferenz

| Komponente | Markdown | HTML |
|-----------|----------|------|
| Callout | `> [!type]` | — |
| Mathematik (inline / Block) | `$...$` / `$$...$$` | — |
| Code-Block | ` ``` ` | — |
| Code-Editor | ` ```python editor ` | `<code-editor data-language="python">` |
| SQL-Editor | ` ```sql editor db="..." ` | `<code-editor data-language="sql" data-db="...">` |
| HTML-Editor (Live-Vorschau) | ` ```html editor ` | `<code-editor data-language="html">` |
| Automatisch bewertet | ` ```python-check for="..." ` | — |
| Bild | `![alt](file.png)` | `<image src="file.png">` |
| Excalidraw | `![alt](file.excalidraw)` | — |
| Video | `![alt](file.mp4)` | `<muxvideo src="file.mp4">` |
| Plugin | — | `<plugin src="owner/plugin">` |
| Quiz | — | `<question type="single">...<answer>` |
| Tabs | — | `<tabs-container>...<tab-item>` |
| Eigenes CSS | — | `<style>.cls { ... }</style>` |

---

Der Rest dieses Skripts behandelt jede eingebaute Komponente im Detail.
