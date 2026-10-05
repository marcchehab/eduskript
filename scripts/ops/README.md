# Ops: eduskript-prod (Infomaniak VPS)

Plan and rationale: `MIGRATION-VPS.md`. Deployment config: `config/deploy.yml`.

## Access

- `ssh eduskript-prod` → user `debian` (sudo). Kamal uses user `deploy`
  (docker group, no sudo — but docker access is root-equivalent).
- Key lives in Bitwarden (SSH agent, `SSH_AUTH_SOCK=~/.bitwarden-ssh-agent.sock`).
- Secrets: `~/.config/eduskript/prod.env` (+ copy in Bitwarden). Read by
  `.kamal/secrets`.

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
- Heartbeats: set `BACKUP_HEARTBEAT_URL` and `HEALTH_HEARTBEAT_URL`
  (healthchecks.io or Better Stack) in `/etc/eduskript-ops.env` on the VPS.
  Until then nobody is alerted.
- Timers are installed by `install-ops.sh` (see its header).

## Restore

See `RESTORE.md`. Emergency handover: `BREAK-GLASS.md`.
