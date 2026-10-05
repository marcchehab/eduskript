#!/bin/bash
# pgBackRest backup of the eduskript-db accessory. Run as root on the VPS by
# eduskript-backup-{full,diff}.timer (install-ops.sh).
#   pgbackrest-backup.sh full|diff
# Repos from BACKUP_REPOS in /etc/eduskript-ops.env (default "1"; "1 2" once
# the S3 repo2 is configured). Pings BACKUP_HEARTBEAT_URL (+ /fail) if set.
set -uo pipefail
TYPE="${1:-diff}"
BACKUP_REPOS="1"
[ -f /etc/eduskript-ops.env ] && . /etc/eduskript-ops.env

ok=1
for repo in $BACKUP_REPOS; do
  docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript --repo="$repo" --type="$TYPE" backup || ok=0
done

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  [ $ok = 1 ] && suffix="" || suffix="/fail"
  curl -fsS -m 10 --retry 3 "$BACKUP_HEARTBEAT_URL$suffix" >/dev/null
fi
[ $ok = 1 ]
