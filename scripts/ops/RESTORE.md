# Restore the database (pgBackRest)

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
