# Callouts

Callouts sind farbige, umrahmte Boxen, die den Blick auf bestimmte Inhalte lenken — Warnungen, Tipps, Lernziele, Beispiele, versteckte Hinweise. Sie bestehen aus gewöhnlichen Markdown-Blockquotes mit einer Typ-Markierung.

---

## Grundsyntax

```markdown
> [!note] Aufgepasst
> Das ist ein Note-Callout.
```

> [!note] Aufgepasst
> Das ist ein Note-Callout.

Die erste Zeile nach `[!type]` ist der Titel. Lässt du ihn weg, verwendet der Callout den Typnamen als Standardüberschrift.

---

## Mit eigenem Titel

```markdown
> [!warning] Vorsicht
> Diese Aktion kann nicht rückgängig gemacht werden.
```

> [!warning] Vorsicht
> Diese Aktion kann nicht rückgängig gemacht werden.

Der Titel steht auf derselben Zeile wie die Typ-Markierung. Ohne Titel verwendet der Callout eine Standardüberschrift basierend auf dem Typ.

---

## Einklappbare Callouts

Füge `-` hinzu für standardmässig eingeklappt, `+` für ausgeklappt:

```markdown
> [!tip]- Zum Ausklappen klicken
> Versteckter Inhalt. Nützlich für Hinweise, Lösungen, optionale Vertiefungen.

> [!tip]+ Standardmässig ausgeklappt
> Sichtbarer Inhalt, aber mit Einklapp-Button, damit Schüler ihn verbergen können.
```

> [!tip]- Zum Ausklappen klicken
> Versteckter Inhalt. Klicke auf den Titel oben zum Ausklappen.

Klicke auf den Titel zum Umschalten. Ideal für:
- Hinweise und Lösungen («Klicke für die Antwort»)
- Optionale Vertiefungen, die nicht jeder Schüler braucht
- Lange Beispiele, die die Seite überladen, wenn sie immer ausgeklappt sind

---

## Alle Callout-Typen

Eduskript bringt **41 Callout-Typen** mit — 15 Basistypen plus Aliase für gängige alternative Namen:

### Basistypen

| Typ | Darstellung | Geeignet für |
|------|--------|----------|
| `note` | Blau, Standard | Allgemeine Informationen |
| `tip` | Cyan | Hilfreiche Vorschläge, Produktivitätstipps |
| `info` | Blau | Definitionen, Kontext, «gut zu wissen» |
| `abstract` | Hellblau | Zusammenfassungen, Überblicke, Prüfungszustände |
| `success` | Grün | Richtige Antworten, Erfolge, Lernziele |
| `question` | Gelb | Diskussionsanstösse, Dinge zum Nachdenken |
| `example` | Violett | Durchgerechnete Beispiele, Illustrationen |
| `quote` | Grau | Zitate |
| `warning` | Orange | Vorsichtshinweise, Stolperfallen |
| `danger` | Rot | Kritische Warnungen, «tu das nicht» |
| `failure` | Rot | Falsche Antworten, häufige Fehler |
| `bug` | Rot | Bekannte Probleme, Workarounds |
| `todo` | Grau | Notizen für dich selbst, Work-in-progress |
| `solution` | Grün | Lösung zu einer Übung (oft kombiniert mit eingeklapptem `[!solution]-`) |
| `discuss` | Violett | Anstösse für Klassendiskussionen |

### Aliase

| Alias | Entspricht |
|-------|---------|
| `lernziele` (Deutsch) | `success` |
| `hint` | `tip` |
| `caution` | `warning` |
| `error` | `danger` |
| `done`, `check` | `success` |
| `exercise` | `abstract` |
| `faq`, `help` | `question` |
| `cite` | `quote` |

Verwende, was sich natürlich anfühlt — `lernziele` ist dasselbe wie `success` ist dasselbe wie `done`. Alle rendern denselben Callout.

---

## Mehrere Absätze

Alles nach der ersten Zeile ist Callout-Inhalt. Fahre mit `>` auf jeder Zeile fort:

```markdown
> [!note] Titel hier
> Erster Absatz.
>
> Zweiter Absatz.
>
> - Listenpunkt
> - Noch ein Punkt
>
> Dritter Absatz mit `Inline-Code` und einem [Link](https://example.com).
```

> [!note] Titel hier
> Erster Absatz.
>
> Zweiter Absatz.
>
> - Listenpunkt
> - Noch ein Punkt

Mathematik, Code-Blöcke, Listen und sogar verschachtelte Callouts funktionieren darin.

---

## Callouts in Callouts

```markdown
> [!example] Äusserer Callout
> Eine Erklärung.
>
> > [!warning] Verschachtelt
> > Eine Warnung innerhalb des Beispiels.
```

Nützlich für Beispiele mit Vorbehalten — aber sparsam einsetzen; tief verschachtelte Callouts werden schwer lesbar.

---

## Praktische Muster

### Versteckte Hinweise

````markdown
> [!tip]- Kommst du nicht weiter?
> Denke zuerst über die Basisfälle nach.

> [!solution]- Lösung
> ```python
> def factorial(n):
>     return 1 if n <= 1 else n * factorial(n - 1)
> ```
````

Das `-` hält ihn eingeklappt; Schüler klicken zum Aufdecken.

### Lernziele am Anfang

```markdown
> [!success] Lernziele
> Am Ende dieser Seite kannst du:
> - Eine Funktion mit Parametern definieren
> - Einen Wert zurückgeben
> - Den Unterschied zwischen Parameter und Argument erkennen
```

### Vorhersagen-dann-prüfen-Übungen

````markdown
> [!question] Vorhersage
> Was gibt dieser Code aus?
> ```python
> for i in range(3, 0, -1):
>     print(i)
> ```

> [!solution]- Prüfen
> ```python editor
> for i in range(3, 0, -1):
>     print(i)
> ```
````

Ein Code-Block (nur angezeigt), dann ein ausführbarer Editor (eingeklappt) zur Überprüfung.

---

## Callouts-Spickzettel

| Ziel | Syntax |
|------|--------|
| Standard-Callout | `> [!note]` |
| Mit Titel | `> [!warning] My title` |
| Standardmässig eingeklappt | `> [!tip]- Click to expand` |
| Ausgeklappt, aber einklappbar | `> [!tip]+ See details` |
| Mehrere Absätze | Mit `>` auf jeder Zeile fortfahren |
| Mehrzeiliger Inhalt | Leere `>`-Zeile zwischen Absätzen |
