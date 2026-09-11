# Folien präsentieren

Jede Seite kann zugleich als **Foliensatz** dienen — keine separate Datei, kein spezielles Format. Du schreibst eine normale Seite; Eduskript kann sie im Vollbild projizieren, eine Folie nach der anderen. Der Seitenquelltext ist die einzige Wahrheitsquelle: Derselbe Inhalt liest sich als scrollende Seite *oder* präsentiert sich als Folien, je nachdem, wie er geöffnet wird.

---

## Eine Präsentation starten

Öffne eine veröffentlichte Seite und klicke auf den **Present**-Button (das Projektor-Symbol neben der Annotations-Symbolleiste am unteren Bildschirmrand). Die Seite wechselt in den Vollbildmodus und zeigt eine Folie nach der anderen.

Standardmässig wird der Present-Button **nur Lehrpersonen** angezeigt — Präsentieren ist eine Unterrichtshandlung. Damit auch Schülerinnen und Schüler (und alle Besucher) die Seite präsentieren können, aktiviere **"Let anyone present this page as slides"** im Page Editor (siehe [Eine Präsentation öffentlich machen](#eine-präsentation-öffentlich-machen)).

Der Foliensatz **öffnet sich auf der Folie, zu der du gescrollt hattest** — scrolle zum Abschnitt, mit dem du beginnen willst, und drücke dann Present.

Navigation:

| Aktion | Tasten | Auf dem Bildschirm |
|--------|--------|-----------|
| Nächste Folie | `→` · `Space` · `Page Down` | Pfeil (rechter Rand) |
| Vorherige Folie | `←` · `Page Up` | Pfeil (rechter Rand) |
| Beenden | `Esc` | ✕ (oben rechts) |

Interaktive Komponenten funktionieren auch in einer Folie weiter — Code-Editoren laufen, Quiz lassen sich beantworten, Videos spielen. Tippen in einem eingebetteten Code-Editor blättert die Folie nicht um.

---

## Wie Folien aufgeteilt werden

Folien werden durch das Markdown abgegrenzt, das du ohnehin schreibst — für die Grundlagen gibt es nichts Neues zu lernen:

| Markierung | Was sie tut | Erscheint auf der Seite? |
|--------|--------------|--------------------|
| `# Heading` / `## Heading` | Beginnt eine neue Folie (die Überschrift führt die Folie an) | ja — eine normale Überschrift |
| `---` | Beginnt eine neue Folie | ja — eine horizontale Linie |
| `---/` | Beginnt eine neue Folie | **nein** — unsichtbarer Trenner |
| `---x` | Beendet die Folie und **lässt den folgenden Inhalt aus dem Foliensatz weg**, bis zum nächsten Umbruch | nein — der Text erscheint trotzdem auf der Seite |

Eine Seite mit `##`-Abschnitten präsentiert sich also ohne jeden Zusatzaufwand sinnvoll. Greif zu den anderen, wenn du feinere Kontrolle willst:

- **`---/`** — in zwei Folien aufteilen, *ohne* auf der scrollenden Seite eine horizontale Linie zu zeichnen.
- **`---x`** — lange Hintergrundtexte auf der Seite behalten, aber *nicht* auf die Folien nehmen, damit der Foliensatz knapp bleibt. Der ausgeschlossene Text erscheint auf der Seite wieder (und ist wieder folienfähig) beim nächsten `---`, `---/` oder der nächsten Überschrift.

> [!tip] Beispiel
> ```markdown
> ## Photosynthesis
> The headline reaction…
>
> ---/
>
> ## Two stages
> - Light reactions
> - Calvin cycle
>
> ---x
>
> ### Teacher notes
> Long background reading that students read on the page but that
> shouldn't clutter the projected slides.
>
> ---
>
> ## Recap
> ```
> Das sind **vier** Folien (Photosynthesis · Two stages · Recap, plus alles vor der ersten Überschrift). Der Block *Teacher notes* steht auf der Seite, wird aber im Foliensatz übersprungen.

Leere Folien entstehen nie — ein Trenner direkt vor einer Überschrift oder zwei Trenner hintereinander fallen weg.

---

## Auf einer Folie zeichnen

Während der Präsentation verwendest du die **Stift-Symbolleiste** unten (dieselben Stifte, Farben, Grössen und derselbe Radierer wie in der Annotations-Symbolleiste der Seite):

- Klicke einen Stift an, um zu zeichnen; klicke ihn erneut an, um aufzuhören (damit du auf der Folie durchklicken kannst).
- Fahre über einen Stift für sein **Farb- und Grössen**-Popover.
- Der Radierer entfernt Striche; das Papierkorb-Symbol leert die aktuelle Folie.

Folienzeichnungen sind **lokal und temporär** — sie existieren nur für die Dauer der Präsentation, werden **pro Folie** behalten (wechsle weg und zurück, und sie sind noch da) und werden **nie gespeichert**. Sie sind vollständig getrennt vom Annotationssystem der Seite.

---

## Zoomen

Die **Zoom**-Steuerung sitzt unterhalb der Navigationspfeile am rechten Rand. Fahre über das Lupen-Symbol, um einen Schieberegler einzublenden, und ziehe ihn, um die aktuelle Folie zu vergrössern oder zu verkleinern — praktisch, um ein Diagramm oder einen Code-Ausschnitt auch aus der hintersten Reihe lesbar zu machen.

---

## Eine Präsentation öffentlich machen

Aktiviere im Page Editor **"Let anyone present this page as slides"**. Ist die Option an, erscheint der Present-Button für alle Besucher, nicht nur für angemeldete Lehrpersonen. Lass sie aus (Standard), damit Präsentieren eine reine Lehrpersonen-Handlung bleibt, während die Seite selbst öffentlich lesbar ist.

Prüfungsseiten bieten keine Präsentation an.
