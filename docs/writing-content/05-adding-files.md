# Adding Files

Each skript has its own file storage for attachments.

## Uploading Files

1. Open a skript in the editor
2. Find the **Files** panel
3. Drag files in, or click **Upload**

Files are stored with the skript and can be referenced in any page within that skript.

## Referencing Files

Once uploaded, reference files in markdown:

```markdown
Download the [dataset](data.csv)

![Schema diagram](schema.png)
```

Files are served from `/api/files/{id}` — the system resolves filenames automatically.

## Supported File Types

| Type | Examples | Use case |
|------|----------|----------|
| Documents | PDF, DOCX | Handouts, readings |
| Data | CSV, JSON, Excel | Datasets for analysis |
| Code | .py, .js, .sql | Starter code |
| Database | .db, .sqlite | SQL exercises |
| Media | Images, video | Visual content |

## File Organization

Files belong to a skript, not a page. This means:
- All pages in a skript share the same files
- Move files between skripts via download/re-upload
- Deleting a skript deletes its files

## Database Files

SQLite databases (`.db`, `.sqlite`) get special treatment — they power interactive SQL editors. See the SQL component documentation for details.

## Tips

- Use clear, descriptive filenames
- Keep file sizes reasonable (< 10MB recommended)
- PDFs and images are viewable directly; other files download
