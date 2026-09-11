# Plugins

Plugins sind eigene interaktive Komponenten, die von anderen Lehrpersonen (oder dir) gebaut wurden. Alles, was du mit HTML/CSS/JS bauen kannst, kann ein Plugin sein: eine Uhr für modulare Arithmetik, ein Dijkstra-Visualisierer, eine eigene Umfrage, ein 3D-Molekülbetrachter, ein Konjugationstrainer für lateinische Verben.

Dieses Kapitel behandelt das **Einbetten** bestehender Plugins in deine Seiten. Zum **Bauen** eines neuen Plugins siehe das Kapitel «Plugins» im Developer Guide.

---

## Ein Plugin einbetten

Eine Zeile:

```markdown
<plugin src="author-page-slug/plugin-slug" />
```

Der `src` ist `<owner-slug>/<plugin-slug>` — wie eine GitHub-Repo-Kennung.

```markdown
<plugin src="marie/mod-clock" />
<plugin src="marcchehab/dijkstra" />
<plugin src="informatikgarten/excalidraw" />
```

Das Plugin wird inline als sandboxed Widget in deiner Seite gerendert. Schülerinnen und Schüler können damit interagieren; ihr Zustand wird pro Schüler und pro Seite gespeichert.

---

## Konfiguration übergeben

Attribute auf dem `<plugin>`-Tag werden zu Konfigurationswerten im Plugin:

```markdown
<plugin
  src="informatikgarten/mod-clock"
  max="100"
  mod="7"
  font="14"
  lang="de"
/>
```

Der Plugin-Autor legt fest, welche Attribute sein Plugin versteht. Fahre in **Dashboard → Plugins** mit der Maus über den Eintrag eines Plugins, um die unterstützten Konfigurationsschlüssel zu sehen.

> [!info] Keine Allowlist
> Der Host prüft Attributnamen nicht gegen ein Schema. Du kannst jedes Attribut übergeben; wenn das Plugin es nicht verwendet, passiert nichts. Plugin-Autoren dokumentieren ihre Konfigurationsschlüssel (üblicherweise in der Plugin-Beschreibung oder einem Info-Popup).

---

## Inhalt übergeben

Text zwischen den Tags wird als `content`-Konfiguration übergeben:

```markdown
<plugin src="marie/concept-graph">
node A -> node B -> node C
node B -> node D
</plugin>
```

Das Plugin erhält `"node A -> node B -> ..."` als Inhalt und rendert entsprechend. Wird von Plugins verwendet, die eine domänenspezifische Eingabesprache entgegennehmen (Graphbeschreibungen, mathematische Ausdrücke, Musiknotation usw.).

---

## Anfangshöhe

```markdown
<plugin src="marie/mod-clock" height="500" />
```

Setzt die Anfangshöhe des iframes in Pixeln. Nach dem Laden passt sich das Plugin automatisch an seinen Inhalt an (über den ResizeObserver des SDK), das dient also hauptsächlich dazu, einen Layout-Sprung beim ersten Rendern zu vermeiden.

---

## Wie Plugins funktionieren, in einem Diagramm

![Plugins laufen in sandboxed iframes und kommunizieren mit dem Host über postMessage](plugin-sandbox.excalidraw)

Plugins laufen in **sandboxed iframes** mit strikter Content-Security-Policy:
- Kein Netzwerkzugriff (kann keine beliebigen URLs per `fetch()` laden)
- Kein Zugriff auf Cookies, Storage oder DOM deiner Seite
- Kann nur über den Host persistieren (rate-limitiert, grössenbeschränkt)
- Kann Skripte nur von freigegebenen CDNs laden

Das heisst, ein Plugin einzubetten ist **sicher** — selbst eines von jemandem, den du nicht kennst, kann keine Schülerdaten abgreifen, keine Browser fingerprinten und nicht aus seinem iframe ausbrechen.

---

## Zustand pro Schüler

Wenn ein Schüler mit einem Plugin interagiert (klickt, Text eingibt, eine Auswahl trifft), kann das Plugin den Zustand über das SDK speichern. Dieser Zustand:

- Ist **pro Schüler** (der Zustand jedes Schülers ist privat)
- Ist **pro Seite** (dasselbe Plugin auf zwei Seiten eingebettet hat zwei getrennte Zustände)
- Ist **pro Plugin-Instanz** (zwei Einbettungen desselben Plugins auf derselben Seite würden sich den Zustand teilen — es gibt nur einen Slot)
- Bleibt über Sitzungen hinweg erhalten

Schüler müssen zum Speichern nichts tun — es passiert automatisch. Sie sehen ihren vorherigen Zustand, wenn sie zurückkommen.

---

## Plugins durchsuchen und entdecken

**Dashboard → Plugins → Browse** listet alle veröffentlichten Plugins der Plattform. Filtere nach:
- Kategorie (Visualisierung, Berechnung, Interaktion usw.)
- Autor
- Zuletzt aktualisiert
- Am häufigsten eingebettet

Klicke auf ein Plugin, um zu sehen:
- Eine Live-Vorschau
- Beschreibung und unterstützte Konfigurationsschlüssel
- Autor und HTML-Quelltext
- «Embed in skript» — kopiert das Markdown in deine Zwischenablage
- «Fork» — erstellt eine Kopie unter deinem Namensraum, die du anpassen kannst

---

## Ein Plugin forken

Wenn das Plugin von jemand anderem *fast* das ist, was du willst, forke es:

1. Öffne das Plugin in **Dashboard → Plugins → Browse**
2. Klicke auf **Fork**
3. Passe das Entry-HTML nach deinem Geschmack an
4. Speichere es unter deinem eigenen Slug

Das Einbetten von `<plugin src="your-slug/forked-plugin" />` verwendet deine geforkte Version. Das Original bleibt unverändert.

---

## Wann einbetten, wann ein Plugin bauen

> [!tip] Einbetten, wenn
> - Genau das, was du willst, bereits existiert
> - Du es über Attribute anpassen kannst (keine Codeänderungen nötig)
> - Du dich an dem orientieren willst, was andere Lehrpersonen in deiner Organisation verwenden

> [!example] Bauen (oder forken), wenn
> - Du ein Verhalten brauchst, das nirgends existiert
> - Du ein Fach mit spezifischen Visualisierungen unterrichtest (Wellenformen, Chemie-Moleküle, Konjugationsübungen)
> - Du ein Plugin willst, das zu deinem Unterrichtsstil passt (Farben, Layout, Sprache)

Das Bauen wird im Developer Guide behandelt. Die Kurzfassung: Schreibe eine einzelne HTML-Datei mit eingebettetem JS, füge sie in das Formular **Plugins → New** ein, gib ihr einen Slug, veröffentliche sie.

---

## Spickzettel Einbetten

| Ziel | Syntax |
|------|--------|
| Ein Plugin einbetten | `<plugin src="owner-slug/plugin-slug" />` |
| Konfiguration übergeben | `<plugin src="..." myparam="value" />` (beliebiger Attributname) |
| Inhalt übergeben (DSL-Eingabe) | `<plugin src="...">my content here</plugin>` |
| Anfangshöhe setzen | `<plugin src="..." height="500" />` |
| Plugins durchsuchen | Dashboard → Plugins → Browse |
| Zum Anpassen forken | Plugin-Seite → Fork-Button |
