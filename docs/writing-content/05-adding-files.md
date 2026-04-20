# Files and Attachments

Each skript has its own file storage. Drop files in, reference them from any page in that skript by filename. Eduskript handles deduplication, content-addressed storage, and serving.

---

## Uploading files

Three ways:

1. **Drag and drop into the editor** — files upload and a markdown reference is inserted at the cursor
2. **Files panel** (top toolbar → Files) — drag-drop or click "Upload" for bulk uploads
3. **Manage drawer** — also has a file panel for uploads outside the active page

Files are scoped to the skript. Two skripts with files of the same name don't collide — each has its own storage.

---

## Referencing files in markdown

Use the filename. The system resolves it to the file's URL automatically.

```markdown
Download the [dataset](data.csv).

![Schema](schema.png)

Try the [worksheet PDF](worksheet.pdf).
```

Behind the scenes, the markdown processor finds the file by name in the skript's file list and rewrites the link to `/api/files/<file-id>`. You don't have to think about IDs — just use the human-readable filename.

> [!info] Filenames vs paths
> All files live in a flat namespace per skript (no folders, currently). Filenames are case-sensitive. If you have `Photo.jpg` and reference `photo.jpg`, it won't resolve.

---

## Supported file types

Eduskript will accept and serve any file type — but some get special treatment:

| Type | Extensions | Special behavior |
|------|------------|------------------|
| **Images** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg` | Embedded with `![]()`, resizable, alignable |
| **Excalidraw** | `.excalidraw.light.svg` + `.excalidraw.dark.svg` | Theme-aware pair, referenced as `name.excalidraw` |
| **Video** | `.mp4`, `.mov` | Routed to Mux, get adaptive streaming and auto-subtitles (see *Video* chapter) |
| **SQLite databases** | `.db`, `.sqlite` | Power interactive SQL editors (see *SQL Studio*) |
| **PDFs** | `.pdf` | Embedded inline or downloaded |
| **Code samples** | `.py`, `.js`, `.sql`, `.html`, `.css`, etc. | Linkable; no special embedding |
| **Data** | `.csv`, `.json`, `.xlsx`, `.tsv` | Linkable, downloadable |
| **Documents** | `.docx`, `.txt`, `.md` | Linkable, downloadable |
| **Anything else** | (any) | Linkable as a download |

---

## Content-addressed deduplication

Eduskript stores files by their SHA-256 hash, not by filename. This means:

- Upload the same file in five different skripts → stored **once** in S3
- Re-upload the same file (e.g. after fixing a typo in another file) → no extra storage
- Filename can change without re-uploading the bytes

When a file is deleted, the underlying storage is reference-counted: the actual S3 object is only removed once no skript references that hash anymore.

This matters for two reasons:
1. **Cost** — you can have huge databases or videos shared across many skripts at the cost of one
2. **Caching** — files are served with long cache headers (1 year), since the hash guarantees the bytes never change for a given URL

---

## File scoping and ownership

Files belong to a skript, not a page. Implications:

- All pages in a skript share the same file pool
- Moving a file between skripts means downloading + re-uploading (the system doesn't auto-migrate)
- Deleting a skript removes its file references (and reference-counted S3 objects if no other skript uses them)
- Forking a skript copies all file references (no re-upload — content-addressed storage shines here)

For shared resources you want to use across many skripts, consider the **organization library** (if your account is in an org) — files there are accessible across all the org's skripts.

---

## Public access for published content

When you publish a skript, **all files in that skript become publicly accessible** at `/api/files/<file-id>`. Students don't need to authenticate.

Drafts are private — only you (and collaborators with edit rights) can fetch the file URLs.

> [!warning] Published = public
> Don't put internal materials, draft content, or anything sensitive in a published skript's files. Once a file's URL is fetched (by a student, by a search crawler), it's no longer secret. To keep something private, keep it in an unpublished skript.

---

## Database files (SQLite)

Database files (`.db`, `.sqlite`) get full SQL Studio integration. Drag a `.db` into the editor; the drop menu offers "Insert SQL editor" which writes the right markdown:

````markdown
```sql editor db="movies.db"
SELECT * FROM films LIMIT 10;
```
````

See the **SQL Studio** chapter in the Components section for query syntax, schema diagrams, and multi-file editors.

---

## Video files

Video files (`.mp4`, `.mov`) are routed through [Mux](https://mux.com) for adaptive streaming and auto-generated subtitles. They land in the **Videos** panel rather than the Files panel. Reference them in markdown like images:

```markdown
![A short caption](my-lecture.mp4)
```

See the **Video** chapter for details on posters, autoplay, and inline playback flags.

---

## Files cheat sheet

| Goal | How |
|------|-----|
| Upload a file | Drag-drop into editor, or Files panel → Upload |
| Embed an image | `![Caption](file.png)` |
| Link to a downloadable file | `[Download](file.pdf)` |
| Reference a database in SQL editor | `` ```sql editor db="file.db" `` |
| Embed a video | `![Caption](file.mp4)` |
| Bulk upload | Files panel → drag multiple files at once |
| Find a file's direct URL | Files panel → file → "Copy URL" |
| Reuse a file across skripts | Re-upload — deduplication makes it free |
