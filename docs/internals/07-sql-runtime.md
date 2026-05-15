# SQL Runtime

Interactive SQL learning via client-side execution using SQL.js (SQLite compiled to WebAssembly). Students run SQL queries in the browser against teacher-uploaded database files.

## Architecture

- **SQL.js**: Loaded from CDN via script tag (avoids Next.js 16 + Turbopack build issues)
- **Database Caching**: Map-based cache allows multiple databases on the same page
- **No Server Execution**: All SQL runs in the browser — secure, scalable
- **File Storage**: Databases stored as regular skript files with content-addressed deduplication

**Key Files:**
- `src/lib/sql-executor.client.ts` — SQL.js integration and query execution
- `src/components/public/code-editor/index.tsx` — Interactive SQL editor with multi-file support
- `src/components/markdown/markdown-renderer.tsx` — SQL editor rendering in markdown
- `src/lib/remark-plugins/code-editor.ts` — Transforms code blocks to interactive editors
- `src/lib/file-storage.ts` — Database file upload/retrieval, public access support

## Usage in Markdown

Basic SQL editor:
````markdown
```sql editor db="netflix.db"
SELECT * FROM tv_show LIMIT 10;
```
````

With explicit schema image:
````markdown
```sql editor db="world_bank_indicators.db" schema-image="world_bank-schema"
SELECT country_code, indicator_value FROM indicators WHERE indicator_code = 'NY.GDP.MKTP.CD';
```
````

## Database File Management

1. In page editor, drag database file (.db, .sqlite) over CodeMirror editor
2. Select "Insert SQL editor" from popup
3. File uploaded to skript storage with content-addressed hashing
4. Markdown references DB by filename (e.g., `db="netflix.db"`)

**File Resolution:** system resolves filename to file URL via fileList lookup. Supports `.db` and `.sqlite` (tries both if renamed). Public access automatically granted for published skripts.

## Schema Visualization

Naming convention: `{database-name}-schema.excalidraw.{light|dark}.svg`. System auto-detects and displays the theme-appropriate schema next to the SQL editor.

Example for `netflix.db`:
- `netflix-schema.excalidraw.light.svg`
- `netflix-schema.excalidraw.dark.svg`

## Query Features

- **Default LIMIT 100** on SELECT queries with no LIMIT specified
- Tables rendered in canvas panel, multiple result sets, execution time displayed
- "No rows returned" warning for empty results
- **Multiple Databases**: each editor independently loads its specified DB; map-based caching prevents conflicts

## Multi-File Support

All code editors (Python, JavaScript, SQL) support multiple files with language-appropriate extensions.

- Default: `main.sql`, new files: `file2.sql`, etc.
- Add: `+` button. Rename: double-click. Remove: `X` (can't remove last file).

## Persistent User Data

IndexedDB stores per-editor state (code, active file, font size, width, transform). Auto-save debounced. Version history with manual snapshots.

**Reset behavior:** restores original markdown content; detects markdown changes vs. cached data; preserves settings when markdown unchanged.

**Versions:** manual labels, auto-version every 100 keystrokes, restore/delete previous, filter autosaves.

## Security

- DB files in published skripts are publicly accessible (no auth required for students)
- Authors retain full file control
- Content-addressed storage (SHA256), auto-dedup, extension mismatch handling, immutable caching (1yr max-age, hash-based ETag)

## Implementation

**SQL.js loading:**
```typescript
script.src = 'https://sql.js.org/dist/sql-wasm.js'
locateFile: (file) => `https://sql.js.org/dist/${file}`
```

**Caching:**
```typescript
const databaseCache = new Map<string, SqlJsDatabase>()
```

**Query execution:**
```typescript
export async function executeSqlQuery(query: string, dbPath: string): Promise<SqlExecutionResult> {
  const database = databaseCache.get(dbPath)
  if (!database) throw new Error('No database loaded')
  const queryWithLimit = applyDefaultLimit(query)
  const results = database.exec(queryWithLimit)
  return { success: true, results, executionTime }
}
```

**Markdown pipeline:**
```typescript
// ```sql editor db="netflix.db"``` → <code-editor data-db="netflix.db" />
const dbFile = markdownContext.fileList.find(f =>
  f.name === db || f.name.replace(/\.(sqlite|db)$/i, '') === db
)
const dbUrl = dbFile?.url
```
