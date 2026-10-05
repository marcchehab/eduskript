# Ops: eduskript-prod (Infomaniak VPS)

Plan and rationale: `MIGRATION-VPS.md`. Deployment config: `config/deploy.yml`.

## Access

- `ssh eduskript-prod` → user `debian` (sudo). Kamal uses user `deploy`
  (docker group, no sudo — but docker access is root-equivalent).
- Key lives in Bitwarden (SSH agent, `SSH_AUTH_SOCK=~/.bitwarden-ssh-agent.sock`).
- Secrets: `~/.config/eduskript/prod.env` (+ copy in Bitwarden). Read by
  `.kamal/secrets`.

## Secrets

`~/.config/eduskript/prod.env` is mirrored to the Bitwarden secure note
"eduskript prod.env" by `bin/sync-secrets` (asks for the master password).
Run it after every change to prod.env.

## File storage

Teacher uploads: Infomaniak Public Cloud object storage (project
`PCP-XAUZCPS`, region dc3-a, endpoint `s3.pub1.infomaniak.cloud`), buckets
`eduskript-teacher-files` (public read via Swift container ACL, CORS `*`) and
`eduskript-imports` (private). Credentials in prod.env (`INFOMANIAK_*`).
Swift quirks are documented at the top of `src/lib/s3.ts`. Container ACL/CORS
are Swift metadata (`X-Container-Read`, `X-Container-Meta-Access-Control-*`),
set once with a Keystone token — not via the S3 API. The old Scaleway bucket
`eduskript-teacher-files` (fr-par) is kept read-only as a fallback for now.

## Everyday

| Task | Command |
|---|---|
| Deploy (checks first) | `bin/deploy` (`--quick` skips tests) |
| Deploy without checks | `bin/kamal deploy` |
| Roll back | `bin/kamal app containers` → `bin/kamal rollback <version>` |
| App logs | `bin/kamal app logs -f` |
| Shell in app | `bin/kamal app exec -i sh` |
| DB shell | `ssh eduskript-prod sudo docker exec -it eduskript-db psql -U eduskript` |
| Caddy logs | `bin/kamal accessory logs caddy` |
| Restart Caddy (Caddyfile change) | `bin/reboot-caddy` |
| Rebuild Caddy image (config/caddy) | `bin/build-caddy-image && bin/reboot-caddy` |
| Restart DB with new config | `bin/reboot-db` (short outage; never `kamal accessory remove db` — deletes data dirs) |
| Rebuild DB image (config/db) | `bin/build-db-image && bin/reboot-db` |
| Backup status | `ssh eduskript-prod sudo docker exec -u postgres eduskript-db pgbackrest info` |
| Run app cron now (billing, trials, demo reset) | `ssh eduskript-prod sudo systemctl start eduskript-cron` |
| Timers / health | `ssh eduskript-prod 'systemctl list-timers "eduskript-*"; sudo eduskript-health'` |

Migrations must be expand/contract (old and new container run side by side
for ~30 s, and `kamal rollback` runs old code against the new schema).

## Backups (pgBackRest)

- repo1 local `/var/lib/eduskript/pgbackrest`: WAL continuously, full Sun
  01:15, diff Mon–Sat 01:15, 2 fulls kept → point-in-time restore ~14 days.
- repo2 Scaleway S3 bucket `eduskript-backups`: configured 2026-10-05 (key = the app key). Setup steps, for a rebuild:
  1. Create bucket `eduskript-backups` (fr-par) and an API key scoped to it.
  2. Add to `prod.env`: `PGBACKREST_REPO2_S3_KEY`, `PGBACKREST_REPO2_S3_KEY_SECRET`
     (`PGBACKREST_REPO2_CIPHER_PASS` is already there).
  3. In `config/deploy.yml` → `accessories.db.env`: clear
     `PGBACKREST_REPO2_TYPE: s3`, `PGBACKREST_REPO2_S3_BUCKET: eduskript-backups`,
     `PGBACKREST_REPO2_S3_ENDPOINT: s3.fr-par.scw.cloud`,
     `PGBACKREST_REPO2_S3_REGION: fr-par`, `PGBACKREST_REPO2_PATH: /pgbackrest`,
     `PGBACKREST_REPO2_CIPHER_TYPE: aes-256-cbc`,
     `PGBACKREST_REPO2_RETENTION_FULL: "26"`, `PGBACKREST_REPO2_RETENTION_DIFF: "14"`,
     `PGBACKREST_REPO2_RETENTION_ARCHIVE: "2"`; secret: the three above.
  4. `bin/reboot-db`, then on the VPS:
     `docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript stanza-create`
     and `… check`, then set `BACKUP_REPOS="1 2"` in `/etc/eduskript-ops.env`
     and run `systemctl start eduskript-backup@full`.
- Heartbeats: healthchecks.io project "eduskript" (API key in prod.env),
  checks `eduskript-backup` (daily), `eduskript-health` (hourly) and `eduskript-cron` (daily app cron, `CRON_SECRET` + `CRON_HEARTBEAT_URL` also in that file). Ping URLs
  are in `/etc/eduskript-ops.env` on the VPS (`BACKUP_HEARTBEAT_URL`,
  `HEALTH_HEARTBEAT_URL`). Alerts go to the project's email integration.
- Timers are installed by `install-ops.sh` (see its header).

## Restore

See `RESTORE.md`. Emergency handover: `BREAK-GLASS.md`.
