# Inhalte verfassen

Der Eduskript-Editor ist zweigeteilt: **Markdown-Quelltext links, Live-Vorschau rechts**. Während du tippst, aktualisiert sich die Vorschau in Echtzeit. Beide Bereiche scrollen synchron — scrollst du im Quelltext, folgt die Vorschau, und umgekehrt.

---

## Der Editor auf einen Blick

![Editor-Layout: Quelltext links, Live-Vorschau rechts](editor-layout.excalidraw)

Die Symbolleiste deckt die Grundlagen ab: fett, kursiv, Überschriften, Listen, Links, Bilder, Code-Blöcke, Callouts, Mathematik, Farbwähler, Dateieinfügungen. Die meisten Lehrpersonen finden zu einem Arbeitsablauf, bei dem sie Kleinigkeiten von Hand als Markdown tippen und für die grösseren Komponenten (Excalidraw-Zeichnungen, Code-Editoren, Callouts) die Symbolleiste anklicken.

---

## Standard-Markdown — was wie erwartet funktioniert

Eduskript verwendet **CommonMark + GitHub-Flavored Markdown** als Basis und ergänzt darauf eigene Erweiterungen.

| Syntax | Ergebnis |
|--------|--------|
| `# Heading 1` | Überschrift erster Ebene |
| `## Heading 2` | Überschrift zweiter Ebene |
| `**bold**` | **fett** |
| `*italic*` | *kursiv* |
| `***both***` | ***beides*** |
| `` `inline code` `` | `Inline-Code` |
| `~~strikethrough~~` | ~~durchgestrichen~~ |
| `==highlight==` | hervorgehobener Text |
| `[link text](https://example.com)` | Hyperlink |
| `![alt text](image.png)` | Bild (hochgeladene Datei) |
| `> blockquote` | Zitatblock |
| `- list item` | ungeordnete Liste |
| `1. numbered` | nummerierte Liste |
| `- [ ] task` | Aufgabenliste mit Checkbox |
| Pipe-Tabellen | volle GFM-Tabellenunterstützung |
| `---` | horizontale Linie |
| Dreifache Backticks ` ``` ` | Code-Block |

**Überschriften** sind speziell — sie erzeugen automatisch die Seitengliederung (Inhaltsverzeichnis in der rechten Seitenleiste) und werden zu Anker-Links, die du direkt teilen kannst.

---

## Hover-Symbolleisten in der Vorschau

Fahre mit der Maus über gerenderten Inhalt in der Vorschau, und kontextabhängige Symbolleisten erscheinen:

- **Über ein Bild fahren** → Griffe zum Skalieren, Ausrichtungsbuttons, Alt-Text-Editor
- **Über einen Code-Editor fahren** → Pfeile «Insert above / below», Einstellungen bearbeiten (id, Sprache, db)
- **Über eine Excalidraw-Zeichnung fahren** → «Open in editor» zum Ändern
- **Über ein Callout fahren** → Typ ändern, eingeklappt/ausgeklappt umschalten
- **Über ein Video fahren** → Poster-Auswahl, Autoplay-/Loop-Schalter

Das ist der schnellste Weg, eine Komponente anzupassen, sobald sie auf der Seite ist — du musst dir keine Attribut-Syntax merken.

---

## Die Funktionen der oberen Leiste

| Button | Was er tut |
|--------|--------------|
| **Save** | Entwurf speichern (`Ctrl+S` funktioniert auch). Wird alle paar Sekunden automatisch gespeichert. |
| **Preview** | Die gerenderte Seite in einem neuen Tab öffnen — du siehst genau, was die Schülerinnen und Schüler sehen. Funktioniert auch für Entwürfe. |
| **Publish** | Die Seite zwischen Entwurf / veröffentlicht / nicht gelistet umschalten. |
| **Manage** | Seitenpanel mit den Einstellungen des Skripts, Seitenliste, Datei-/Video-Panels. |
| **Files** | Datei-Panel für Uploads (Bilder, PDFs, Datenbanken, Code). |
| **Videos** | Video-Panel für Video-Uploads, die über Mux gehostet werden. |
| **AI ✨** | AI Edit — beschreibe eine Änderung, die KI erzeugt einen Diff, den du prüfst. |
| **Fullscreen** | Alles andere ausblenden; nur Editor + Vorschau. |

---

## Zwei Wege, dasselbe zu schreiben

Für die meisten Dinge kannst du **Markdown** ODER **HTML** verwenden. Markdown ist kürzer; HTML erlaubt zusätzliche Attribute.

```markdown
![A school of fish](fish.jpg)

<image src="fish.jpg" alt="A school of fish" width="50%" align="right" wrap />
```

Beide rendern ein Bild. Das erste nutzt die volle Breite der Datei. Das zweite lässt das Bild rechts mit 50% Breite schweben, und der Text fliesst darum herum.

Dasselbe gilt für Code-Editoren, Videos, Callouts, Plugins — nimm, was sich im jeweiligen Fall natürlich anfühlt.

> [!warning] Regeln für eigenes HTML
> Eduskript-Komponenten müssen **kleingeschrieben** sein und **Attributwerte in Anführungszeichen** haben. Kein JSX, kein PascalCase.
> - ✅ `<code-editor data-language="python">`
> - ❌ `<CodeEditor language="python">` (PascalCase)
> - ❌ `<code-editor data-id={pageId}>` (JSX-Ausdruck)
>
> Die meisten modernen Browser tolerieren Grossbuchstaben in Tags, aber der Renderer von Eduskript normalisiert vor dem Parsen alles auf Kleinbuchstaben.

---

## Entwürfe werden automatisch gespeichert, und Versionsverlauf

Jede Änderung an einer Seite wird automatisch gespeichert. Zusätzlich kannst du:

- **Manuell eine Version erstellen** — fügt dem Versionsverlauf einen beschrifteten Schnappschuss hinzu
- **Eine ältere Version wiederherstellen** — wählt einen alten Schnappschuss und ersetzt den aktuellen Entwurf
- **Automatische Versionen alle 100 Tastenanschläge** — versehentliches Löschen lässt sich rückgängig machen

Den Versionsverlauf findest du im Überlaufmenü (`⋯`) des Page Editors.

---

## Bearbeiten auf Smartphone und Tablet

Der Editor ist responsiv. Auf dem Smartphone wird die Vorschau zu einem Tab — du wischst zwischen Quelltext und Vorschau. Touch-freundliche Symbolleiste mit grösseren Zielflächen. Zeichnen auf der Seite (Annotationen) funktioniert mit Finger oder Stift.

Trotzdem: Dies ist ein Werkzeug für Lehrpersonen — der Grossteil der Arbeit passiert am Schreibtisch. Der mobile Editor ist für Last-Minute-Anpassungen gedacht, nicht für das Verfassen ganzer Lektionen.

---

## Gerade Linien und Formen zeichnen

Freihand ist für Notizen in Ordnung, für Achsen, Tangenten und Kästen weniger. Zwei Wege zu sauberer Geometrie, beide für alle verfügbar, die auf einer Seite zeichnen — Lehrperson oder Schüler, Maus, Stift oder Finger:

| | |
|---|---|
| **Shift beim Zeichnen gedrückt halten** | Der Strich wird zu einer geraden Linie von deinem Startpunkt bis zur aktuellen Position des Zeigers. Lass Shift los, und du bist wieder im Freihandmodus. |
| **Shift + Alt** | Dasselbe, aber der Winkel rastet in 15°-Schritten ein — horizontal, vertikal und 45° werden exakt. |
| **Eine halbe Sekunde stillhalten, dann abheben** | Der Strich wird erkannt und neu gezeichnet: ein ungefähr gerader wird zur Linie, ein geschlossener runder zum Kreis, ein kastenförmiger zum Rechteck. Was nicht klar passt, bleibt genau so, wie es gezeichnet wurde. |

Das Ergebnis ist ein gewöhnlicher Strich — Radierer, Rückgängig, Teilen mit einer Klasse und das KI-Feedback behandeln ihn wie alles andere, was du zeichnest.

**Gerade Linien bleiben bearbeitbar.** Ohne ausgewählten Stift oder Radierer fährst du über eine gerade Linie: An jedem Ende erscheint ein Griff. Ziehe einen Griff, um dieses Ende zu verschieben, ziehe die Linie selbst, um das Ganze zu verschieben. Kreise, Rechtecke und Freihandstriche lassen sich so nicht bearbeiten — dafür radieren und neu zeichnen.

---

## Produktive Gewohnheiten

> [!tip] Nutze die Symbolleiste für das, was schwer zu tippen ist
> Code-Editoren, Excalidraw-Zeichnungen, Callouts und Farb-Spans haben gerade genug Syntax, dass die Symbolleiste Zeit spart. Fliesstext, Überschriften, Listen und Hervorhebungen tippst du von Hand — das geht schneller.

> [!tip] Überschriften sind deine Gliederung
> Verwende `##` für Hauptabschnitte und `###` für Unterabschnitte. Die Schülerinnen und Schüler sehen sie in der Gliederung rechts, können zum Springen klicken und Anker-Links teilen.

> [!tip] Vorschau auf einem echten Gerät
> Klicke auf Preview, kopiere die URL, öffne sie auf deinem Smartphone oder dem Laptop einer Kollegin. So findest du Schriftgrössen- und Layoutprobleme, die nur bei bestimmten Breiten auftreten.
