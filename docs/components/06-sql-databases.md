# SQL Editors

Upload a `.db` file once, students query it for the rest of the semester. SQL runs **in the browser** via SQLite-on-WebAssembly — no shared database to break, no rate limits, no "the server is down again."

Each student gets their own private copy of the database, fresh on every page load. They can run `DROP TABLE` if they want — nothing they do affects you or anyone else.

---

## Embed a SQL editor

Drop a `.db` or `.sqlite` file into your skript's files (drag-and-drop into the editor works), then reference it:

````markdown
```sql editor db="netflix.db"
SELECT title, release_date
FROM tv_show
ORDER BY release_date DESC
LIMIT 10;
```
````

Students see the query in an editor on the left, results table on the right when they hit **Run**.

The editor supports:
- Multiple result sets (run several `SELECT`s, get several tables)
- Execution time display
- "No rows returned" warning for empty queries
- Multi-line queries with comments

### HTML syntax

```html
<code-editor data-language="sql" data-db="netflix.db" data-code="SELECT * FROM tv_show LIMIT 10"></code-editor>
```

---

## Default LIMIT

Eduskript automatically appends `LIMIT 100` to any `SELECT` that doesn't already have a LIMIT clause — keeps the results table from blowing up if a student runs `SELECT * FROM huge_table`. Students can override by writing their own LIMIT.

---

## Setting up a database

Use any SQLite tool to create the `.db` file:

- **DB Browser for SQLite** (cross-platform GUI)
- **`sqlite3` CLI** (command line, ships with macOS / most Linux distros)
- **Python's `sqlite3` module** (programmatic creation)
- **Export from PostgreSQL/MySQL** to SQLite (various tools)

A minimal Python example:

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

Drag the resulting `movies.db` into your skript's editor → Eduskript shows a drop menu offering "Insert SQL editor" with the right markdown pre-filled.

---

## Schema diagrams (automatic)

For a database file `netflix.db`, if you also upload `netflix-schema.excalidraw.light.svg` and `netflix-schema.excalidraw.dark.svg`, Eduskript shows the schema diagram next to the query editor — automatically picking the right theme variant.

**Naming convention:** `{database-name}-schema.excalidraw.{light|dark}.svg`. No extra markup needed; the editor finds the schema by filename.

You can override with an explicit attribute if you want a different image:

````markdown
```sql editor db="netflix.db" schema-image="custom-schema"
SELECT * FROM tv_show LIMIT 5;
```
````

The schema image appears as a side panel that students can collapse if they want more space for the editor.

---

## Multi-file SQL editors

Same pattern as Python (see previous chapter) — consecutive blocks with the same `id` become tabs:

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

## Where the SQL runs

[SQL.js](https://sql.js.org/) (SQLite compiled to WASM) loads from a CDN on first use. The student downloads your `.db` file once (cached for a year), runs queries against it locally. Their session is in-memory — refreshing the page resets the database. Perfect for "experiment freely" exercises.

This means:
- No server, no rate limits, no "the database is down"
- Students can `DROP TABLE`, `INSERT`, `UPDATE` freely — all changes are local to their session
- Refresh = fresh database
- Performance is good for databases up to a few hundred MB; for huge data, consider sampling

---

## Query patterns that work well

> [!example] Good SQL exercise patterns
> - **Filter and aggregate:** "Find all employees in Sales with salary > $50k, grouped by department"
> - **Multi-table joins:** "List all orders from customers in Germany, with customer name and product"
> - **Ranking:** "Find the top 5 movies by IMDB rating in each genre"
> - **Subqueries and CTEs:** "Customers who placed an order larger than the average"
> - **Window functions:** "Cumulative sales by month"

> [!warning] Avoid
> - Database mutations across exercises (each query starts from a fresh copy of the database)
> - Time-sensitive queries that depend on `date('now')` returning a specific value (use fixed dates instead)

---

## SQL cheat sheet

| Goal | Syntax |
|------|--------|
| Basic SQL editor | ` ```sql editor db="my.db" ` |
| With explicit schema diagram | ` ```sql editor db="my.db" schema-image="schema-name" ` |
| Multi-file (tabbed queries) | Consecutive blocks with same `id`, each `file="..."` |
| Hide file tabs | ` ```sql editor db="my.db" single ` |
| HTML form | `<code-editor data-language="sql" data-db="my.db">` |
