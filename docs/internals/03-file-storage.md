# File Storage

Files are stored in S3-compatible object storage with content-addressed deduplication.

## Architecture

```
User uploads file
    ↓
Compute SHA256 hash
    ↓
Check if hash exists in S3
    ↓ (no)                    ↓ (yes)
Upload to S3               Skip upload
    ↓                          ↓
Create File record with hash
```

## Storage Location

**Production:** Scaleway S3 bucket
**Development:** Local or Scaleway (configure via env vars)

```bash
SCALEWAY_REGION=fr-par
SCALEWAY_ENDPOINT=https://s3.fr-par.scw.cloud
SCALEWAY_BUCKET=eduskript-user-data
SCALEWAY_ACCESS_KEY_ID=...
SCALEWAY_SECRET_ACCESS_KEY=...
```

## File Model

```prisma
model File {
  id          String  @id
  name        String           # Human-readable name
  hash        String?          # SHA256 of content
  contentType String?          # MIME type
  size        BigInt?
  skriptId    String           # Parent skript
  parentId    String?          # For directories
  createdBy   String

  @@unique([parentId, name, skriptId])
}
```

## Content Addressing

Files are stored by hash, not by name:

```
S3 path: /{hash}.{extension}

Example: /a1b2c3d4e5f6...abc.png
```

Benefits:
- **Deduplication**: Same file uploaded twice = stored once
- **Immutable**: Content never changes for a given hash
- **Cacheable**: Long cache headers (1 year)

## Upload Flow

```typescript
// src/lib/s3.ts

export async function uploadTeacherFile(
  hash: string,
  extension: string,
  buffer: Buffer,
  contentType: string
) {
  const key = `${hash}.${extension}`

  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.SCALEWAY_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))
}
```

## Download/Serve Flow

```typescript
// src/app/api/files/[id]/route.ts

export async function GET(request, { params }) {
  const file = await prisma.file.findUnique({
    where: { id: params.id }
  })

  // Check access (published skript or author)
  if (!await canAccessFile(file)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Redirect to S3 or stream
  const url = getFileUrl(file.hash, file.extension)
  return Response.redirect(url)
}
```

## Deduplication Check

```typescript
export async function teacherFileExists(hash: string, extension: string) {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: process.env.SCALEWAY_BUCKET,
      Key: `${hash}.${extension}`,
    }))
    return true
  } catch {
    return false
  }
}
```

## File References in Markdown

Markdown uses filenames:
```markdown
![Diagram](schema.png)
```

The `remarkImageResolver` plugin resolves to:
```html
<img src="/api/files/abc123">
```

## Directory Support

Files can be nested:

```typescript
// Create directory
await prisma.file.create({
  data: {
    name: 'images',
    isDirectory: true,
    skriptId,
    createdBy: userId,
  }
})

// Create file in directory
await prisma.file.create({
  data: {
    name: 'photo.jpg',
    parentId: directoryId,  // Points to directory
    skriptId,
    hash: '...',
    // ...
  }
})
```

## Cleanup

Orphaned S3 objects (hash not referenced by any File record) can be cleaned up periodically. Not currently automated.
