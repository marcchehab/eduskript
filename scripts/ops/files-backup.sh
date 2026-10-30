#!/bin/bash
# Nightly backup of the object storage (teacher files + imports) from
# Infomaniak dc3-a (Geneva) to dc4-a (Winterthur). Run as root on the VPS by
# eduskript-files-backup.timer (install-ops.sh). Uses the Debian rclone
# package (1.60, aws-sdk-go v1: no aws-chunked uploads, which Swift rejects).
#
#   files-backup.sh              sync all buckets, purge old deleted/ dirs
#   files-backup.sh rclone ARGS  run rclone with the remotes below configured
#                                (restore, inspection; see RESTORE.md)
#
# Remotes (configured via RCLONE_CONFIG_* env, no rclone.conf):
#   src:         dc3-a S3 API, the app's EC2 key (S3_* in /etc/eduskript/app.env)
#   dst:         dc4-a S3 API, same key
#   filesbackup: rclone crypt over dst:eduskript-files-backup (file contents and
#                names encrypted; password FILES_BACKUP_CRYPT_PASS in
#                /etc/eduskript/files-backup.env — without it the backup is
#                unreadable)
# Layout inside filesbackup:
#   current/<bucket>/<key>                 mirror of the source
#   deleted/<YYYY-MM-DD>/<bucket>/<key>    objects deleted or overwritten in the
#                                          source on that day (--backup-dir);
#                                          dirs older than 30 days are purged,
#                                          so deletions are final after 30 days
# Change detection: --update --use-server-modtime compares the source's
# LastModified with the backup's upload time and size (no HEAD per object).
# An object overwritten in place with an older timestamp would be missed; the
# app never does that (new uploads get new keys or a fresh LastModified).
# The destination container was created once with a Keystone token (README.md).
# On success writes /var/lib/eduskript/files-backup.ok (checked by
# health-check.sh) and pings FILES_BACKUP_HEARTBEAT_URL (+ /fail on error).
set -uo pipefail
BUCKETS="eduskript-teacher-files eduskript-imports eduskript-user-data"
DEST_CONTAINER="eduskript-files-backup"
RETENTION_DAYS=30
STAMP=/var/lib/eduskript/files-backup.ok
[ -f /etc/eduskript-ops.env ] && . /etc/eduskript-ops.env

# app.env is a Docker env-file (no shell quoting), so read single keys.
envval() { sed -n "s/^$2=//p" "$1" | tail -1; }
KEY=$(envval /etc/eduskript/app.env S3_ACCESS_KEY)
SECRET=$(envval /etc/eduskript/app.env S3_SECRET_KEY)
CRYPT_PASS=$(envval /etc/eduskript/files-backup.env FILES_BACKUP_CRYPT_PASS)
[ -n "$KEY" ] && [ -n "$SECRET" ] && [ -n "$CRYPT_PASS" ] || { echo "missing S3 key or FILES_BACKUP_CRYPT_PASS" >&2; exit 1; }

for r in SRC:pub1 DST:pub2; do
  n=${r%%:*}; h=${r#*:}
  export RCLONE_CONFIG_${n}_TYPE=s3 RCLONE_CONFIG_${n}_PROVIDER=Other \
    RCLONE_CONFIG_${n}_ENDPOINT=https://s3.$h.infomaniak.cloud RCLONE_CONFIG_${n}_REGION=us-east-1 \
    RCLONE_CONFIG_${n}_FORCE_PATH_STYLE=true RCLONE_CONFIG_${n}_NO_CHECK_BUCKET=true \
    RCLONE_CONFIG_${n}_ACCESS_KEY_ID="$KEY" RCLONE_CONFIG_${n}_SECRET_ACCESS_KEY="$SECRET"
done
export RCLONE_CONFIG_FILESBACKUP_TYPE=crypt \
  RCLONE_CONFIG_FILESBACKUP_REMOTE="dst:$DEST_CONTAINER" \
  RCLONE_CONFIG_FILESBACKUP_FILENAME_ENCRYPTION=standard \
  RCLONE_CONFIG_FILESBACKUP_DIRECTORY_NAME_ENCRYPTION=true
RCLONE_CONFIG_FILESBACKUP_PASSWORD=$(rclone obscure "$CRYPT_PASS")
export RCLONE_CONFIG_FILESBACKUP_PASSWORD RCLONE_CONFIG=/dev/null

if [ "${1:-}" = rclone ]; then shift; exec rclone "$@"; fi

ping_hc() {
  [ -n "${FILES_BACKUP_HEARTBEAT_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 --data-raw "$2" "$FILES_BACKUP_HEARTBEAT_URL$1" >/dev/null
}

today=$(date +%F)
ok=1
for b in $BUCKETS; do
  echo "== sync $b"
  rclone sync "src:$b" "filesbackup:current/$b" \
    --backup-dir "filesbackup:deleted/$today/$b" \
    --update --use-server-modtime --fast-list \
    --transfers 8 --checkers 16 --retries 3 --low-level-retries 10 \
    --stats 10m --stats-one-line --stats-log-level NOTICE || ok=0
done

# Purge deleted/<date> dirs older than RETENTION_DAYS (by directory name, not
# object modtime: moved objects keep their original upload time).
cutoff=$(date -d "-$RETENTION_DAYS days" +%F)
for d in $(rclone lsf --dirs-only filesbackup:deleted 2>/dev/null); do
  d=${d%/}
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
  if [[ "$d" < "$cutoff" ]]; then
    echo "== purge deleted/$d"
    rclone purge "filesbackup:deleted/$d" || ok=0
  fi
done

if [ $ok = 1 ]; then
  summary=$(for b in $BUCKETS; do
    printf '%s %s; ' "$b" "$(rclone size --json --fast-list "filesbackup:current/$b" 2>/dev/null \
      | python3 -c 'import json,sys; s=json.load(sys.stdin); print("%d objects %.2f GB" % (s["count"], s["bytes"] / 1e9))')"
  done)
  echo "ok: $summary"
  date +%s > "$STAMP"
  ping_hc "" "ok: $summary"
else
  ping_hc /fail "files backup failed, see journalctl -u eduskript-files-backup"
  exit 1
fi
