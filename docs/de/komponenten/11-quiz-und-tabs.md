# Quiz und Tabs

Zwei weitere eingebaute Komponenten: `<question>` für Multiple-Choice-Quiz und `<tabs-container>` für gruppierte Inhalte mit umschaltbaren Ansichten.

---

## Quiz

Ein Quiz ist ein `<question>`-Block mit einem oder mehreren `<answer>`-Kindern. Eine Antwort als `correct` zu markieren, macht sie zur richtigen Antwort.

### Single-Choice (Radio-Buttons)

```html
<question id="q-single-demo" type="single">
  <p>Welches Schlüsselwort definiert in Python eine Funktion?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
  <answer>lambda</answer>
</question>
```

Wird gerendert als:

<question id="q-single-demo" type="single">
  <p>Welches Schlüsselwort definiert in Python eine Funktion?</p>
  <answer>function</answer>
  <answer correct>def</answer>
  <answer>fn</answer>
  <answer>lambda</answer>
</question>

Die Schülerinnen und Schüler sehen eine Liste mit Radio-Buttons; sie können eine Option wählen. Klicke auf **Check**, um zu sehen, ob sie richtig ist.

### Multi-Choice (Checkboxen)

```html
<question id="q-multi-demo" type="multi">
  <p>Welche davon sind in Python unveränderlich (immutable)?</p>
  <answer correct>tuple</answer>
  <answer>list</answer>
  <answer correct>str</answer>
  <answer correct>frozenset</answer>
  <answer>dict</answer>
</question>
```

Wird gerendert als:

<question id="q-multi-demo" type="multi">
  <p>Welche davon sind in Python unveränderlich (immutable)?</p>
  <answer correct>tuple</answer>
  <answer>list</answer>
  <answer correct>str</answer>
  <answer correct>frozenset</answer>
  <answer>dict</answer>
</question>

Die Schüler müssen **alle und nur** die richtigen Antworten wählen, damit die Frage als richtig gewertet wird.

### Freitext-Antwort

```html
<question id="q-text-demo" type="text">
  <p>Was ist die Ausgabe von <code>print(2 ** 10)</code>?</p>
  <answer correct>1024</answer>
</question>
```

Wird gerendert als:

<question id="q-text-demo" type="text">
  <p>Was ist die Ausgabe von <code>print(2 ** 10)</code>?</p>
  <answer correct>1024</answer>
</question>

Der Schüler tippt eine Antwort ein; Vergleich ohne Beachtung der Gross-/Kleinschreibung mit der/den `correct`-Antwort(en). Du kannst mehrere `<answer correct>` angeben, um Varianten zu akzeptieren:

```html
<question id="q-text-variants-demo" type="text">
  <p>Was ist die Hauptstadt der Schweiz?</p>
  <answer correct>Bern</answer>
  <answer correct>Berne</answer>
</question>
```

Wird gerendert als:

<question id="q-text-variants-demo" type="text">
  <p>Was ist die Hauptstadt der Schweiz?</p>
  <answer correct>Bern</answer>
  <answer correct>Berne</answer>
</question>

### Question-Attribute

| Attribut | Werte | Wirkung |
|-----------|--------|--------|
| `id` | String | Eindeutige ID pro Seite; dient zur Zuordnung der Schülerantworten |
| `type` | `single` / `multiple` / `text` / `number` / `range` | Fragestil. Standard `multiple`, also explizit setzen |
| `points` | Zahl (Standard 1) | Punktegewicht |
| `feedback` | `check` (Standard) / `instant` / `none` | Wann die Richtigkeit auf einer Nicht-Prüfungsseite angezeigt wird. `check`: ein **Check answer**-Button, nichts wird angezeigt, bis er gedrückt wird, sperrt nach Abschluss. `instant`: bei jeder Änderung. `none`: still, keine Richtigkeit (Umfragen). Prüfungsseiten ignorieren das und bleiben still, bis die Prüfung zurückgegeben wird |
| `attempts` | Zahl (Standard 1) / `unlimited` | Check-Modus: wie viele Check-Klicks, bis die Frage sperrt. Ein falscher, nicht letzter Check markiert nur die eigene Auswahl des Schülers; die richtige Antwort bleibt verborgen. Eine richtige Antwort schliesst die Frage immer ab |
| `showFeedback` | `true` / `false` | Veralteter Alias: `true` = `feedback="instant"`, `false` = `feedback="none"` |
| `expected` | String | Ziel der automatischen Prüfung für Text- (als ```` ```expected ````-Block), Zahlen- und Bereichsfragen |

```html
<question id="q-def" type="single" points="2" attempts="2">
Welches Schlüsselwort definiert in Python eine Funktion?
<answer feedback="Das ist JavaScript.">function</answer>
<answer correct="true">def</answer>
<answer feedback="Das ist Rust.">fn</answer>
</question>
```

Wird gerendert als:

<question id="q-def" type="single" points="2" attempts="2">
Welches Schlüsselwort definiert in Python eine Funktion?
<answer feedback="Das ist JavaScript.">function</answer>
<answer correct="true">def</answer>
<answer feedback="Das ist Rust.">fn</answer>
</question>

### Was Schüler sehen

- Fragetext + Antwortoptionen
- Auf einer normalen Seite: ein **Check answer**-Button. ✓ grüne oder ✗ rote Markierungen, der Feedback-Text pro Antwort und die Punkte erscheinen nach dem Drücken; die Eingaben sperren, sobald die Frage abgeschlossen ist
- Auf einer Prüfungsseite: kein Button, keine Markierungen. Die Antwort wird automatisch gespeichert und mit der Prüfung abgegeben; die Markierungen erscheinen auf der zurückgegebenen Prüfung

Ihre Antwort wird pro Schüler und pro Seite gespeichert; wer später zurückkommt, sieht seine vorherige Antwort.

---

## Tabs

Tab-Container gruppieren zusammengehörige Inhalte mit umschaltbaren Ansichten. Nützlich für: Sprachalternativen, betriebssystemspezifische Anleitungen, Anfänger-/Fortgeschrittenen-Versionen desselben Inhalts, Vorher-/Nachher-Vergleiche.

### Grundsyntax

````html
<tabs-container>
  <tab-item label="Python">
    Standard-Python-Lösung.

    ```python
    print("Hello")
    ```
  </tab-item>

  <tab-item label="JavaScript">
    JavaScript-Äquivalent.

    ```javascript
    console.log("Hello")
    ```
  </tab-item>

  <tab-item label="Rust">
    Rust-Version (kompiliert).

    ```rust
    println!("Hello");
    ```
  </tab-item>
</tabs-container>
````

Wird gerendert als:

<tabs-container>
  <tab-item label="Python">

Standard-Python-Lösung.

```python
print("Hello")
```

  </tab-item>
  <tab-item label="JavaScript">

JavaScript-Äquivalent.

```javascript
console.log("Hello")
```

  </tab-item>
  <tab-item label="Rust">

Rust-Version (kompiliert).

```rust
println!("Hello");
```

  </tab-item>
</tabs-container>

Die Schüler sehen oben eine Tab-Leiste mit den drei Beschriftungen; ein Klick wechselt zwischen ihnen.

### Tabs können beliebigen Inhalt enthalten

Markdown, Code-Blöcke, Code-Editoren, Callouts, Bilder, Mathematik — alles, was im Seitenkörper funktioniert, funktioniert auch in einem `<tab-item>`.

````html
<tabs-container>
  <tab-item label="Beschreibung">
    Der Satz des Pythagoras besagt, dass für ein rechtwinkliges Dreieck gilt:
    $a^2 + b^2 = c^2$
  </tab-item>

  <tab-item label="Probier es">
    ```python editor id="pythagoras"
    a, b = 3, 4
    c = (a**2 + b**2) ** 0.5
    print(f"c = {c}")
    ```
  </tab-item>

  <tab-item label="Beweis">
    > [!example] Geometrischer Beweis
    > Nimm vier rechtwinklige Dreiecke mit den Katheten $a$ und $b$ ...
  </tab-item>
</tabs-container>
````

### Standardmässig geöffneter Tab

Füge `default` zu einem Tab hinzu, damit er anfangs geöffnet ist (sonst ist standardmässig der erste Tab geöffnet):

```html
<tabs-container>
  <tab-item label="macOS">macOS-Anleitung</tab-item>
  <tab-item label="Windows" default>Windows-Anleitung</tab-item>
  <tab-item label="Linux">Linux-Anleitung</tab-item>
</tabs-container>
```

### Tabs-Spickzettel

| Ziel | Syntax |
|------|--------|
| Tab-Container | `<tabs-container>...</tabs-container>` |
| Einzelner Tab | `<tab-item label="Label">content</tab-item>` |
| Standardmässig geöffneter Tab | `<tab-item label="..." default>` |
| Code-Editor in einem Tab einbetten | Standard ` ```python editor ` innerhalb des `<tab-item>` |

---

## Wann was verwenden

| Situation | Verwende |
|-----------|-----|
| Faktenwissen eines Schülers abfragen | `<question type="single">` oder `type="text">` |
| Programmierverhalten testen | `python editor` + `python-check` (Kapitel «Automatische Bewertung») |
| Denselben Inhalt in mehreren Varianten zeigen | `<tabs-container>` |
| Hinweis bis zum Klick verbergen | Eingeklapptes Callout (`> [!tip]-`) |
| Eine lange Lösung verbergen | Eingeklapptes Callout mit Code-Block |

Für selbstbewertende Code-Aufgaben ist `python-check` viel mächtiger als `<question>`. Für Faktenabfragen und Fragen mit diskreten Antworten ist `<question>` schneller geschrieben.
