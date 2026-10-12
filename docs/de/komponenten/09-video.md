# Video

Video ohne die YouTube-Steuer — keine Werbung, kein Versinken in Empfehlungen, kein «Dieses Video ist in deiner Region nicht verfügbar». Eduskript kodiert und hostet deine Videos selbst, auf Servern in der Schweiz: adaptives Streaming auf jedem Gerät, automatisch generierte Untertitel, und die Browser der Schülerinnen und Schüler sprechen beim Abspielen nur mit Schweizer Servern.

---

## Hochladen und einbetten

Lege eine `.mp4`- oder `.mov`-Datei in der **Videos**-Schublade deines Skripts ab. Sie wird für adaptives Streaming aufbereitet — die Videoliste zeigt «queued» und dann den Fortschritt in Prozent, bis sie bereit ist (bei einer 1080p-Quelle etwa ein Fünftel der Videolänge, länger, wenn andere Videos in der Warteschlange vorne sind). Schlägt die Aufbereitung fehl, zeigt die Liste den Grund und einen **Retry**-Button.

**Grenzen:** höchstens 1080p (1920×1080, hoch oder quer), 2 GB pro Datei, 2 Stunden. Grössere Videos werden vor dem Hochladen abgelehnt — exportiere sie zuerst in 1080p. Handyvideos (HEVC, gedreht, variable Bildrate) funktionieren.

Sobald sie bereit ist, bette sie in Markdown wie ein Bild ein:

```markdown
![Eine kurze Beschriftung](my-lecture.mp4)
```

Der Videoplayer bekommt:
- Poster (Vorschaubild)
- Play / Pause / Zeitleiste
- Lautstärke
- Untertitel-Umschalter (automatisch generierte Untertitel)
- Vollbild
- Adaptive Qualitätswahl

Alles automatisch. Nichts davon braucht Konfiguration.

---

## Eigene Vorschaubilder (Poster)

Standardmässig ist das Poster das allererste Bild des Videos — oft ein schwarzes Bild oder ein Logo. Wähle ein besseres, indem du einen Markdown-Bildtitel hinzufügst:

```markdown
![](lecture.mp4 "thumbnail.jpg")
```

Der Poster-Wert kann sein:
- Ein **Dateiname** eines Bilds, das du im selben Skript hochgeladen hast (aufgelöst wie jedes andere Bild)
- Eine **absolute URL** (`https://...`) — wird unverändert verwendet

Dasselbe in HTML:

```markdown
<muxvideo src="lecture.mp4" poster="thumbnail.jpg" />
```

Beide Syntaxen führen zum selben Player. Gibst du kein Poster an, wird das automatisch generierte Vorschaubild als Fallback verwendet.

---

## Automatisch generierte Untertitel

Jedes hochgeladene Video wird während der Aufbereitung automatisch transkribiert (Whisper, betrieben von Infomaniak in der Schweiz; die gesprochene Sprache wird erkannt, z. B. Deutsch oder Englisch). Schülerinnen und Schüler schalten die Untertitel über den Untertitel-Button des Players ein. Videos ohne Sprache erhalten keine Untertitel.

---

## Inline-Wiedergabe-Flags

Zwei Flags im Alt-Text ändern das Wiedergabeverhalten:

```markdown
![autoplay loop](background-video.mp4 "preview.jpg")
```

- `autoplay` — beim Laden der Seite abspielen (stumm, Browser-Richtlinie)
- `loop` — nach dem Ende automatisch neu starten

Nützlich für kurze Demo-Loops im Seitenhintergrund, Intro-Animationen oder visuelle Aufhänger am Anfang einer Lektion.

---

## Adaptives Streaming, jedes Gerät

Jeder Upload wird in zwei Qualitätsstufen aufbereitet, 720p und 480p (weniger, wenn die Quelle kleiner ist). Der Player wählt die passende anhand der Verbindung und der Playergrösse; Schülerinnen und Schüler können im Einstellungsmenü auch selbst wählen. Der Download im Skript-Export ist die 720p-Version.

---

## Wann Video, wann nicht

> [!tip] Video glänzt bei
> - Schritt-für-Schritt-Anleitungen komplexer Abläufe
> - Labordemonstrationen, die sich digital nicht nachbilden lassen
> - Vorstellungen der Lehrperson für Online-/Hybridkurse
> - Allem, was wirklich eine Bewegungsabfolge ist, die man *sehen* muss

> [!warning] Video glänzt nicht bei
> - Statischem «Talking Head erklärt ein Konzept» — Text + Diagramme + eine interaktive Demo sind meist ansprechender *und* später einfacher zu aktualisieren
> - Code-Durchgängen — ein Live-`python editor` (in dem der Schüler pausieren, bearbeiten, ausführen kann) schlägt das Zuschauen beim Tippen
> - Allem, was du später vielleicht korrigieren musst — Video zu schneiden dauert 100-mal länger als Markdown zu bearbeiten

---

## Kosten und Speicher

Video-Hosting ist in den bezahlten Plänen enthalten. Ein Video aus einem anderen Skript zu importieren (Button **Import** in der Videos-Schublade) verwendet das gespeicherte Video wieder, statt es erneut hochzuladen.

---

## Video-Spickzettel

| Ziel | Syntax |
|------|--------|
| Ein hochgeladenes Video einbetten | `![Caption](filename.mp4)` |
| Eigenes Poster aus Skript-Dateien | `![](filename.mp4 "thumbnail.jpg")` |
| Eigenes Poster von URL | `![](filename.mp4 "https://example.com/thumb.jpg")` |
| Autoplay + Loop (stummer Hintergrund) | `![autoplay loop](bg.mp4 "preview.jpg")` |
| Direkte HTML-Form | `<muxvideo src="x.mp4" poster="thumb.jpg" />` |
