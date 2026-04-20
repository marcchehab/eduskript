# SQL Studio

Upload a `.db` file once, students query it for the rest of the semester. SQL runs **in the browser** via SQLite-on-WASM — no shared database to break, no rate limits. Each student gets their own private copy, fresh on every page load.

---

## Embed a SQL editor

Drop a `.db` or `.sqlite` file into your skript, then:

````markdown
```sql editor db="netflix.db"
SELECT title, country, release_year
FROM tv_show
WHERE country = 'United States'
ORDER BY release_year DESC
LIMIT 20;
```
````

Multi-query support, execution time, result tables, friendly "no rows" warning. SELECTs auto-get `LIMIT 100` if you don't specify one.

---

## Schema diagrams, automatic

Upload `mydb-schema.excalidraw.light.svg` + `.dark.svg` alongside your `.db` file, and Eduskript shows the schema next to the editor — theme-aware, no markup needed.

Override with an explicit attribute if you want a different image:

````markdown
```sql editor db="netflix.db" schema-image="custom-schema"
SELECT * FROM tv_show LIMIT 5;
```
````

---

## How it works

SQLite compiled to WebAssembly loads from a CDN. The student downloads your `.db` once (cached for a year), runs queries locally. Their session is in-memory — refreshing the page resets the database.

So students can `DROP TABLE`, `UPDATE`, `INSERT` freely. Nothing they do affects you or anyone else. Perfect for "experiment freely" exercises.

---

## Multi-file editors

Same pattern as Python: consecutive blocks with the same `id` → tabs.

````markdown
```sql editor id="rentals" db="library.db" file="example.sql"
SELECT title FROM rentals LIMIT 5;
```

```sql editor id="rentals" db="library.db" file="your-turn.sql"
-- Your turn: count rentals per genre
```
````

---

## Cheat sheet

| Goal | Syntax |
|------|--------|
| Basic SQL editor | ` ```sql editor db="my.db" ` |
| Schema diagram next to it | Upload `my-schema.excalidraw.{light,dark}.svg` |
| Multi-file tabs | Consecutive blocks, same `id`, each `file="..."` |
