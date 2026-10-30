# Restore (database: A, B; files: C)

All commands on the VPS (`ssh eduskript-prod`, then `sudo -i`).
`pgb` below = `docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript`.

## A. Point in time (wrong DELETE, broken migration) — VPS intact

1. Note the time just **before** the damage (UTC!), e.g. `2026-10-12 09:41:00+00`.
2. Stop the app so nothing writes: from your machine `bin/kamal app stop`.
3. Stop Postgres but keep the container's image/config: `docker stop eduskript-db`.
4. Restore in place (delta = only changed files):
   ```
   docker run --rm --volumes-from eduskript-db -u postgres eduskript-db:18.6 \
     pgbackrest --stanza=eduskript --delta --type=time \
     --target="2026-10-12 09:41:00+00" --target-action=promote restore
   ```
5. `docker start eduskript-db`, watch `docker logs -f eduskript-db` until
   "database system is ready to accept connections".
6. Check the data (`docker exec -it eduskript-db psql -U eduskript`), then
   `bin/kamal app boot`.
7. Run a fresh full backup: `pgb --type=full backup`.

## B. Server gone — restore from S3 (repo2) onto a new VPS

1. New VPS, base setup as in MIGRATION-VPS.md §3 (the setup script is in the
   session notes; essentials: Docker, user `deploy`, ufw 22/80/443, dirs
   `/var/lib/eduskript/{pg,pgbackrest,caddy}`, `chown 999:999 …/pgbackrest`).
2. Put the new IP into `config/deploy.yml`, `bin/build-db-image`, and DNS
   (`eduskript.org`, `sites.eduskript.org`).
3. `bin/build-db-image`, `bin/kamal accessory boot db`, then immediately
   `docker stop eduskript-db` and empty `/var/lib/eduskript/pg/18/docker`.
4. Restore the newest backup + all WAL from repo2 in a one-off container
   with the db container's volumes and env (Kamal wrote the env file):
   ```
   docker run --rm --volumes-from eduskript-db -u postgres \
     --env-file /home/deploy/.kamal/apps/eduskript/env/accessories/db.env \
     eduskript-db:18.6 pgbackrest --stanza=eduskript --repo=2 restore
   ```
5. `docker start eduskript-db`, `pgb stanza-upgrade` if asked, `pgb check`.
6. `bin/kamal deploy`, `bin/kamal accessory boot caddy`, run install-ops.sh.

## Test a restore (do this, don't just trust it) — verified 2026-10-05

Restores the newest repo1 backup + WAL into a throwaway directory, starts a
second Postgres on it and diffs exact row counts against the live DB.
```
sudo -i
rm -rf /tmp/restore-test; install -d -o 999 -g 999 /tmp/restore-test
V="-v /var/lib/eduskript/pgbackrest:/var/lib/pgbackrest -v /tmp/restore-test:/var/lib/postgresql"
docker run --rm -u postgres $V eduskript-db:18.6 pgbackrest --stanza=eduskript --repo=1 --type=immediate --target-action=promote restore
docker run -d --name restore-test -u postgres $V eduskript-db:18.6 postgres -c archive_mode=off
# wait for "database system is ready" in: docker logs restore-test
docker cp table-counts.sql restore-test:/tmp/c.sql && docker exec restore-test psql -U eduskript -d eduskript -tAf /tmp/c.sql > /tmp/r.txt
docker cp table-counts.sql eduskript-db:/tmp/c.sql && docker exec eduskript-db psql -U eduskript -d eduskript -tAf /tmp/c.sql > /tmp/l.txt
diff /tmp/l.txt /tmp/r.txt && echo MATCH   # rows written in between show up as small diffs
docker rm -f restore-test; rm -rf /tmp/restore-test
```
The WAL repo must be mounted: recovery fetches WAL via `pgbackrest archive-get`.

## C. Restore files (object storage backup, files-backup.sh)

The backup is an `rclone crypt` mirror in dc4-a (README.md "Backups (object
storage)"). On the VPS, `fb` below = `sudo eduskript-files-backup rclone`
(rclone with the remotes `src:` = live buckets dc3-a, `filesbackup:` =
decrypted view of the backup). Only `current/` and `deleted/` exist in it.

Find and restore **one file** (keys as in the `files`/`videos` tables, e.g.
`files/<hash>.png`):
```
fb ls filesbackup:current/eduskript-teacher-files/files/ | grep <hash>
fb lsf -R filesbackup:deleted/ | grep <hash>        # deleted in the last 30 days?
fb copyto filesbackup:current/eduskript-teacher-files/files/<hash>.png /tmp/restore/<hash>.png   # look at it first
fb copyto filesbackup:current/eduskript-teacher-files/files/<hash>.png src:eduskript-teacher-files/files/<hash>.png
```
For a deleted file use `filesbackup:deleted/<YYYY-MM-DD>/<bucket>/<key>` as
the source. Writing to `src:` changes production: double-check the key.

Whole bucket back into a (new or emptied) dc3-a container — `copy`, never
`sync` (sync would delete what is newer in the source):
```
fb copy filesbackup:current/eduskript-teacher-files src:eduskript-teacher-files --transfers 16 -P
```
A new container must first be made public again (Swift `X-Container-Read:
.r:*` + CORS metadata, README.md "File storage"); the app builds public URLs
from `S3_PUBLIC_BASE_URL`.

If dc3-a is down: copy into a new container in dc4-a (`dst:<name>`, created
with a Keystone token) and point `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL` and
`NEXT_PUBLIC_KARA_TILESET_URL` (config/deploy.yml) at `s3.pub2`.

Without the VPS: install rclone anywhere, then
```
export RCLONE_CONFIG_DST_TYPE=s3 RCLONE_CONFIG_DST_PROVIDER=Other \
  RCLONE_CONFIG_DST_ENDPOINT=https://s3.pub2.infomaniak.cloud RCLONE_CONFIG_DST_REGION=us-east-1 \
  RCLONE_CONFIG_DST_FORCE_PATH_STYLE=true RCLONE_CONFIG_DST_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_DST_ACCESS_KEY_ID=<S3_ACCESS_KEY> RCLONE_CONFIG_DST_SECRET_ACCESS_KEY=<S3_SECRET_KEY> \
  RCLONE_CONFIG_FB_TYPE=crypt RCLONE_CONFIG_FB_REMOTE=dst:eduskript-files-backup \
  RCLONE_CONFIG_FB_FILENAME_ENCRYPTION=standard RCLONE_CONFIG_FB_DIRECTORY_NAME_ENCRYPTION=true \
  RCLONE_CONFIG_FB_PASSWORD="$(rclone obscure '<FILES_BACKUP_CRYPT_PASS>')"
rclone lsd fb:current
```
(secrets from the Bitwarden note "eduskript server env").

Test (verified 2026-10-29): compare `fb size --fast-list src:eduskript-teacher-files`
with `fb size --fast-list filesbackup:current/eduskript-teacher-files`, then
restore one file to /tmp and `cmp` it with `fb cat src:…`.
