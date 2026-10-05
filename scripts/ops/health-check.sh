#!/bin/bash
# Hourly ops check on the VPS (eduskript-health.timer, install-ops.sh).
# Pings HEALTH_HEARTBEAT_URL only when everything is fine, so the external
# monitor alerts when a check fails OR the host stops reporting:
#   - root disk below 80 %
#   - WAL archiving not failing (a failing archive_command makes Postgres keep
#     WAL until the disk is full)
#   - newest pgBackRest backup younger than 26 h
set -uo pipefail
[ -f /etc/eduskript-ops.env ] && . /etc/eduskript-ops.env
psql() { docker exec eduskript-db psql -U eduskript -d eduskript -tAc "$1" | tr -d ' '; }
fail() {
  echo "CHECK FAILED: $*" >&2
  [ -n "${HEALTH_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 --data-raw "$*" "$HEALTH_HEARTBEAT_URL/fail" >/dev/null
  exit 1
}

disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$disk" -lt 80 ] || fail "disk ${disk}%"

archiving_broken=$(psql "select failed_count > 0 and last_failed_time > coalesce(last_archived_time, 'epoch') from pg_stat_archiver")
[ "$archiving_broken" = "f" ] || fail "WAL archiving failing"

newest=$(docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript --output=json info \
  | python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"]; print(max(x["timestamp"]["stop"] for x in b) if b else 0)') \
  || fail "pgbackrest info"
age=$(( $(date +%s) - newest ))
[ "$age" -lt 93600 ] || fail "newest backup ${age}s old"

[ -n "${HEALTH_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 --retry 3 "$HEALTH_HEARTBEAT_URL" >/dev/null
echo "ok: disk ${disk}%, newest backup ${age}s old"
