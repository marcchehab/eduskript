# Dateien hinzufügen

Jedes Skript hat seinen eigenen Dateispeicher. Lege Dateien ab und referenziere sie von jeder Seite dieses Skripts aus per Dateiname. Eduskript kümmert sich um Deduplizierung, inhaltsadressierte Speicherung und Auslieferung.

---

## Dateien hochladen

Drei Wege:

1. **Drag-and-Drop in den Editor** — Dateien werden hochgeladen und eine Markdown-Referenz wird am Cursor eingefügt
2. **Files-Panel** (obere Symbolleiste → Files) — Drag-and-Drop oder Klick auf «Upload» für Massen-Uploads
3. **Manage-Panel** — hat ebenfalls ein Datei-Panel für Uploads ausserhalb der aktiven Seite

Dateien sind auf das Skript beschränkt. Zwei Skripts mit gleichnamigen Dateien kollidieren nicht — jedes hat seinen eigenen Speicher.

---

## Dateien im Markdown referenzieren

Verwende den Dateinamen. Das System löst ihn automatisch zur URL der Datei auf.

```markdown
Download the [dataset](data.csv).

![Schema](schema.png)

Try the [worksheet PDF](worksheet.pdf).
```

Im Hintergrund findet der Markdown-Prozessor die Datei per Name in der Dateiliste des Skripts und schreibt den Link auf `/api/files/<file-id>` um. Du musst dich nicht um IDs kümmern — verwende einfach den lesbaren Dateinamen.

> [!info] Dateinamen vs. Pfade
> Alle Dateien liegen in einem flachen Namensraum pro Skript (derzeit keine Ordner). Bei Dateinamen wird Gross-/Kleinschreibung unterschieden. Wenn du `Photo.jpg` hast und `photo.jpg` referenzierst, wird das nicht aufgelöst.

---

## Unterstützte Dateitypen

Eduskript akzeptiert und liefert jeden Dateityp aus — einige werden aber speziell behandelt:

| Typ | Endungen | Spezielles Verhalten |
|------|------------|------------------|
| **Bilder** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg` | Eingebettet mit `![]()`, skalierbar, ausrichtbar |
| **Excalidraw** | `.excalidraw.light.svg` + `.excalidraw.dark.svg` | Themenabhängiges Paar, referenziert als `name.excalidraw` |
| **Video** | `.mp4`, `.mov` | Werden an Mux weitergeleitet, erhalten adaptives Streaming und automatische Untertitel (siehe Kapitel *Video*) |
| **SQLite-Datenbanken** | `.db`, `.sqlite` | Treiben interaktive SQL-Editoren an (siehe *SQL-Datenbanken*) |
| **PDFs** | `.pdf` | Inline eingebettet oder heruntergeladen |
| **Code-Beispiele** | `.py`, `.js`, `.sql`, `.html`, `.css` usw. | Verlinkbar; keine spezielle Einbettung |
| **Daten** | `.csv`, `.json`, `.xlsx`, `.tsv` | Verlinkbar, herunterladbar |
| **Dokumente** | `.docx`, `.txt`, `.md` | Verlinkbar, herunterladbar |
| **Alles andere** | (beliebig) | Verlinkbar als Download |

---

## Inhaltsadressierte Deduplizierung

Eduskript speichert Dateien nach ihrem SHA-256-Hash, nicht nach Dateiname. Das bedeutet:

- Dieselbe Datei in fünf verschiedenen Skripts hochladen → **einmal** in S3 gespeichert
- Dieselbe Datei erneut hochladen (z.B. nachdem du einen Tippfehler in einer anderen Datei behoben hast) → kein zusätzlicher Speicher
- Der Dateiname kann sich ändern, ohne die Bytes erneut hochzuladen

Wenn eine Datei gelöscht wird, wird der zugrunde liegende Speicher per Referenzzählung verwaltet: Das eigentliche S3-Objekt wird erst entfernt, wenn kein Skript diesen Hash mehr referenziert.

Das ist aus zwei Gründen wichtig:
1. **Kosten** — du kannst riesige Datenbanken oder Videos über viele Skripts teilen, zum Preis von einem
2. **Caching** — Dateien werden mit langen Cache-Headern (1 Jahr) ausgeliefert, da der Hash garantiert, dass sich die Bytes für eine gegebene URL nie ändern

---

## Dateibereich und Eigentum

Dateien gehören zu einem Skript, nicht zu einer Seite. Folgen:

- Alle Seiten eines Skripts teilen denselben Dateipool
- Eine Datei zwischen Skripts zu verschieben bedeutet Herunterladen + erneut Hochladen (das System migriert nicht automatisch)
- Das Löschen eines Skripts entfernt seine Dateireferenzen (und referenzgezählte S3-Objekte, falls kein anderes Skript sie verwendet)
- Das Forken eines Skripts kopiert alle Dateireferenzen (kein erneuter Upload — hier glänzt die inhaltsadressierte Speicherung)

Für gemeinsame Ressourcen, die du in vielen Skripts verwenden möchtest, bietet sich die **Organisationsbibliothek** an (wenn dein Konto zu einer Organisation gehört) — Dateien dort sind in allen Skripts der Organisation zugänglich.

---

## Öffentlicher Zugriff bei veröffentlichten Inhalten

Wenn du ein Skript veröffentlichst, werden **alle Dateien in diesem Skript öffentlich zugänglich** unter `/api/files/<file-id>`. Schülerinnen und Schüler müssen sich nicht anmelden.

Entwürfe sind privat — nur du (und Mitarbeitende mit Bearbeitungsrechten) können die Datei-URLs abrufen.

> [!warning] Veröffentlicht = öffentlich
> Lege keine internen Materialien, Entwurfsinhalte oder sonst etwas Sensibles in die Dateien eines veröffentlichten Skripts. Sobald die URL einer Datei abgerufen wurde (von einem Schüler, von einem Suchmaschinen-Crawler), ist sie nicht mehr geheim. Um etwas privat zu halten, lass es in einem unveröffentlichten Skript.

---

## Datenbankdateien (SQLite)

Datenbankdateien (`.db`, `.sqlite`) erhalten volle SQL-Studio-Integration. Ziehe eine `.db` in den Editor; das Ablegemenü bietet «Insert SQL editor» an, das das passende Markdown schreibt:

````markdown
```sql editor db="netflix.db"
SELECT * FROM tv_show LIMIT 10;
```
````

Siehe das Kapitel **SQL-Datenbanken** im Abschnitt Komponenten für Abfragesyntax, Schemadiagramme und Editoren mit mehreren Dateien.

---

## Videodateien

Videodateien (`.mp4`, `.mov`) laufen über [Mux](https://mux.com) für adaptives Streaming und automatisch erzeugte Untertitel. Sie landen im **Videos**-Panel statt im Files-Panel. Referenziere sie im Markdown wie Bilder:

```markdown
![A short caption](my-lecture.mp4)
```

Siehe das Kapitel **Video** für Details zu Postern, Autoplay und Flags für die Inline-Wiedergabe.

---

## Spickzettel Dateien

| Ziel | Wie |
|------|-----|
| Datei hochladen | Drag-and-Drop in den Editor oder Files-Panel → Upload |
| Bild einbetten | `![Caption](file.png)` |
| Auf eine herunterladbare Datei verlinken | `[Download](file.pdf)` |
| Datenbank im SQL-Editor referenzieren | `` ```sql editor db="file.db" `` |
| Video einbetten | `![Caption](file.mp4)` |
| Massen-Upload | Files-Panel → mehrere Dateien auf einmal ziehen |
| Direkte URL einer Datei finden | Files-Panel → Datei → «Copy URL» |
| Datei in mehreren Skripts wiederverwenden | Erneut hochladen — dank Deduplizierung kostenlos |
