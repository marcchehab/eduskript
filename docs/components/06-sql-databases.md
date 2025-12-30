# SQL Databases

Run SQL queries against real SQLite databases in the browser.

## Basic Syntax

````markdown
```sql editor db="movies.db"
SELECT title, year
FROM films
WHERE year > 2000
LIMIT 10;
```
````

**HTML syntax**:
```html
<code-editor data-language="sql" data-db="movies.db"></code-editor>
```

## Setup

1. Create a SQLite database file (`.db` or `.sqlite`)
2. Upload it to your skript's files
3. Reference it with `db="filename.db"`

## Creating Database Files

Use any SQLite tool:
- **DB Browser for SQLite** (GUI)
- **sqlite3** command line
- **Python sqlite3** module
- Export from other databases

## Example Workflow

```python
# Create a sample database with Python
import sqlite3

conn = sqlite3.connect('movies.db')
cursor = conn.cursor()

cursor.execute('''
    CREATE TABLE films (
        id INTEGER PRIMARY KEY,
        title TEXT,
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

Upload `movies.db` to your skript, then use it in SQL editors.

## Schema Display

Add a schema diagram that auto-displays with the editor:

1. Create `movies-schema.excalidraw` with your ER diagram
2. Export light and dark SVG versions
3. The editor shows the schema automatically

Or specify manually:
````markdown
```sql editor db="movies.db" schema-image="my-schema"
SELECT * FROM films;
```
````

## Features

- **Auto-limit**: SELECT queries get `LIMIT 100` by default
- **Multiple queries**: Run several statements separated by `;`
- **Persistent state**: Student queries are saved
- **Read-only data**: Students can't modify the database permanently

## Tips

- Keep databases small (< 5MB) for fast loading
- Include interesting data students want to explore
- Provide schema documentation or diagrams
- Start with simple queries, build complexity
