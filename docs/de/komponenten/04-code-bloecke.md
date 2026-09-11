# Code-Blöcke

Zeige Code mit Syntaxhervorhebung an (schreibgeschützt). Für ausführbaren, editierbaren Code siehe das nächste Kapitel zu **Code-Editoren**.

---

## Grundsyntax

Verwende Code-Blöcke mit dreifachen Backticks. Die Sprachkennung nach dem öffnenden Zaun aktiviert die Syntaxhervorhebung.

````markdown
```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```
````

```python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

Ein Kopieren-Button erscheint in der oberen rechten Ecke jedes Code-Blocks, wenn der Schüler mit der Maus darüberfährt.

---

## Unterstützte Sprachen

Eduskript verwendet [highlight.js](https://highlightjs.org) für die Syntaxhervorhebung und unterstützt von Haus aus Hunderte von Sprachen. Gängige:

| Sprache | Kennung(en) |
|----------|---------------|
| Python | `python`, `py` |
| JavaScript | `javascript`, `js` |
| TypeScript | `typescript`, `ts` |
| SQL | `sql` |
| HTML | `html`, `xml` |
| CSS | `css`, `scss` |
| Java | `java` |
| C / C++ | `c`, `cpp` |
| Go | `go` |
| Rust | `rust` |
| Bash | `bash`, `sh`, `shell` |
| JSON | `json` |
| YAML | `yaml`, `yml` |
| Markdown | `markdown`, `md` |
| Diff | `diff` |
| Klartext | (Sprache weglassen) |

Nicht erkannte Sprachen werden schlicht (ohne Farben) dargestellt.

---

## Klartext (ohne Hervorhebung)

Für Konsolenausgaben, ASCII-Diagramme oder alles, was nicht eingefärbt werden soll:

````markdown
```
+----+----+
| A  | B  |
+----+----+
| 1  | 2  |
+----+----+
```
````

---

## Inline-Code

Einfache Backticks für Inline-Code:

```markdown
Verwende die Funktion `print()`, um Text auszugeben. Variablen wie `count` unterscheiden Gross- und Kleinschreibung.
```

Verwende die Funktion `print()`, um Text auszugeben. Variablen wie `count` unterscheiden Gross- und Kleinschreibung.

---

## Code-Block vs. Code-Editor

| Funktion | Code-Block | Code-Editor |
|---------|------------|-------------|
| Syntaxhervorhebung | ✓ | ✓ |
| Kopieren-Button | ✓ | ✓ |
| Von Schülern editierbar | ✗ | ✓ |
| Im Browser ausführbar | ✗ | ✓ (Python, JS, SQL) |
| Speichert Schüler-Änderungen | ✗ | ✓ (pro Schüler) |
| Automatisch bewertet | ✗ | ✓ (mit `python-check`) |
| Seitengewicht | winzig | grösser (lädt CodeMirror, Pyodide usw.) |

**Verwende Code-Blöcke** für:
- Beispiele, die Schüler lesen, aber nicht verändern sollen
- Referenzmaterial (Konfiguration, Kommandozeilen-Syntax)
- Ausgaben/erwartete Ergebnisse zum Vergleichen
- Code in Sprachen, die Eduskript nicht ausführen kann (Java, C++, Go usw.)

**Verwende Code-Editoren**, wenn Schüler experimentieren, ausführen oder bewertet werden sollen.

---

## Mehrzeilige Beispiele

Lange Code-Blöcke funktionieren einfach — Schüler können innerhalb des Blocks scrollen. Bei sehr langem Code (50+ Zeilen) erwäge:

1. Aufteilen in kleinere Blöcke mit Prosa dazwischen
2. Verlinken einer Code-Datei, die Schüler herunterladen können (über das **Files**-Panel)
3. Einen Code-Editor mit mehreren Dateien verwenden (jede Datei wird zu einem Tab)

---

## Code-Blöcke in anderen Komponenten

Code-Blöcke funktionieren in Callouts, Tabs, Listenpunkten, Tabellenzellen und so ziemlich überall, wo Markdown verschachtelte Inhalte erlaubt. Beachte, dass bei Code-Blöcken in einem Callout jede Zeile mit `>` beginnen muss:

````markdown
> [!example] Ein Beispiel
> ```python
> print("Hello")
> ```
````

---

## Code-Block-Spickzettel

| Ziel | Syntax |
|------|--------|
| Hervorgehobener Code-Block | ` ```python ... ``` ` (oder eine beliebige Sprache) |
| Klartext-Block | ` ``` ... ``` ` (ohne Sprache) |
| Inline-Code | `` `name` `` |
| Code in einem Callout | Jede Zeile mit `> ` beginnen (inklusive der Zaun-Zeilen) |
