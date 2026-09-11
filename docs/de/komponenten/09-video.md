# Video

Video ohne die YouTube-Steuer — keine Werbung, kein Versinken in Empfehlungen, kein «Dieses Video ist in deiner Region nicht verfügbar». Eduskript hostet deine Videos über [Mux](https://mux.com), das heisst adaptives Streaming auf jedem Gerät plus automatisch generierte Untertitel.

---

## Hochladen und einbetten

Lege eine `.mp4`- oder `.mov`-Datei in der **Videos**-Schublade deines Skripts ab. Mux verarbeitet sie für adaptives Streaming (das dauert beim ersten Ansehen ein bis zwei Minuten — die Datei erscheint in der Videoliste mit einer «processing»-Anzeige, bis sie bereit ist).

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

Beide Syntaxen führen zum selben Player. Gibst du kein Poster an, wird das automatisch generierte Mux-Vorschaubild (Frame bei `time=0`) als Fallback verwendet.

---

## Automatisch generierte Untertitel

Jedes hochgeladene Video erhält während der Verarbeitung automatisch von Mux generierte englische Untertitel. Schülerinnen und Schüler schalten sie über den Untertitel-Button des Players ein. Mehrsprachige Untertitel stehen auf der Roadmap.

Wenn die automatisch generierten Untertitel falsch sind (Fachjargon, Akzente), kannst du sie überschreiben, indem du über die Einstellungen des Video-Panels (pro Video) eine eigene `.vtt`-Datei hochlädst.

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

Mux erzeugt automatisch mehrere Qualitätsstufen (240p, 480p, 720p, 1080p, 4K je nach Quelle). Der Player wählt die passende Qualität anhand der Verbindung und des Geräts des Schülers:

- Handy im Mobilfunknetz → 480p, ~1 MB / Minute
- Laptop im WLAN → 1080p, ~10 MB / Minute
- TV im schnellen WLAN → 4K, ~30 MB / Minute

Schüler können das über das Qualitätsmenü des Players überschreiben, wenn sie eine bestimmte Auflösung erzwingen wollen.

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

Videos zählen zu deiner Mux-Nutzung (Speicher + gestreamte Minuten). Die Gratis-Stufe deckt eine ordentliche Menge Unterrichtsinhalt ab. Für institutionelle Nutzung mit Hunderten von Videos sprich mit deinem Org-Admin über die Mux-Abrechnungsstufe.

Videos nutzen dieselbe inhaltsadressierte Deduplizierung wie Dateien — lädst du dasselbe Video in zwei Skripts hoch, wird es nur einmal gespeichert.

---

## Video-Spickzettel

| Ziel | Syntax |
|------|--------|
| Ein Mux-Video einbetten | `![Caption](filename.mp4)` |
| Eigenes Poster aus Skript-Dateien | `![](filename.mp4 "thumbnail.jpg")` |
| Eigenes Poster von URL | `![](filename.mp4 "https://example.com/thumb.jpg")` |
| Autoplay + Loop (stummer Hintergrund) | `![autoplay loop](bg.mp4 "preview.jpg")` |
| Direkte HTML-Form | `<muxvideo src="x.mp4" poster="thumb.jpg" />` |
