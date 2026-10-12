# Video hosting: Mux → Infomaniak VOD

Goal: a student's browser playing an Eduskript video contacts only Swiss
(Infomaniak) hosts: `play.vod2.infomaniak.com` (HLS/MP4), `api.infomaniak.com`
(subtitles), our S3 (`s3.pub1.infomaniak.cloud`, posters).

Branch `infomaniak-vod`. Code map:

| Piece | File |
|---|---|
| VOD API client (v1 import/subtitles/delete, v2 media/subtitles) | `src/lib/infomaniak-vod.ts` |
| Upload hand-off + sync (callback/poll/cron) | `src/lib/video-sync.server.ts` |
| Provider → playback sources (Mux fallback) | `src/lib/video-playback.ts` |
| Player (`<video>` + hls.js, bundled) | `src/components/markdown/hls-video.tsx` |
| Callback | `src/app/api/webhooks/infomaniak-vod/route.ts` |
| Upload steps | `api/videos/upload-url`, `api/videos/[id]/uploaded`, `api/videos/sync` |
| Migration | `scripts/migrate-mux-to-infomaniak.mjs` |

Flow: browser → presigned PUT to `eduskript-teacher-files/video-uploads/…` →
`/api/videos/[id]/uploaded` → Infomaniak v1 import from a presigned GET →
callback (or dashboard poll / daily cron) → row gets HLS, highest MP4, poster
(copied to our S3), duration, aspect ratio; AI subtitles requested and stored as
WebVTT tracks; S3 upload object deleted.

Existing Mux rows keep playing (provider `mux`, now through the same hls.js
player from `stream.mux.com`) until migrated. Migrated rows keep playing from
Mux until Infomaniak has finished encoding (`metadata.muxPlaybackId`).

## Rollout (Marc)

1. **Infomaniak VOD**
   1. When the trial ends (2026-11-12) buy a VOD plan for channel 16211
      (the trial caps imports at 5 in total — the trial is used up by the
      tests; the migration needs one import per Mux video).
   2. Create a folder for Eduskript uploads (or use root `1jijk03uoqrml`).
      Keep it unrestricted (no key/domain restriction — the
      `restricted-test` folder returns 403 for playback). Folder subtitle
      auto-generation must stay **off** (the app requests subtitles itself;
      both would create two tracks).
   3. Create an API token with VOD scope for production (or reuse the one in
      `~/.config/eduskript/vod.env`).
2. **Secrets** — add to `~/.config/eduskript/prod.env`, then `bin/sync-secrets`:
   ```
   INFOMANIAK_VOD_TOKEN=…
   INFOMANIAK_VOD_CHANNEL=16211
   INFOMANIAK_VOD_FOLDER=<folder id>
   INFOMANIAK_VOD_CALLBACK_SECRET=<openssl rand -hex 32>
   ```
   (`config/deploy.yml` and `.kamal/secrets` already list them.)
3. **Deploy** (`bin/deploy`). Runs migration `20261012074932_infomaniak_vod`
   (adds `videos.vod_media_id`). From now on new uploads go to Infomaniak.
4. **Register the callback** (once; bearer auth is supported by v1 callbacks):
   ```bash
   curl -X POST -H "Authorization: Bearer $INFOMANIAK_VOD_TOKEN" -H 'Content-Type: application/json' \
     https://api.infomaniak.com/1/vod/channel/16211/callback -d '{
       "name": "eduskript", "active": true,
       "url": "https://eduskript.org/api/webhooks/infomaniak-vod",
       "auth": "bearer", "bearer_token": "<INFOMANIAK_VOD_CALLBACK_SECRET>",
       "events": ["media_ready","encoding_finished","encoding_failed","thumbnail_finished","subtitle_ready"]
     }'
   ```
   The route also accepts `?token=<secret>` if bearer auth turns out not to
   be sent. Without a working callback, videos still finish via the dashboard
   poll and the daily cron (`/api/cron`, task 5).
5. **Smoke test**: upload a short clip in the dashboard, wait for the spinner
   to go away, embed it, open the page logged out, check the browser's network
   tab: only `eduskript.org`, `play.vod2.infomaniak.com`, `api.infomaniak.com`,
   `s3.pub1.infomaniak.cloud`.
6. **Migrate Mux videos** (inside the app container, so DB + env are there):
   ```bash
   bin/kamal app exec -i 'node scripts/migrate-mux-to-infomaniak.mjs --dry-run'
   bin/kamal app exec -i 'node scripts/migrate-mux-to-infomaniak.mjs --limit 1 --notify http://localhost:3000'
   # check that video, then all:
   bin/kamal app exec -i 'node scripts/migrate-mux-to-infomaniak.mjs --notify http://localhost:3000'
   ```
   Idempotent and resumable (re-run after a timeout or crash). `--notify`
   makes the app sync each row as soon as it is ready (poster copy, subtitle
   request, cache invalidation); without it the callback/cron does it.
   Rows sharing a Mux playback id (page copies) share one Infomaniak media.
   A row whose (filename, uploader) collides with an existing Infomaniak row
   stays on Mux and is listed in the output.
7. **Verify**: `SELECT provider, count(*) FROM videos GROUP BY 1;` → no
   `mux` left (except reported collisions);
   `SELECT id, filename FROM videos WHERE provider='infomaniak' AND metadata->>'status' <> 'ready';`
   → empty after a few minutes. Spot-check a few pages logged out.
   Subtitles: Mux had English auto-captions (some re-languaged to German);
   Infomaniak re-transcribes with language detection — spot-check one.
8. **/datenschutz + AVV**: apply the diff below, bump `TERMS_DATE` in
   `legal-footer.tsx`, deploy.
9. **Delete Mux** (manual, after a grace period): delete the assets in the Mux
   dashboard, remove `MUX_*` secrets, `src/app/api/webhooks/mux`, the Mux
   branch in `prepare-download`, `@mux/mux-node`, the Mux fallback in
   `video-playback.ts`, and `scripts/upload-onboarding-video.mjs` (still
   uploads help clips to Mux; upload them through the dashboard instead).

Rollback of a migrated row (Mux asset still exists):
```sql
UPDATE videos SET provider='mux', vod_media_id=NULL,
  metadata = (metadata - 'mediaId' - 'hlsUrl' - 'mp4Url' - 'captions' - 'captionsStatus')
             || jsonb_build_object('playbackId', metadata->>'muxPlaybackId', 'status', 'ready')
WHERE id = '<videoId>';
```
Poster: the row then shows the Infomaniak poster copy (CH S3) — harmless.

## /datenschutz diff (apply after step 7)

`src/app/(app)/datenschutz/page.tsx`:

```diff
-  { name: 'Infomaniak Network SA (Schweiz)', purpose: 'Server für Anwendung und PostgreSQL-Datenbank, Dateispeicher (hochgeladene Dateien, Bilder), verschlüsselte Datenbank-Sicherungen (getrennter Standort), KI-Feedback auf Handschrift und Zeichnungen, KI-Bewertung von Prüfungsantworten (offene Modelle, z. B. Qwen)', location: 'Schweiz', studentData: 'ja' },
+  { name: 'Infomaniak Network SA (Schweiz)', purpose: 'Server für Anwendung und PostgreSQL-Datenbank, Dateispeicher (hochgeladene Dateien, Bilder), Video-Hosting (von Lehrpersonen hochgeladene Videos und deren automatische Untertitel), verschlüsselte Datenbank-Sicherungen (getrennter Standort), KI-Feedback auf Handschrift und Zeichnungen, KI-Bewertung von Prüfungsantworten (offene Modelle, z. B. Qwen)', location: 'Schweiz', studentData: 'ja' },
@@
-  { name: 'Mux, Inc. (USA)', purpose: 'Video-Hosting für von Lehrpersonen hochgeladene Videos', location: 'USA', studentData: 'nein' },
@@ CHANGELOG
+  { date: '<Monat> 2026', change: 'Videos werden bei Infomaniak in der Schweiz gehostet statt bei Mux (USA). Mux entfernt.' },
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

Also update the "Sources (checked …)" comment above `SUBPROCESSORS` (Infomaniak
VOD: `INFOMANIAK_VOD_*` in `config/deploy.yml`).

AVV templates (same change):

- `docs/organization/08-dpa-template.md` 8.2: "Only teachers' content goes to
  the USA: ~~videos (Mux) and~~ AI requests with which …"; remove the
  `| Mux, Inc. | Video hosting … | USA | no |` row; add "video hosting" to the
  Infomaniak row's purpose.
- `docs/de/organisation/08-avv-vorlage.md` 8.2: "In die USA gehen nur Inhalte
  von Lehrpersonen: ~~Videos (Mux) und~~ KI-Anfragen, …"; remove the
  `| Mux, Inc. | Video-Hosting … | USA | nein |` row; add "Video-Hosting" to
  the Infomaniak row.

## Known limitations

- Video DELETE removes the Infomaniak media only when no other row (page-copy
  duplicate) references it; deleting a Mux row still leaves the Mux asset.
- A failed callback + closed dashboard leaves a row "processing" until the
  daily cron (03:00 UTC) syncs it.
- Subtitles: one AI track per video, language auto-detected; silent clips give
  up after 30 min (`captionsStatus: 'none'`). No UI to edit or replace them.
- The native `<video>` controls have no quality menu (hls.js picks the
  rendition, capped to the player size).
- Upload size: no server-side limit beyond what the presigned PUT (6 h
  validity) and Infomaniak accept.
