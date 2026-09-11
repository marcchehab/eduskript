# Veröffentlichen und teilen

Drei Zustände steuern, wer Inhalte sehen kann: **Entwurf** (draft), **veröffentlicht** (published) und **nicht gelistet** (unlisted). Der Zustand liegt auf Seiten- und Skript-Ebene (Sammlungen sind reine Ordnungshilfen — sie haben keinen eigenen Veröffentlichungszustand). Meist schaltest du einfach Publish ein und machst weiter — aber hier ist das vollständige Bild für den Fall, dass du es brauchst.

---

## Die drei Zustände

| Zustand | Sichtbar für | In der Navigation gelistet | Anwendungsfall |
|-------|-----------|---------------------|----------|
| **Entwurf** | Nur dich (und Mitarbeitende mit Bearbeitungsrechten) | Nein | Arbeit in Bearbeitung |
| **Veröffentlicht** | Alle | Ja | Bereit für die Schülerinnen und Schüler |
| **Nicht gelistet** | Alle mit dem Link | Nein | Versteckte Übungen, Easter Eggs, Links aus einem Klassenchat |

Entwürfe sind vollständig privat. Veröffentlichte Seiten erscheinen im Inhaltsverzeichnis deines Skripts, im Index deiner Sammlung und auf deiner Frontpage. Nicht gelistete Seiten überspringen all das — man muss die URL kennen.

> [!example] Wann «nicht gelistet» glänzt
> - Eine Übung für den zweiten Versuch, die nur über einen «Streng dich mehr an»-Link erreichbar sein soll
> - Ein Skript, das du mit einer kleinen Gruppe testest, bevor du es freigibst
> - «Lösungs»-Seiten, die du nur von der Aufgabenseite aus verlinkst
> - Ein Entwurf, den eine Kollegin prüfen soll, ohne dass er öffentlich wird

---

## Veröffentlichen auf zwei Ebenen

Veröffentlicht wird auf **Seiten**- und **Skript**-Ebene — unabhängig voneinander. Sammlungen sind reine Organisationsbehälter; sie haben keinen eigenen Veröffentlichungszustand.

```
Collection (organizational only — no publish state)
 ├── Skript A (published)
 │    ├── Page 1 (published)  ← visible
 │    ├── Page 2 (draft)      ← invisible
 │    └── Page 3 (unlisted)   ← invisible in nav, visible by URL
 │
 └── Skript B (draft)         ← entire skript invisible regardless of pages
```

Eine Seite ist nur dann öffentlich sichtbar, wenn **die Seite** UND **ihr Skript** beide veröffentlicht sind. Du kannst ein ganzes Skript vorübergehend offline nehmen, indem du seinen Veröffentlichungsstatus umschaltest, ohne eine einzelne Seite anzufassen.

> [!warning] Häufiger Stolperstein
> Eine veröffentlichte Seite in einem Skript im Entwurfszustand ist **nicht** sichtbar. Die Schülerinnen und Schüler bekommen einen 404. Beim Start neuer Inhalte veröffentlichst du von unten nach oben: zuerst die Seiten, dann das Skript. Um Inhalte offline zu nehmen, stellst du das Skript auf Entwurf — jede Seite darin verschwindet auf einmal.

---

## So veröffentlichst du

Drei Orte, um den Zustand umzuschalten:

1. **Obere Symbolleiste des Page Editors** — das Publish-Dropdown
2. **Seitenliste im Manage-Panel** — Schnellschalter neben jeder Seite
3. **Page-Builder-Dashboard** — Gesamtansicht, Neuordnung per Drag-and-Drop, Sammelschalter

Für Skripts verwendest du den Skript-Editor oder das Dashboard.

In der Seitenliste zeigt jede Seite nach ihrem Titel ein kleines Symbol, das die Farbcodierung des Publish-Schalters spiegelt: ein grüner Haken für **veröffentlicht**, ein bernsteinfarbener Strich für **Entwurf** und ein violettes durchgestrichenes Auge für **nicht gelistet**.

---

## Mit Schülerinnen und Schülern teilen

URLs sind stabil und teilbar. Sobald du eine veröffentlichte Seite unter `eduskript.org/<slug>/<col>/<skript>/<page>` hast, kannst du diese URL überall teilen:

- **E-Mail** — Link einfügen
- **LMS** (Canvas, Moodle, Schoology usw.) — als externen Link hinzufügen
- **Klassenchat** (Discord, Slack, Teams) — einfügen, eine Vorschaukarte mit Titel + Beschreibung erscheint
- **Gedrucktes Arbeitsblatt** — QR-Code mit einem beliebigen Gratis-Dienst erzeugen

Das **Teilen-Symbol** in der Seitensymbolleiste kopiert die URL in deine Zwischenablage. Du kannst auch auf jede Überschrift der gerenderten Seite klicken, um einen Link direkt zu dieser Überschrift zu kopieren.

---

## Anker-Links

Jede Überschrift hat eine automatische ID, die aus dem Überschriftentext abgeleitet wird. Klicke auf eine Überschrift deiner veröffentlichten Seite → die URL erhält ein `#anchor-name`-Fragment.

```
eduskript.org/marie/intro-stats/descriptive/measures#mean-and-median
                                                    ↑ anchor link
```

Wenn du den Text einer Überschrift änderst, ändert sich auch ihr Anker. Alte Anker-Links landen weiterhin auf der Seite (kein 404), scrollen aber nicht automatisch an die richtige Stelle. Wenn du also eine Überschrift umbenennst, nachdem du den Link geteilt hast, bekommen die Schüler die Seite, aber nicht den Abschnitt.

> [!tip] Stabile Anker für wichtige Abschnitte
> Wenn du weisst, dass du wiederholt auf einen bestimmten Abschnitt verlinken wirst (z.B. aus einem Semesterplan), lege den Überschriftentext früh fest und ändere ihn nicht mehr.

---

## OG-Vorschauen beim Teilen in sozialen Medien

Eduskript erzeugt Open-Graph-Metadaten automatisch:

- **Titel** — dein Seitentitel
- **Beschreibung** — deine Seitenbeschreibung oder ein automatisch extrahierter Auszug
- **Bild** — das OG-Bild deiner Seite (in den Seiteneinstellungen gesetzt) oder das Standard-OG-Bild deiner Frontpage

Wenn also jemand deinen Link in Slack, Discord, Twitter usw. einfügt, erscheint eine Vorschaukarte. Dasselbe gilt für Messaging-Apps, die OG respektieren.

---

## Veröffentlichte Inhalte aktualisieren

Speichern, und die Änderungen sind live — kein erneutes Veröffentlichen nötig. Eduskript hat keine «Staging»-Umgebung für veröffentlichte Inhalte; die veröffentlichte Version IST die Live-Version.

Wenn du eine Sandbox möchtest, in der du arbeitest, bevor etwas live geht, hast du diese Möglichkeiten:

1. **Als Entwurf behalten**, bis alles bereit ist, dann in einem Schritt auf veröffentlicht umschalten
2. **Ein separates «Entwürfe»-Skript verwenden** für Arbeit in Bearbeitung; Seiten ins Live-Skript verschieben, wenn sie fertig sind
3. **Dein eigenes Skript forken** als Sandbox-Kopie, dort bearbeiten, dann die Änderungen zurückkopieren

Den meisten Lehrpersonen reicht Option 1.

---

## Inhalte offline nehmen

Von veröffentlicht → Entwurf umschalten. Die Seite verschwindet sofort. Schüler, die die URL aufrufen, sehen «Page not found». Wenn du eine Weiterleitung oder eine Meldung «Dieser Inhalt wurde zurückgezogen» hinterlassen möchtest, verwende stattdessen eine veröffentlichte Seite mit diesem Hinweis, statt vollständig zu depublizieren.

---

## Spickzettel Veröffentlichen

| Ziel | Wo |
|------|-------|
| Seite zwischen Entwurf/veröffentlicht umschalten | Obere Symbolleiste des Page Editors → Publish-Dropdown |
| Seite als nicht gelistet markieren | Dasselbe Dropdown → Unlisted |
| Mehrere Seiten eines Skripts umschalten | Manage im Page Editor → Seitenliste |
| Ganzes Skript veröffentlichen/depublizieren | Skript-Editor oder Dashboard |
| Link teilen | Teilen-Symbol anklicken oder URL aus der Adressleiste kopieren |
| Auf einen bestimmten Abschnitt verlinken | Überschrift anklicken oder URL mit `#anchor` einfügen |
| Abschnitt vorübergehend offline nehmen | Übergeordnetes Skript auf Entwurf stellen |
