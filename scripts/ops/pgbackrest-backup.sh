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

# io-timeout: Infomaniak S3 (repo2) occasionally stalls >60s (the default)
# during expire's listing/deletes.
pgbr() { docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript --io-timeout=180 "$@"; }

# Unix start time of the newest backup in a repo (0 if none/unreadable).
newest_backup_start() {
  pgbr --repo="$1" --output=json info 2>/dev/null \
    | python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"]; print(b[-1]["timestamp"]["start"] if b else 0)' 2>/dev/null \
    || echo 0
}

ok=1
for repo in $BACKUP_REPOS; do
  started=$(date +%s)
  pgbr --repo="$repo" --type="$TYPE" backup && continue
  # `backup` runs expire afterwards and fails if only that step fails. If this
  # run's backup made it into the repo, retry expire once instead of alerting.
  if [ "$(newest_backup_start "$repo")" -ge "$started" ]; then
    echo "repo$repo: backup stored, expire failed; retrying expire in 5 min" >&2
    sleep 300
    pgbr --repo="$repo" expire && continue
  fi
  ok=0
done

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  [ $ok = 1 ] && suffix="" || suffix="/fail"
  curl -fsS -m 10 --retry 3 "$BACKUP_HEARTBEAT_URL$suffix" >/dev/null
fi
[ $ok = 1 ]
