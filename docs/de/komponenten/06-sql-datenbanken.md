# SQL-Datenbanken

Lade eine `.db`-Datei einmal hoch, und die Schülerinnen und Schüler fragen sie den Rest des Semesters ab. SQL läuft **im Browser** via SQLite-on-WebAssembly — keine gemeinsame Datenbank, die kaputtgehen kann, keine Rate-Limits, kein «der Server ist schon wieder down».

Jeder Schüler erhält eine eigene private Kopie der Datenbank, frisch bei jedem Laden der Seite. Sie können `DROP TABLE` ausführen, wenn sie wollen — nichts, was sie tun, betrifft dich oder jemand anderen.

---

## Einen SQL-Editor einbetten

Lege eine `.db`- oder `.sqlite`-Datei in den Dateien deines Skripts ab (Drag-and-drop in den Editor funktioniert) und referenziere sie:

````markdown
```sql editor db="netflix.db"
SELECT title, release_date
FROM tv_show
ORDER BY release_date DESC
LIMIT 10;
```
````

Die Schüler sehen die Abfrage links in einem Editor und rechts die Ergebnistabelle, sobald sie auf **Run** klicken.

Der Editor unterstützt:
- Mehrere Ergebnismengen (mehrere `SELECT`s ausführen, mehrere Tabellen erhalten)
- Anzeige der Ausführungszeit
- Warnung «No rows returned» bei leeren Abfragen
- Mehrzeilige Abfragen mit Kommentaren

### HTML-Syntax

```html
<code-editor data-language="sql" data-db="netflix.db" data-code="SELECT * FROM tv_show LIMIT 10"></code-editor>
```

---

## Standard-LIMIT

Eduskript hängt automatisch `LIMIT 100` an jedes `SELECT` an, das noch keine LIMIT-Klausel hat — so explodiert die Ergebnistabelle nicht, wenn ein Schüler `SELECT * FROM huge_table` ausführt. Schüler können das mit einem eigenen LIMIT überschreiben.

---

## Eine Datenbank einrichten

Erstelle die `.db`-Datei mit einem beliebigen SQLite-Werkzeug:

- **DB Browser for SQLite** (plattformübergreifende GUI)
- **`sqlite3`-CLI** (Kommandozeile, bei macOS / den meisten Linux-Distributionen dabei)
- **Pythons `sqlite3`-Modul** (programmatische Erstellung)
- **Export aus PostgreSQL/MySQL** nach SQLite (verschiedene Werkzeuge)

Ein minimales Python-Beispiel:

```python
import sqlite3

conn = sqlite3.connect('movies.db')
cursor = conn.cursor()

cursor.execute('''
    CREATE TABLE films (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER,
        director TEXT
    )
''')

cursor.executemany('INSERT INTO films (title, year, director) VALUES (?, ?, ?)', [
    ('The Matrix', 1999, 'Wachowskis'),
    ('Inception', 2010, 'Nolan'),
    ('Parasite', 2019, 'Bong'),
])

conn.commit()
conn.close()
```

Ziehe die erzeugte `movies.db` in den Editor deines Skripts → Eduskript zeigt ein Drop-Menü mit «Insert SQL editor» und dem passenden, vorausgefüllten Markdown.

---

## Schema-Diagramme (automatisch)

Wenn du zu einer Datenbankdatei `netflix.db` zusätzlich `netflix-schema.excalidraw.light.svg` und `netflix-schema.excalidraw.dark.svg` hochlädst, zeigt Eduskript das Schema-Diagramm neben dem Abfrage-Editor — und wählt automatisch die passende Theme-Variante.

**Namenskonvention:** `{database-name}-schema.excalidraw.{light|dark}.svg`. Kein zusätzliches Markup nötig; der Editor findet das Schema über den Dateinamen.

Mit einem expliziten Attribut kannst du ein anderes Bild angeben:

````markdown
```sql editor db="netflix.db" schema-image="custom-schema"
SELECT * FROM tv_show LIMIT 5;
```
````

Das Schema-Bild erscheint als Seitenpanel, das die Schüler einklappen können, wenn sie mehr Platz für den Editor wollen.

---

## SQL-Editoren mit mehreren Dateien

Gleiches Muster wie bei Python (siehe vorheriges Kapitel) — aufeinanderfolgende Blöcke mit derselben `id` werden zu Tabs:

````markdown
```sql editor id="netflix-demo" db="netflix.db" file="example.sql"
-- Beispiel: die zuletzt veröffentlichten TV-Serien
SELECT title, release_date
FROM tv_show
ORDER BY release_date DESC
LIMIT 10;
```

```sql editor id="netflix-demo" db="netflix.db" file="your-turn.sql"
-- Jetzt du: liste die 10 längsten Filme auf
```
````

Beide Tabs verwenden dieselbe Datenbank; Abfragen im einen beeinflussen den anderen nicht.

---

## Wo das SQL läuft

[SQL.js](https://sql.js.org/) (SQLite, kompiliert zu WASM) wird beim ersten Gebrauch von einem CDN geladen. Der Schüler lädt deine `.db`-Datei einmal herunter (ein Jahr lang gecacht) und führt Abfragen lokal darauf aus. Seine Sitzung liegt im Arbeitsspeicher — ein Neuladen der Seite setzt die Datenbank zurück. Perfekt für «Experimentiere frei»-Aufgaben.

Das bedeutet:
- Kein Server, keine Rate-Limits, kein «die Datenbank ist down»
- Schüler können frei `DROP TABLE`, `INSERT`, `UPDATE` ausführen — alle Änderungen bleiben lokal in ihrer Sitzung
- Neuladen = frische Datenbank
- Die Performance ist gut für Datenbanken bis zu einigen hundert MB; bei riesigen Daten lieber eine Stichprobe verwenden

---

## Abfragemuster, die gut funktionieren

> [!example] Gute Muster für SQL-Aufgaben
> - **Filtern und aggregieren:** «Finde alle Angestellten im Verkauf mit Lohn > 50'000 $, gruppiert nach Abteilung»
> - **Joins über mehrere Tabellen:** «Liste alle Bestellungen von Kunden in Deutschland auf, mit Kundenname und Produkt»
> - **Rangfolge:** «Finde pro Genre die 5 Filme mit dem höchsten IMDB-Rating»
> - **Unterabfragen und CTEs:** «Kunden, die eine Bestellung über dem Durchschnitt aufgegeben haben»
> - **Window-Funktionen:** «Kumulierte Verkäufe pro Monat»

> [!warning] Vermeide
> - Datenbank-Mutationen über mehrere Aufgaben hinweg (jede Abfrage startet mit einer frischen Kopie der Datenbank)
> - Zeitabhängige Abfragen, die darauf angewiesen sind, dass `date('now')` einen bestimmten Wert liefert (verwende stattdessen feste Daten)

---

## SQL-Spickzettel

| Ziel | Syntax |
|------|--------|
| Einfacher SQL-Editor | ` ```sql editor db="my.db" ` |
| Mit explizitem Schema-Diagramm | ` ```sql editor db="my.db" schema-image="schema-name" ` |
| Mehrere Dateien (Abfragen in Tabs) | Aufeinanderfolgende Blöcke mit gleicher `id`, je mit `file="..."` |
| Datei-Tabs ausblenden | ` ```sql editor db="my.db" single ` |
| HTML-Form | `<code-editor data-language="sql" data-db="my.db">` |
