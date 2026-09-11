# Dein erstes Skript

Willkommen — dieses Handbuch führt dich von oben nach unten durch alles, was Eduskript kann. Am Ende weisst du, wie du eine sich selbst bewertende Python-Übung baust, ein Video ohne YouTube hostest, Annotationen in Echtzeit an eine Klasse überträgst und eine abgeschottete digitale Prüfung durchführst. Diese erste Seite dient nur der Orientierung.

---

## Das 30-Sekunden-Modell

Eduskript-Inhalte haben drei Ebenen:

![Inhaltshierarchie: Sammlung → Skript → Seite](content-hierarchy.excalidraw)

Zusätzlich kannst du **Frontpages** (eigene Startseiten) haben: für deine öffentliche Website, für einzelne Sammlungen und für einzelne Skripts. Das sind ganzseitige Landingpages mit demselben Editor, die als «Eingangstür» dienen, bevor die Schülerinnen und Schüler in die Seiten eintauchen.

Alles gehört zu deinem Konto. Die URLs spiegeln die Struktur:

```
eduskript.org/<your-page-slug>                                    → your front page
eduskript.org/<your-page-slug>/<collection>                        → collection front page
eduskript.org/<your-page-slug>/<collection>/<skript>               → skript front page
eduskript.org/<your-page-slug>/<collection>/<skript>/<page>        → a lesson
```

---

## Deine öffentliche Seite einrichten

1. Erstelle ein Konto auf eduskript.org (E-Mail + Passwort oder Google/GitHub-OAuth)
2. Gehe zu **Dashboard → Page settings**
3. Wähle deinen **page slug** — deine öffentliche URL lautet `eduskript.org/<slug>`. Wähle sorgfältig: Slugs sind eindeutig, und wenn du einen änderst, gehen bestehende Links kaputt. Buchstaben, Zahlen, Bindestriche. Keine Leerzeichen, keine Unterstriche, keine Emojis.
4. Füge einen **page name** (Anzeigename) und eine **page description** hinzu (Einzeiler, der auf deiner Startseite und in OG-Vorschauen erscheint, wenn du Links teilst)

Deine öffentliche Seite ist jetzt unter `eduskript.org/<your-slug>` erreichbar. Sie bleibt leer, bis du Inhalte hinzufügst.

> [!info] Page name vs. dein Name
> Der **page name** ist die öffentliche Identität deiner Bildungsseite (z.B. «Informatik mit M. Chéhab»). Dein **persönlicher Name** steht in deinem Profil und wird nur Mitarbeitenden angezeigt. Zwei getrennte Felder, zwei getrennte Zwecke.

---

## Deinen ersten Inhalt erstellen

Der schnellste Weg:

1. **Dashboard → Page builder** — das ist deine Zentrale zum Organisieren von Inhalten
2. Klicke auf **+ New collection** — gib einen Titel ein (z.B. «Einführung in die Statistik»)
3. Klicke in der Sammlung auf **+ New skript** — (z.B. «Deskriptive Statistik»)
4. Klicke im Skript auf **+ New page** — (z.B. «Mittelwert und Median»)
5. Schreibe deinen Inhalt im Editor
6. Schalte **Published** ein, wenn du bereit bist

Das war's — deine Seite ist unter `eduskript.org/<slug>/intro-stats/descriptive/mean-median` erreichbar.

> [!tip] Alles lässt sich ziehen
> Sammlungen, Skripts und Seiten lassen sich im Page Builder per Drag-and-Drop neu anordnen. Ziehe ein Skript von einer Sammlung in eine andere. Ziehe eine Seite nach oben oder unten, um ihre Reihenfolge in der Seitenleiste zu ändern. Die Berechtigungsregeln gelten (siehe *Zusammenarbeit*).

---

## Willst du einen Vorsprung? Vorbereitete Beispiele

Bei der Registrierung wird dein Konto mit einem Skript «Welcome to Eduskript» befüllt, das eine praktische Tour ist — jede Seite ist selbst eine Eduskript-Seite mit Beispielen, die du bearbeiten und ausprobieren kannst. Wenn du frische Kopien möchtest, erstellt **Dashboard → Settings → Seed example content** sie neu.

Nutze sie als Nachschlagewerk, forke sie in deine eigenen Skripts oder lösche sie, sobald du dich sicher fühlst.

---

## URL-Struktur im Überblick

| URL-Muster | Was angezeigt wird |
|-------------|---------------|
| `/<slug>` | Deine Frontpage (eigene Startseite, falls vorhanden, sonst automatisch generierter Index) |
| `/<slug>/<col>` | Frontpage der Sammlung (oder ihre Skript-Liste) |
| `/<slug>/<col>/<skript>` | Frontpage des Skripts (oder seine Seitenliste) |
| `/<slug>/<col>/<skript>/<page>` | Einzelne Seite |

Teile jede URL direkt. Sie sind stabil — das Ändern eines Seitentitels ändert den Slug nicht, ausser du benennst den Slug ausdrücklich um.

---

## Wie weiter

Jedes Kapitel dieses Handbuchs steht für sich — wähle, was für dich relevant ist:

- **02 — Inhalte verfassen** — der Editor, Markdown-Grundlagen, die Live-Vorschau
- **03 — Veröffentlichen und teilen** — Entwurf / veröffentlicht / nicht gelistet, URLs teilen, Anker-Links
- **04 — Bilder, Zeichnungen, Diagramme** — Bilder per Drag-and-Drop, themenabhängiges Excalidraw, Farbpalette
- **05 — Dateien hinzufügen** — Dateien-Panel, das Dateispeichersystem, unterstützte Typen

Danach geht es im Abschnitt **Komponenten** weiter mit Callouts, Mathematik, Code-Editoren, SQL, Plugins und mehr.
