# SQL Studio

Upload a `.db` file once, students query it for the rest of the semester. SQL runs **in the browser** via SQLite-on-WebAssembly — no shared database to break, no rate limits, no "the server is down again."

Each student gets their own private copy of the database, fresh on every page load. They can run `DROP TABLE` if they want — nothing they do affects you or anyone else.

---

## Embed a SQL editor

Drop a `.db` or `.sqlite` file into your skript's files (drag-and-drop into the editor works), then reference it:

````markdown
```sql editor db="netflix.db"
SELECT title, country, release_year
FROM tv_show
WHERE country = 'United States'
ORDER BY release_year DESC
LIMIT 20;
```
````

Students see the query in an editor on the left, and the results table on the right when they hit **Run**.

The editor supports multiple result sets (run several `SELECT`s, get several tables), execution time display, and a friendly "no rows returned" warning for queries that match nothing.

> [!tip] Default LIMIT
> Eduskript automatically appends `LIMIT 100` to any `SELECT` that doesn't already have a LIMIT clause — keeps the results table from blowing up if a student runs `SELECT * FROM huge_table`. Students can override by writing their own LIMIT.

---

## Schema diagrams, automatic

For a database file `netflix.db`, if you also upload `netflix-schema.excalidraw.light.svg` and `netflix-schema.excalidraw.dark.svg`, Eduskript shows the schema diagram next to the query editor — automatically picking the right theme variant.

Naming convention: `{database-name}-schema.excalidraw.{light|dark}.svg`. No extra markup needed in the markdown — the editor finds the schema by filename.

You can override with an explicit attribute if you want a different image:

````markdown
```sql editor db="netflix.db" schema-image="custom-schema"
SELECT * FROM tv_show LIMIT 5;
```
````

---

## Multi-file SQL editors

Same pattern as Python (see *Live Code* page) — consecutive blocks with the same `id` become tabs. Useful for "here's the worked example, now try a variation":

````markdown
```sql editor id="rentals" db="library.db" file="example.sql"
-- Find books rented this month
SELECT title, rented_at
FROM rentals
WHERE rented_at > date('now', '-30 days');
```

```sql editor id="rentals" db="library.db" file="your-turn.sql"
-- Your turn: count rentals per genre this year
```
````

Both tabs use the same database; queries in one don't affect the other.

---

## How students get the database

Drag-and-drop the `.db` file into the editor — Eduskript uploads it to your skript's file storage. The editor automatically gets a "SQL editor" insertion option in the drop menu, which writes the right markdown for you.

Database files are content-addressed (deduplicated by hash), so if you re-upload the same file in a different skript, it doesn't take twice the storage.

> [!info] Where the SQL runs
> SQL.js (SQLite compiled to WASM) loads from a CDN on first use. The student downloads your `.db` file once, runs queries against it locally. Their session is in-memory — refreshing the page resets the database. Perfect for "experiment freely" exercises.

---

## SQL cheat sheet

| Goal | Syntax |
|------|--------|
| Basic SQL editor | ` ```sql editor db="my.db" ` |
| With explicit schema diagram | ` ```sql editor db="my.db" schema-image="schema-name" ` |
| Multi-file (tabbed queries) | Consecutive blocks with same `id`, each `file="..."` |
| Hide file tabs | ` ```sql editor db="my.db" single ` |
