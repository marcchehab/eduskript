# Automatische Bewertung

Kombiniere einen beliebigen Code-Editor mit einem `python-check`-Block, und die Seite bewertet sich selbst. Die Schülerinnen und Schüler klicken auf **Check**; der Runner führt ihren Code aus, prüft deine Assertions und zeigt, was bestanden hat und was nicht — mit den Hinweisen, die *du* geschrieben hast, in der Sprache, in der *du* sie geschrieben hast.

Keine Korrekturwarteschlange. Kein «Ich schaue es mir nächste Woche an.» Die Schüler erhalten Feedback in dem Moment, in dem sie bereit dafür sind.

---

## Ein erstes Beispiel

Kombiniere einen Editor mit einem Check-Block. Der Editor braucht eine `id`; der Check-Block referenziert sie über `for=`.

````markdown
```python editor id="square-it"
def square(x):
    return x  # hier ergänzt der Schüler
```

```python-check for="square-it"
assert square(5) == 25, "square(5) sollte 25 zurückgeben.|Super — square(5) = 25!"
assert square(0) == 0, "square(0) sollte 0 zurückgeben."
assert square(-3) == 9, "square(-3) sollte 9 zurückgeben (negative Zahlen quadriert sind positiv)."
```
````

Die Schüler sehen den Editor und einen **Check**-Button. Ein Klick auf Check:

1. Führt den Code des Schülers aus (der `square` definiert)
2. Führt jedes `assert` der Reihe nach aus
3. Zeigt ein Panel mit Bestanden/Nicht bestanden für jede Assertion samt Meldung

Der `python-check`-Block selbst wird den Schülern **nie angezeigt** — sie sehen nur den Editor und die Ergebnisse.

---

## Aufbau eines `python-check`

Jede Zeile ist eine Python-`assert`-Anweisung:

```python
assert <expression>, "<message>"
```

- Der **Ausdruck** (expression) wird ausgewertet. Ist er wahr, besteht der Test; ist er falsch oder wirft er eine Exception, schlägt der Test fehl.
- Die **Meldung** (message) ist, was die Schüler für diesen Test sehen (mehr dazu unten).

Du kannst beliebigen Python-Code zwischen den Asserts haben — Variablen setzen, Hilfsfunktionen aufrufen, was auch immer. Denk nur daran, dass jedes `assert` ein eigener Test ist.

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

---

## Meldungen für Bestanden und Nicht bestanden — die Pipe-Syntax

Ein einzelner Meldungsstring dient als Name des Tests, sowohl im Bestanden- als auch im Nicht-bestanden-Fall:

```python
assert fn(5) == 25, "fn(5) sollte 25 zurückgeben."
```

Um **unterschiedliche Meldungen für Bestanden und Nicht bestanden** anzuzeigen, trenne sie mit `|`:

```python
assert fn(5) == 25, "fn(5) sollte 25 zurückgeben.|Super — fn(5) = 25!"
#                    └────── bei Fehlschlag ────┘ └─── bei Erfolg ──┘
```

Die Schüler sehen «fn(5) sollte 25 zurückgeben.», solange der Test fehlschlägt, und «Super — fn(5) = 25!», sobald er besteht. Nutze das bei den schwierigeren Aufgaben, wo ein bisschen Ermutigung ankommt. Bei trivialen Tests lass die Erfolgsmeldung weg — wenn jeder Test ein 🎉 bekommt, wirkt das schnell laut.

> [!tip] f-Strings funktionieren auch
> ` `assert ok, f"Erhalten: {actual}, erwartet: {expected}.|Top, du hast {actual}!"` `
> Die Interpolationen werden aus dem angezeigten Testnamen entfernt (ersetzt durch `…`), aber die gerenderte Meldung erscheint im Fehlerdetail, wenn der Test fehlschlägt.

---

## Verhaltenstests, nicht Implementierungstests

Bei offenen Aufgaben mit mehreren gültigen Lösungen teste, was die Funktion *liefert* — nicht, wie sie aufgebaut ist.

✅ **Verhaltenstest:**
```python
assert "umbrella" in advise(10, True).lower(), "Sollte bei Regen den Regenschirm (umbrella) erwähnen."
```

❌ **Implementierungstest:**
```python
import inspect
assert "if raining:" in inspect.getsource(advise), "Sollte eine if-Anweisung auf raining verwenden."
```

Der erste lässt jeden Schüler seinen eigenen Weg finden. Der zweite bestraft alle, die es anders lösen, als du es dir vorgestellt hast.

---

## Was du NICHT tun solltest

> [!failure] Anti-Muster
> - **Füge keine Vorprüfungen hinzu, die schon mit dem Stub-Code bestehen**, wie `assert "fn_name" in globals()` oder `assert result is not None`. Diese bestehen, *bevor der Schüler irgendetwas getan hat*, blähen die Punkte von 0 % auf ~30 % auf und geben falsche Sicherheit. Fehlt die Funktion des Schülers, zeigt der Runner bereits bei jedem Test, der sie verwendet, einen klaren Fehler — das reicht.
> - **Wiederhole nicht denselben Codepfad mit anderen Eingaben.** Drei Asserts, die alle denselben Zweig treffen, verschwenden dein Punktesignal. Wähle Eingaben, die *verschiedene* Pfade abdecken (Grenzen, Randfälle, der offensichtliche Hauptfall).
> - **Schreibe keine Tests, die von der print-Ausgabe abhängen**, ausser du willst das wirklich. Teste Rückgabewerte, wo du kannst — sie sind robuster gegenüber Formatierungsunterschieden.
> - **Schreibe keinen Hinweis, der nur «falsch» sagt** — gib konkrete, umsetzbare Hilfe. Die Fehlermeldung ist das Einzige, was Schüler sehen, wenn sie feststecken.

---

## Optionale Attribute

```python-check for="my-exercise" points="10" max-checks="5"
```

| Attribut | Wirkung |
|-----------|--------|
| `for="<editor-id>"` | Verknüpft den Check mit einem bestimmten Editor (erforderlich) |
| `points="N"` | Punktegewicht für die Bewertungsübersicht (Standard: 1 pro Test) |
| `max-checks="N"` | Begrenzt, wie oft ein Schüler Check ausführen kann (nützlich bei Prüfungen — verhindert Brute-Force) |

---

## Der Bewertungsablauf für Schüler

1. Der Schüler schreibt Code im Editor
2. Klickt auf **Check** (neben Run)
3. Sieht ein Panel mit jedem Test als Zeile:
   - ✅ grün, wenn bestanden (mit der Erfolgsmeldung, falls du eine geschrieben hast)
   - ❌ rot, wenn nicht bestanden (mit der Fehlermeldung + Fehler-Trace)
4. Punkte werden als `bestanden/gesamt` angezeigt (z.B. `3/5`)
5. Der Schüler korrigiert seinen Code und klickt erneut auf Check

Das `python-check`-Panel bleibt zwischen Sitzungen erhalten — Schüler sehen ihr letztes Ergebnis, wenn sie auf die Seite zurückkommen.

---

## Was du als Lehrperson siehst

Für Schüler, die in einer Klasse angemeldet sind:

- **Submissions-Oberfläche** (`Dashboard → Classes → Submissions`) — sieh die letzten Punkte und den Code jedes Schülers
- **Detail pro Schüler** — sieh ihren Code im selben Editor, den sie verwendet haben, und führe ihn selbst aus
- **Numerische Überschreibungen** — trage manuell Punkte ein, die die automatisch vergebenen Punkte überschreiben
- **Kommentare** — hinterlasse Rich-Text-Feedback pro Abgabe oder pro Code-Block

Die automatisch bewerteten `python-check`-Ergebnisse erscheinen neben deiner manuellen Bewertung, sodass du auf einen Blick siehst, wer alle Checks bestanden hat und wer genauer angeschaut werden muss.

---

## Spickzettel automatische Bewertung

| Ziel | Syntax |
|------|--------|
| Eine Aufgabe mit automatischer Bewertung koppeln | Editor mit `id="x"`, dann ` ```python-check for="x" ` |
| Einfache Meldung (für Bestanden und Nicht bestanden) | `assert ok, "Single message."` |
| Unterschiedliche Meldungen für Bestanden und Nicht bestanden | `assert ok, "Failure hint.\|Success cheer!"` |
| Mit f-String-Interpolation | `assert ok, f"Got {x} — expected {y}."` |
| Punktegewichtung | `python-check for="x" points="10"` |
| Versuche begrenzen (Prüfungskontext) | `python-check for="x" max-checks="5"` |
