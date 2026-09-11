# Code-Editoren und Bewertung

Code-Editoren, die Schülerinnen und Schüler bearbeiten und **im Browser ausführen** können — keine Installation, kein Server, kein «bitte zuerst Python installieren». Python und JavaScript laufen beide clientseitig; SQL läuft gegen SQLite-Datenbanken pro Schüler (im nächsten Kapitel behandelt); HTML wird in einem sandboxed Live-Vorschau-iframe gerendert.

Diese Seite behandelt auch die drei Wege, Schülerarbeiten zu **bewerten**: `python-check` (Bestanden/Nicht-bestanden-Assertions auf Code, mit Punkten), Freitext-Auto-Check (Punktevergabe mit Teilpunkten für eine vorhergesagte Ausgabe) und `<ai-feedback>` (KI-Feedback zu Code, Freitext oder Stiftstrichen auf einem Plot oder Diagramm). «Bewertung» meint hier Punkte — die Note 1–6, die ein Schüler am Ende erhält, ist eine separate, von der Lehrperson gesetzte Note.

---

## Grundsyntax

Füge `editor` nach der Sprachkennung in einem Code-Block hinzu:

````markdown
```python editor
name = "World"
print(f"Hello, {name}!")
```
````

```python editor
name = "World"
print(f"Hello, {name}!")
```

Schüler sehen einen Editor mit dem Startcode, klicken auf **Run** und sehen die Ausgabe darunter.

### HTML-Syntax

```html
<code-editor data-language="python" data-code="print('Hello')"></code-editor>
```

Die HTML-Form erlaubt zusätzliche Attribute, die nicht sauber in einen Zaun-Infostring passen.

---

## Unterstützte Sprachen

| Sprache | Laufzeit | Hinweise |
|----------|---------|-------|
| **Python** | [Pyodide](https://pyodide.org) + [Skulpt](https://skulpt.org) | Automatisch: Skulpt für `turtle` und `input()`, Pyodide für alles andere |
| **JavaScript** | Ein sandboxed Web Worker | Modernes JS, kein DOM-Zugriff — für Algorithmen, nicht für Seiten |
| **SQL** | [SQL.js](https://sql.js.org) (SQLite zu WebAssembly kompiliert) | Siehe Kapitel **SQL-Datenbanken** |
| **HTML** | Ein sandboxed iframe im Browser des Schülers | Live-Vorschau neben dem Editor — für HTML/CSS/JS-Lektionen |

Der erste Python-Lauf lädt die Laufzeit (~5 Sekunden, danach gecacht). Weitere Läufe starten sofort. JavaScript und SQL sind schon beim ersten Lauf nahezu sofort bereit.

### Zwei Python-Laufzeiten, transparent

Eduskript führt Python in einer von zwei Browser-Engines aus und wählt anhand deines Codes die richtige:

| Verwendete Funktion | Laufzeit | Warum |
|--------------|---------|-----|
| `import turtle` oder `from turtle import ...` | **Skulpt** | Native asynchrone Unterbrechung für animierte Turtle-Grafik |
| Aufrufe von `input("...")` | **Skulpt** | Sauberes, synchron wirkendes `input()` über Skulpts Coroutinen |
| Alles andere (NumPy, pandas, matplotlib, Datei-I/O, Standardbibliothek) | **Pyodide** | Echtes CPython auf WebAssembly — volle Bibliotheksunterstützung |

Kein Flag zu setzen, kein Editor-Attribut — der Editor untersucht den Code und wechselt. Schreibe den Code, den du schreiben willst; die richtige Laufzeit wird geladen. Beide werden verzögert vorgeladen, wenn der Schüler in die Nähe eines Editors scrollt.

Eine praktische Konsequenz: Weil Skulpt ein Python-zu-JS-Compiler ist (kein CPython), verhalten sich einige Randfälle leicht anders als in Desktop-Python, wenn `turtle` oder `input()` im Einsatz ist. Stösst du auf eine Skulpt-spezifische Eigenheit, vermeide die beiden auslösenden Funktionen, und du landest wieder bei Pyodide.

---

## Editor-IDs (empfohlen)

Gib jedem Editor eine `id`. Die ID:

- Erlaubt `python-check`-Blöcken, den Editor für die automatische Bewertung zu referenzieren
- Liefert einen stabilen Schlüssel für die Speicherung pro Schüler (damit das Umsortieren von Seiten keine Arbeit verliert)
- Identifiziert den Editor in der Abgabeverfolgung und Bewertung

````markdown
```python editor id="exercise-1"
def double(x):
    pass  # Schüler füllt aus
```
````

> [!warning] Ohne explizite id
> Der Editor erhält eine generierte id basierend auf seiner Position auf der Seite. **Bearbeitest du die Seite später, kann die gespeicherte Arbeit des Schülers einem anderen Editor zugeordnet werden.** Setze immer eine `id` für alles, wozu Schüler zurückkehren werden.

IDs müssen nur innerhalb einer Seite eindeutig sein. `id="loops"` auf Seite A und `id="loops"` auf Seite B sind unabhängig.

---

## Editoren mit mehreren Dateien

Für alles, was komplexer ist als ein Ein-Datei-Skript, verwende mehrere aufeinanderfolgende Blöcke mit derselben `id`. Jeder Block wird zu einem Tab im Editor.

````markdown
```python editor id="rectangle" file="main.py"
from shapes import area, perimeter

w, h = 4, 7
print("Area:", area(w, h))
print("Perimeter:", perimeter(w, h))
```

```python editor id="rectangle" file="shapes.py"
def area(width, height):
    return width * height

def perimeter(width, height):
    return 2 * (width + height)
```
````

Die Blöcke müssen im Quelltext **aufeinanderfolgen** — alles andere dazwischen (auch nicht passende Code-Blöcke) bricht die Gruppierung. Das Attribut `file=` benennt jeden Tab; lässt du es weg, wird der erste zu `main.py` und die übrigen zu `file2.py`, `file3.py` usw.

Dasselbe Muster funktioniert für JavaScript (`.js`) und SQL (`.sql`).

---

## Speicherung pro Schüler

Jeder Code-Editor speichert automatisch, was jeder Schüler tippt — verknüpft mit seinem Konto und der `id` des Editors. Kommt er morgen zurück, ist seine Arbeit genau da.

- **Save** — automatisches Speichern, entprellt; manueller Schnappschuss über den Button **Save version** des Editors
- **Reset** — stellt den ursprünglichen Markdown-Inhalt wieder her (aktuelle Version, nicht veralteter Cache)
- **Version history** — vergangene Schnappschüsse ansehen, jeden davon wiederherstellen
- **Sync** — speichert in die Cloud, wenn angemeldet; funktioniert offline gegen IndexedDB und synchronisiert bei erneuter Verbindung

Nicht angemeldete Schüler erhalten nur IndexedDB-Speicherung (ihre Arbeit übersteht ein Neuladen der Seite, aber kein Löschen der Browserdaten).

---

## Editor-Funktionen für Schüler

In einem Code-Editor erhalten Schülerinnen und Schüler:

- **Run**-Button — Code ausführen, Ausgabe darunter sehen
- **Reset** — auf das Original zurücksetzen (mit Bestätigung)
- **Grösse ändern** — den Trenner zwischen Editor und Ausgabe ziehen
- **Schriftgrösse** — Tastenkürzel (`Cmd/Ctrl + +/-`)
- **Suchen/Ersetzen** — `Cmd/Ctrl + F` im Editor
- **Mehrere Cursor** — `Cmd/Ctrl + Klick` für zusätzliche Cursor
- **Auto-Einrückung, Klammernpaarung, Syntaxhervorhebung**

Bei Editoren mit mehreren Dateien zusätzlich:
- **Datei hinzufügen** — `+`-Button neben den Datei-Tabs
- **Datei umbenennen** — Doppelklick auf den Tab-Namen
- **Datei löschen** — `×`-Button auf dem Tab (die letzte Datei kann nicht gelöscht werden)

---

## Pythons input(), Ausgabe, Fehler

`input()` funktioniert — Schüler erhalten eine Eingabeaufforderung direkt über der Ausgabe. Nützlich für interaktive Übungen («gib dein Alter ein», «errate die Zahl»).

```python editor
name = input("What is your name? ")
print(f"Hello, {name}!")
```

`print()` schreibt ins Ausgabe-Panel. Fehler (wie nicht abgefangene Exceptions) erhalten farbige Tracebacks.

Für Python-Turtle-Grafik funktioniert `import turtle` — die Ausgabe erscheint als Inline-Leinwand über der Textausgabe.

### output-only: für Figuren, nicht für Textausgabe

Füge `output-only` hinzu, um den Code beim Laden der Seite automatisch auszuführen und nur das Ergebnis zu zeigen — Code eingeklappt, ausklappbar. Gebaut für matplotlib-Figuren und ähnliche «hier ist die Ausgabe, so wurde sie erzeugt»-Übungen:

````markdown
```python editor output-only
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
```
````

Siehe **Mathematik und Funktionsplotter** dafür, wann ein `plot`-Block statt eines vollständigen Python-Editors reicht.

---

## HTML-Editor mit Live-Vorschau

Verwende ` ```html editor ` für HTML/CSS/JS-Lektionen. Der Editor teilt sich in zwei Bereiche — Code links, ein sandboxed iframe rechts, das ~500 ms nach jedem Tastendruck neu rendert.

````markdown
```html editor
<style>
  body { font-family: system-ui; padding: 1rem }
  h1 { color: crimson }
</style>
<h1>Hallo Welt</h1>
<button onclick="alert('Klick!')">Klick mich</button>
```
````

Was im iframe funktioniert:

- Inline-Event-Handler (`onclick="..."`), `<script>`-Blöcke und DOM-Zugriff aus JavaScript
- `alert()`, `confirm()`, `prompt()` für interaktive Demos
- `<form>`-Absenden (navigiert nicht weg — die Sandbox blockiert Top-Level-Navigation)
- Externe Ressourcen: CDN-Skripte, Google Fonts, externe Bilder laden normal

Was absichtlich nicht funktioniert:

- Zugriff auf die übergeordnete Eduskript-Seite — `window.parent`, Cookies, `localStorage` der Host-Seite sind alle blockiert (kein `allow-same-origin`)
- Den Tab des Schülers von der Lektion wegleiten (kein `allow-top-navigation`)
- Kombination mit `python-check` oder Ausführung im `exam`-Modus — der HTML-Editor wird nicht automatisch bewertet

### Layout und Optionen

- **Standardgrösse:** 400 px hoch, horizontale 50/50-Teilung. Der Schüler kann den Trenner ziehen.
- **Stapeln auf Mobilgeräten:** unter 768 px werden die Bereiche vertikal gestapelt (Editor oben, Vorschau unten).
- **Eigene Höhe:** setze `height="600"` (Pixel) im Zaun-Infostring.
- **Vollbild:** der Vollbild-Button der Toolbar verwendet die native Vollbild-API des Browsers.

````markdown
```html editor height="600" id="kitten-demo"
<img src="https://placekitten.com/400/300">
```
````

Speicherung und Zurücksetzen verhalten sich genau wie bei den anderen Editoren — Schüler-Änderungen werden pro `id` gespeichert und `Reset` stellt das ursprüngliche Markdown wieder her.

> [!note] Vorerst nur eine Datei
> Der HTML-Editor nimmt einen Block pro Editor. Das Mehrdatei-Muster `file="..."`, das Python und JavaScript unterstützen, ist für HTML noch nicht angebunden — fasse HTML, CSS und JS in einem einzigen Block zusammen (verwende `<style>` und `<script>` inline).

---

## Was kann Python? Was kann JavaScript?

### Python (Pyodide)

- Vollständige Standardbibliothek (`os`, `sys`, `json`, `math`, `random`, `datetime`, `collections`, `re` usw.)
- Wissenschaftlicher Stack: `numpy`, `pandas`, `matplotlib`, `scipy`, `scikit-learn`, `sympy`
- Datei-I/O: `open()` funktioniert gegen ein virtuelles Dateisystem im Speicher
- `import turtle` für Grafik
- HTTP-Anfragen: durch Browser-CORS blockiert — funktioniert meist nur gegen denselben Origin
- Subprozesse / OS-Befehle: blockiert

### JavaScript

- Vollständiges ECMAScript 2023
- `console.log` schreibt in die Ausgabe
- Kein DOM-Zugriff (sandboxed)
- Kein `fetch()` auf beliebige URLs (CORS-blockiert)
- Nützlich für: Algorithmen, Datenmanipulation, JSON-Verarbeitung, Vergleiche mit Python

Für laufzeitspezifische Dinge (Datei-Uploads, Browser-APIs, Chart-Bibliotheken) verwende stattdessen ein **Plugin** — siehe **Plugins**.

---

## Code bewerten: python-check

Kombiniere einen beliebigen Code-Editor mit einem `python-check`-Block, und die Seite bewertet sich selbst. Schüler klicken auf **Check**; der Runner führt ihren Code aus, prüft deine Assertions und zeigt, was bestanden hat und was nicht — mit den Hinweisen, die *du* geschrieben hast, in der Sprache, in der *du* sie geschrieben hast.

Keine Korrekturwarteschlange. Kein «ich schaue es nächste Woche an». Schüler erhalten Feedback in dem Moment, in dem sie dafür bereit sind.

### Ein erstes Beispiel

Kombiniere einen Editor mit einem Check-Block. Der Editor braucht eine `id`; der Check-Block referenziert sie über `for=`.

````markdown
```python editor id="square-it"
def square(x):
    return x  # Schüler füllt aus
```

```python-check for="square-it"
assert square(5) == 25, "square(5) sollte 25 zurückgeben.|Super — square(5) = 25!"
assert square(0) == 0, "square(0) sollte 0 zurückgeben."
assert square(-3) == 9, "square(-3) sollte 9 zurückgeben (negative Zahlen quadriert sind positiv)."
```
````

Schüler sehen den Editor und einen **Check**-Button. Ein Klick auf Check:

1. Führt den Code des Schülers aus (definiert `square`)
2. Führt jedes `assert` der Reihe nach aus
3. Zeigt ein Bestanden/Nicht-bestanden-Panel mit Ergebnis und Meldung jeder Assertion

Der `python-check`-Block selbst wird für Schüler **nie gerendert** — sie sehen nur den Editor und die Ergebnisse.

### Aufbau eines python-check

Jede Zeile ist eine Python-`assert`-Anweisung:

```python
assert <expression>, "<message>"
```

- Der **Ausdruck** wird ausgewertet. Ist er wahr, besteht der Test; ist er falsch oder wirft er eine Exception, schlägt der Test fehl.
- Die **Meldung** ist, was Schüler für diesen Test sehen (mehr dazu unten).

Zwischen den Asserts kann beliebiger Python-Code stehen — Variablen setzen, Hilfsfunktionen aufrufen, was auch immer. Denk nur daran, dass jedes `assert` ein separater Test ist.

```python-check for="my-exercise"
# Vorbereitung
result_5 = my_function(5)
result_0 = my_function(0)

# Tests
assert result_5 == 25, "my_function(5) sollte 25 zurückgeben."
assert result_0 == 0, "my_function(0) sollte 0 zurückgeben."

# Eine komplexere Prüfung
import math
assert math.isclose(my_function(0.5), 0.25), "my_function(0.5) sollte 0.25 zurückgeben."
```

### Meldungen für bestanden und nicht bestanden — die Pipe-Syntax

Eine einzelne Meldung dient als Testname sowohl im bestandenen als auch im nicht bestandenen Fall:

```python
assert fn(5) == 25, "fn(5) sollte 25 zurückgeben."
```

Um **unterschiedliche Meldungen für bestanden und nicht bestanden** zu zeigen, trenne sie mit `|`:

```python
assert fn(5) == 25, "fn(5) sollte 25 zurückgeben.|Super — fn(5) = 25!"
#                    └───── bei Fehlschlag ─────┘└── bei Erfolg ───┘
```

Schüler sehen «fn(5) sollte 25 zurückgeben.», solange der Test fehlschlägt, und «Super — fn(5) = 25!», sobald er besteht. Nutze das für die schwierigeren Aufgaben, bei denen etwas Ermutigung gut ankommt. Bei trivialen Checks lass die Erfolgsmeldung weg — wenn jeder Test ein 🎉 bekommt, wirkt das schnell laut.

> [!tip] f-Strings funktionieren auch
> `assert ok, f"Erhalten: {actual}, erwartet: {expected}.|Top, du hast {actual}!"`
> Die Interpolationen werden aus dem angezeigten Testnamen entfernt (ersetzt durch `…`), aber die gerenderte Meldung erscheint im Fehlerdetail, wenn der Test fehlschlägt.

### Verhaltenstests, nicht Implementierungstests

Bei offenen Aufgaben mit mehreren gültigen Lösungen teste, was die Funktion *liefert* — nicht, wie sie aufgebaut ist.

✅ **Verhaltenstest:**
```python
assert "umbrella" in advise(10, True).lower(), "Sollte bei Regen den Regenschirm erwähnen."
```

❌ **Implementierungstest:**
```python
import inspect
assert "if raining:" in inspect.getsource(advise), "Sollte eine if-Anweisung auf raining verwenden."
```

Der erste lässt jeden Schüler seinen eigenen Weg finden. Der zweite bestraft alle, die es anders lösen, als du dir vorgestellt hast.

### Was du NICHT tun solltest

> [!failure] Anti-Muster
> - **Füge keine Vorprüfungen hinzu, die bei Stub-Code bestehen**, wie `assert "fn_name" in globals()` oder `assert result is not None`. Diese bestehen, *bevor der Schüler irgendetwas tut*, blähen die Punktzahl von 0% auf ~30% auf und geben falsche Sicherheit. Fehlt die Funktion des Schülers, zeigt der Runner bereits bei jedem Test, der sie verwendet, einen klaren Fehler — das reicht.
> - **Wiederhole nicht denselben Codepfad mit verschiedenen Eingaben.** Drei Asserts, die alle denselben Zweig treffen, verschwenden dein Bewertungssignal. Wähle Eingaben, die *verschiedene* Pfade abdecken (Grenzen, Randfälle, der offensichtliche Hauptfall).
> - **Schreibe keine Tests, die von print-Ausgaben abhängen**, ausser du willst das wirklich. Teste Rückgabewerte, wo du kannst — sie sind robuster gegenüber Formatierungsunterschieden.
> - **Schreibe keinen Hinweis, der nur «falsch» sagt** — gib konkrete, umsetzbare Anleitung. Die Fehlermeldung ist das Einzige, was Schüler sehen, wenn sie feststecken.

### Turtle-Übungen

Turtle-Zeichnungen lassen sich nicht mit einem einfachen `assert result == ...` prüfen — es gibt keinen einzelnen Rückgabewert. Drei Hilfsfunktionen vergleichen stattdessen gezeichnete Pfade:

- `turtle_solution_matches(solution_code, match_colors=False)` (bevorzugt) — führt eine von der Lehrperson bereitgestellte Referenzlösung durch denselben Aufzeichnungs-Stub und vergleicht die Menge der gezeichneten Segmente. Tolerant gegenüber Verschiebung und Drehung. Übergib `match_colors=True`, um zusätzlich übereinstimmende Stiftfarben pro Segment zu verlangen.
- `turtle_matches(expected_segments)` — Vergleich mit einer expliziten Segmentliste.
- `turtle_path_matches(expected_path)` — Vergleich mit einem expliziten Pfad.

Lege lange Lösungs-Strings in einer Vorbereitungsvariable ab und prüfe dann die Übereinstimmung:

```python-check for="star-drawing"
solution = """
import turtle
t = turtle.Turtle()
for _ in range(5):
    t.forward(100)
    t.right(144)
"""
assert turtle_solution_matches(solution), "Deine Zeichnung entspricht keinem fünfzackigen Stern."
```

### Optionale Attribute

```python-check for="my-exercise" points="10" max-checks="5"
```

| Attribut | Wirkung |
|-----------|--------|
| `for="<editor-id>"` | Verknüpft den Check mit einem bestimmten Editor (erforderlich) |
| `points="N"` | Punktegewicht (Standard: 1 Punkt pro Test) |
| `max-checks="N"` | Begrenzt, wie oft ein Schüler Check ausführen kann (nützlich für Prüfungen — verhindert Brute-Force) |

### exam-Modus: stille Bewertung

Füge `exam` zum Zaun-Infostring des Editors hinzu, und er kombiniert sich mit `python-check` zu einer **stillen** Bewertung — der Schüler führt seinen Code aus, sieht aber nie ein Bestanden/Nicht-bestanden-Feedback, nur dass er gelaufen ist. Verwende das für Leistungsnachweise; der Standard (ohne `exam`) zeigt nach jedem Klick auf Check Feedback und ist zum Üben gedacht, nicht für Prüfungen.

### Der Bewertungsablauf für Schüler

1. Schüler schreibt Code im Editor
2. Klickt auf **Check** (neben Run)
3. Sieht ein Panel mit jedem Test als Zeile:
   - ✅ grün bei bestanden (mit der Erfolgsmeldung, falls du eine geschrieben hast)
   - ❌ rot bei nicht bestanden (mit der Fehlermeldung + Fehler-Trace)
4. Punktzahl angezeigt als `passed/total` (z.B. `3/5`)
5. Schüler korrigiert seinen Code, klickt erneut auf Check

Das `python-check`-Panel bleibt zwischen Sitzungen erhalten — Schüler sehen ihr letztes Ergebnis, wenn sie zur Seite zurückkehren.

### Was du als Lehrperson siehst

Für Schüler, die in einer Klasse angemeldet sind:

- **Submissions-Oberfläche** (`Dashboard → Classes → Submissions`) — die letzte Punktzahl und den Code jedes Schülers sehen
- **Detail pro Schüler** — seinen Code im selben Editor ansehen, den er verwendet hat, und ihn selbst ausführen
- **Numerische Überschreibungen** — eine manuelle Punktzahl erfassen, die das automatische Ergebnis überschreibt
- **Kommentare** — Rich-Text-Feedback pro Abgabe oder pro Code-Block hinterlassen

Automatisch bewertete `python-check`-Ergebnisse erscheinen neben deiner manuellen Durchsicht, sodass du auf einen Blick siehst, wer alle Checks bestanden hat und wer genauer angeschaut werden muss.

---

## Freitext bewerten: predict-output

`python-check` bewertet Code. Für Fragen, bei denen der Schüler vorhersagt, was Code ausgeben *würde* — ohne ihn auszuführen — verwende die Freitext-Auto-Check-Variante von `<question type="text">`: gib ihr einen ` ```expected `-Block statt `<answer>`-Kindern, und sie bewertet die getippte Vorhersage des Schülers gegen diesen erwarteten Text mit einem Diff und vergibt Teilpunkte statt eines strikten Bestanden/Nicht-bestanden.

````markdown
<question id="predict-loop" type="text" points="2">
Was gibt dieser Code aus?

```python
for i in range(3):
    print(i * 2)
```

```expected ignore-whitespace
0
2
4
```
</question>
````

- Der ` ```expected `-Block braucht innerhalb des `<question>`-Tags eine Leerzeile davor.
- Flags auf dem Zaun: `ignore-case`, `ignore-whitespace`.
- `points="2"` setzt die maximale Punktzahl; Teilpunkte werden danach vergeben, wie nah das Diff ist.
- Auf einer normalen Seite tippt der Schüler eine Vorhersage und drückt **Check answer**; erst dann erscheinen Punktzahl und Diff, und die Frage wird gesperrt. Mit `attempts="3"` darf er dreimal prüfen; bis zum letzten Versuch sieht er nur den Prozentwert, das Diff (die Lösung) bleibt verborgen. Auf Prüfungsseiten gibt es keinen Button; das Diff erscheint auf der zurückgegebenen Prüfung. Lehrpersonen sehen es beim Bewerten immer. Siehe **Quiz und Tabs** für die vollständigen Optionen `feedback` und `attempts`.

Das ist ein anderer Mechanismus als `python-check`: `python-check` führt den *Code* des Schülers aus; predict-output bewertet die *schriftliche Vorhersage* eines Schülers, was Code tut — gut, um zu testen, ob er die Ausführung nachvollziehen kann, statt nur funktionierenden Code zu produzieren.

---

## Offene Antworten bewerten: ai-feedback

Für Arbeiten ohne eine einzige richtige Antwort zum Vergleichen — Freitext-Erklärungen, offener Code, ein handgezeichnetes Diagramm — sendet `<ai-feedback>` die Arbeit des Schülers an ein Vision-Modell und liefert Feedback statt einer Punktzahl:

```html
<ai-feedback prompt="Prüfe, ob die Erklärung des Schülers Parameter und Argument korrekt unterscheidet. Benenne die konkrete Verwechslung, falls nicht." label="Meine Antwort prüfen" />
```

- `prompt` (erforderlich) — deine Anweisungen an die KI, z.B. worauf sie achten und wie streng sie sein soll
- `id` — optional; mehrere `<ai-feedback>`-Tags auf einer Seite werden ihren Prompts nach Position zugeordnet, wenn weggelassen
- `label` — der Button-Text für Schüler (Standard ist ein generisches «Check»)

Was gesendet wird: die Stiftstriche des Schülers im umgebenden h1/h2/h3-Abschnitt, als Bild gerendert, plus das Markdown dieses Abschnitts — so kann das Modell einen Plot, ein Moleküldiagramm oder den Code eines Editors zusammen mit allem darüber Gezeichneten sehen. Das Einfügen eines Screenshots (Hover-Box, `Ctrl+V`) funktioniert als alternative Eingabe, z.B. für Arbeiten ausserhalb von Eduskript.

Funktioniert ohne Login, mit Ratenbegrenzung pro Benutzer oder IP-Adresse. Anders als `python-check` und predict-output erzeugt dies keine numerische Punktzahl — es ist Feedback, das einem Schüler vor der Abgabe helfen soll, keine Benotung.

---

## Spickzettel Editor und Bewertung

| Ziel | Syntax |
|------|--------|
| Eigenständiger Python-Editor | ` ```python editor ` |
| Eigenständiger JavaScript-Editor | ` ```javascript editor ` |
| HTML-Editor mit Live-Vorschau | ` ```html editor ` |
| Höherer HTML-Editor | ` ```html editor height="600" ` |
| Persistenter Editor (empfohlen) | ` ```python editor id="my-stable-id" ` |
| Editor mit mehreren Dateien (mehrere Blöcke, gleiche id) | ` ```python editor id="x" file="main.py" ` |
| Datei-Tabs ausblenden (Einzeldatei-Modus) | ` ```python editor single ` |
| Nur-Figur-Editor | ` ```python editor output-only ` |
| Stille Prüfungsbewertung | ` ```python editor exam ` (mit `python-check` kombinieren) |
| HTML-Form mit eigenen Attributen | `<code-editor data-language="python" data-id="x" data-code="...">` |
| Code mit Assertions bewerten | Editor `id="x"`, dann ` ```python-check for="x" ` |
| Unterschiedliche Meldungen für bestanden/nicht bestanden | `assert ok, "Failure hint.\|Success cheer!"` |
| Punktegewichtung | `python-check for="x" points="10"` |
| Versuche begrenzen (Prüfungskontext) | `python-check for="x" max-checks="5"` |
| Turtle-Zeichnung prüfen | `assert turtle_solution_matches(solution), "..."` |
| Vorhergesagte Ausgabe bewerten | `<question type="text" points="2">` + ` ```expected `-Block |
| Mehrere Versuche bei einer Vorhersage | `<question type="text" attempts="3">` |
| KI-Feedback zu offenen Arbeiten | `<ai-feedback prompt="..." label="..." />` |
