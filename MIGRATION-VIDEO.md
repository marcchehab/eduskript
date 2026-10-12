# Video hosting: Mux → self-hosted (encoder on the VPS, HLS on our S3)

Goal: a student's browser playing an Eduskript video contacts only Swiss
hosts: eduskript.org and our S3 (`s3.pub1.infomaniak.cloud`, bucket
`eduskript-teacher-files`). No per-month video SaaS fee (Infomaniak VOD was
rejected: fixed CHF 20+/month for ~10 GB traffic / 25 GB storage).

Branch `self-video`.

| Piece | File |
|---|---|
| Upload limits (≤1080p either orientation, ≤2 GB, ≤2 h) | `src/lib/video-limits.ts` (browser), `scripts/video-worker/lib.mjs` (worker) |
| Upload → queue, retry, delete cleanup | `src/lib/video-jobs.server.ts`, `api/videos/upload-url`, `api/videos/[id]/uploaded`, `api/videos/[id]/retry` |
| Queue (Postgres, advisory lock = one worker) | `scripts/video-worker/queue.mjs`, table `video_encode_jobs` |
| Encoder | `scripts/video-worker.mjs` (Kamal role `encoder`) |
| Cache revalidation after a job | `api/videos/revalidate` (Bearer `CRON_SECRET`) |
| Provider → playback (Mux fallback) | `src/lib/video-playback.ts` |
| Player (hls.js, custom controls, quality menu, scrub previews) | `src/components/markdown/hls-video.tsx` |
| Migration | `scripts/migrate-mux-to-self.mjs` |

## Pipeline

1. Browser reads the file's resolution locally (`<video>` loadedmetadata, no
   upload) and refuses >1080p / >2 GB / >2 h with an English message.
2. `upload-url` creates the row (provider `self`, status `waiting`) and a
   presigned PUT to `video-uploads/<random>.<ext>` that signs Content-Type and
   Content-Length (a different size gets 403 from the storage). The
   original stays in S3.
3. `uploaded` creates a `video_encode_jobs` row (`s3:<key>`, output prefix
   `videos/<uuid>/`) and links the video → status `queued`.
4. The encoder (one job at a time, `nice 19` + `ionice -c3`, container
   capped at 2 CPUs with low CPU shares) re-validates with ffprobe, then:
   one ffmpeg run → 720p (CRF 23, ≤3 Mbit/s) + 480p (CRF 24, ≤1.2 Mbit/s)
   MP4s, x264 `veryfast`, keyframes every 4 s, CFR ≤30 fps, yuv420p,
   autorotate (handles HEVC/VP9/AV1, 10-bit, rotation, VFR, odd sizes,
   missing audio); each MP4 remuxed (no re-encode) into HLS (MPEG-TS, 4 s
   segments) + master playlist; 720p MP4 = download; poster; scrub sprites
   (1 frame / 5 s, 160 px, 10×10 sheets) + thumbnails VTT; audio → mono
   16 kHz Opus in 20-min chunks → Infomaniak AI Whisper (async batch API,
   word timestamps) → WebVTT (silent / no-audio videos get none; a
   transcription failure leaves the video without captions, not failed).
   Upload under the prefix; status/progress mirrored into `Video.metadata`
   of all linked rows; ping `/api/videos/revalidate`.
5. Failures: bad input → `failed` at once with a readable reason (dashboard
   shows it + **Retry**); other errors retried 3× with backoff (1 min,
   2 min). A worker that dies mid-job: the next worker (after taking the
   advisory lock) requeues its job; after 3 attempts it fails.

Measurements (local Ryzen 9 9950X3D, `taskset -c 0,1` = 2 cores, `nice 19`):
- 15.5 s 720p clip: encode 1.5 s, HLS/poster/sprites 0.2 s, Whisper 4.5 s.
- 7:51 1080p (Marc's Mux video as a local file): full job without captions
  (720p + 480p encode, HLS remux, MP4, poster, sprites) 55 s wall, 97 s CPU.
  A plain 720p-only veryfast encode of the same file takes 32 s here vs. 55 s
  on the VPS (Marc's measurement, 2 of 4 EPYC Genoa vCPUs) → factor ≈ 1.7 →
  **≈ 95 s per 8 min of 1080p on the VPS** (≈ 0.2× real time; a 2-hour
  lecture ≈ 25 min). Whisper adds 25–100 s of waiting (no local CPU); upload
  of ~240 files took 43 s from a home line, much less from the VPS.
- Read live from Mux HLS (migration): encode wall time is bounded by the
  Mux download, ≈ 1–2 min for the same video.

Storage: ~45 MB per 8 min of 1080p source (720p HLS 13 MB, 480p 8 MB,
download MP4 11 MB, sprites/poster < 1 MB) plus the original.

## Rollout (Marc)

1. **Image size**: the runtime image gains Debian's ffmpeg (~380 MB on top of
   LibreOffice). The web role doesn't use it; acceptable for one image /
   two roles. Alternative if it matters: a static ffmpeg build in a separate
   encoder image.
2. **Deploy** (`bin/deploy`). Runs migration `20261012085638_self_hosted_video`
   (`videos.encode_job_id`, table `video_encode_jobs`) and boots the new
   `encoder` role (`config/deploy.yml`: `cmd: node scripts/video-worker.mjs`,
   `cpus: 2`, `cpu-shares: 128`, `memory: 1g`). `docker-entrypoint.sh` now
   runs a role's `cmd` instead of the web start sequence. No new secrets:
   the encoder uses the existing `DATABASE_URL`, `S3_*`, `SCW_TEACHER_BUCKET`,
   `INFOMANIAK_AI_*`, `CRON_SECRET`. Check `bin/kamal app logs -r encoder`
   for "started (ionice: true)".
   Memory budget: 2 × 2.5 g web (deploy overlap) + 2 g db + 0.25 g caddy +
   1 g encoder = 8.25 g on an 8 GB host — only during the overlap; lower the
   encoder to 768m or stop it during deploys if that is a concern.
3. **S3 CORS**: nothing to do — `eduskript-teacher-files` already sends
   `Access-Control-Allow-Origin: *` (Swift container metadata, checked
   2026-10-12 with an `Origin` header on a playlist). hls.js fetches
   playlists/segments/VTT cross-origin from eduskript.org and custom domains.
4. **Smoke test**: upload a short clip (dashboard → Videos), watch
   queued → % → ready, embed it, open the page logged out: network tab shows
   only eduskript.org + s3.pub1.infomaniak.cloud; quality menu, scrub
   thumbnails and captions work. Try a 4K file: refused before upload.
   If the page still shows "Video is still processing" after the dashboard
   says ready, the revalidate ping failed — `VIDEO_WORKER_APP_URL`
   (https://eduskript.org) must be reachable from the encoder container.
5. **Migrate Mux videos** (queues jobs; the encoder works through them):
   ```bash
   bin/kamal app exec -i 'node scripts/migrate-mux-to-self.mjs --dry-run'
   bin/kamal app exec -i 'node scripts/migrate-mux-to-self.mjs --limit 1'
   # check that video, then:
   bin/kamal app exec -i 'node scripts/migrate-mux-to-self.mjs'
   ```
   Rows keep playing from Mux until their job is done. Idempotent and
   resumable. Page copies sharing a Mux asset share one job. A row whose
   (filename, uploader) collides with an existing `self` row stays on Mux
   and is printed.
6. **Verify**:
   `SELECT status, count(*) FROM video_encode_jobs GROUP BY 1;` → all `done`;
   `SELECT provider, count(*) FROM videos GROUP BY 1;` → no `mux` left
   (except printed collisions). Failed jobs: see `error`, retry from the
   dashboard or `UPDATE video_encode_jobs SET status='queued', attempts=0 WHERE id=…`.
   Spot-check pages logged out (hosts!) and a few subtitles (Mux had its own
   captions; ours are re-transcribed).
7. **/datenschutz + AVV**: apply the diff below, bump `TERMS_DATE` in
   `legal-footer.tsx`, deploy.
8. **Delete Mux** (after a grace period): delete assets in the Mux dashboard,
   remove `MUX_*` from prod.env/`.kamal/secrets`/`config/deploy.yml`,
   `src/app/api/webhooks/mux`, the Mux branch in `prepare-download`,
   `@mux/mux-node`, the Mux fallback in `video-playback.ts`, the admin
   "Mux Playback ID" form, `scripts/upload-onboarding-video.mjs` (uploads help
   clips to Mux — upload them through the dashboard instead).

Rollback of a migrated row (Mux asset still exists):
```sql
UPDATE videos SET provider = 'mux', encode_job_id = NULL,
  metadata = jsonb_build_object('playbackId', metadata->>'muxPlaybackId', 'status', 'ready',
                                'poster', 'https://image.mux.com/' || (metadata->>'muxPlaybackId') || '/thumbnail.webp?time=0',
                                'aspectRatio', metadata->'aspectRatio')
WHERE id = '<videoId>';
```

## /datenschutz diff (apply after step 6)

`src/app/(app)/datenschutz/page.tsx`:

```diff
-  { name: 'Infomaniak Network SA (Schweiz)', purpose: 'Server für Anwendung und PostgreSQL-Datenbank, Dateispeicher (hochgeladene Dateien, Bilder), verschlüsselte Datenbank-Sicherungen (getrennter Standort), KI-Feedback auf Handschrift und Zeichnungen, KI-Bewertung von Prüfungsantworten (offene Modelle, z. B. Qwen)', location: 'Schweiz', studentData: 'ja' },
+  { name: 'Infomaniak Network SA (Schweiz)', purpose: 'Server für Anwendung und PostgreSQL-Datenbank, Dateispeicher (hochgeladene Dateien, Bilder, Videos), verschlüsselte Datenbank-Sicherungen (getrennter Standort), KI-Feedback auf Handschrift und Zeichnungen, KI-Bewertung von Prüfungsantworten (offene Modelle, z. B. Qwen), automatische Untertitel für Videos von Lehrpersonen (Whisper)', location: 'Schweiz', studentData: 'ja' },
@@
-  { name: 'Mux, Inc. (USA)', purpose: 'Video-Hosting für von Lehrpersonen hochgeladene Videos', location: 'USA', studentData: 'nein' },
@@ CHANGELOG
+  { date: '<Monat> 2026', change: 'Videos werden auf unseren Servern in der Schweiz aufbereitet und gespeichert, Untertitel von der KI bei Infomaniak erstellt. Mux (USA) entfernt.' },
@@ section 3
-              In die USA gehen nur Inhalte der Lehrpersonen: Videos
-              (Mux) und KI-Anfragen zum Bearbeiten eigener Inhalte (siehe
-              Abschnitt 4).
+              In die USA gehen nur Inhalte der Lehrpersonen: KI-Anfragen zum
+              Bearbeiten eigener Inhalte (siehe Abschnitt 4).
@@ Eingebettete Inhalte
-              einbetten, etwa Videos (YouTube, Mux), Simulationen (PhET),
+              einbetten, etwa Videos (YouTube), Simulationen (PhET),
```

Also update the "Sources (checked …)" comment above `SUBPROCESSORS`
(videos: `encoder` role in `config/deploy.yml`, bucket `eduskript-teacher-files`).

AVV templates (same change):

- `docs/organization/08-dpa-template.md` 8.2: "Only teachers' content goes to
  the USA: ~~videos (Mux) and~~ AI requests with which …"; remove the
  `| Mux, Inc. | Video hosting … | USA | no |` row; add "videos, automatic
  video subtitles" to the Infomaniak row's purpose.
- `docs/de/organisation/08-avv-vorlage.md` 8.2: "In die USA gehen nur Inhalte
  von Lehrpersonen: ~~Videos (Mux) und~~ KI-Anfragen, …"; remove the
  `| Mux, Inc. | Video-Hosting … | USA | nein |` row; add "Videos,
  automatische Video-Untertitel" to the Infomaniak row.

## Known limitations

- HDR sources (iPhone HLG/Dolby Vision) are converted to 8-bit SDR without
  tone mapping → may look washed out. Fix: zscale/tonemap (needs a ffmpeg
  with libzimg; Debian's has it) — not done.
- Whisper cues are cut at sentence ends / 80 chars / 6 s; 20-minute audio
  chunks can split a word at the boundary. No caption editing UI.
- One job at a time: a 2-hour lecture blocks the queue for roughly
  15–20 min (at 2 cores).
- Encoder temp space: the original (≤2 GB) + intermediates in the
  container's /tmp.
- Deleting a video deletes outputs + original only when no other row uses
  the job; deleting a Mux row still leaves the Mux asset.
- Safari/iOS native HLS: no quality menu (Safari picks the rendition);
  iOS fullscreen uses the native player.
- If every row of a migrated group fails to flip (filename collision), its
  job is still queued and encoded once (wasted CPU, no harm).
