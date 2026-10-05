# Postgres for the Kamal "db" accessory, with pgBackRest for WAL archiving and
# backups (MIGRATION-VPS.md §5). Built on the VPS by bin/build-db-image — small
# enough that building there is fine; Kamal does not build accessory images.
# Base pinned to minor + Debian release: a floating tag that changes glibc can
# silently change collation order and corrupt text indexes.
FROM postgres:18.6-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 750 /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
COPY --chown=postgres:postgres pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
