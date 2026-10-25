#!/bin/bash
# Hourly ops check on the VPS (eduskript-health.timer, install-ops.sh).
# Pings HEALTH_HEARTBEAT_URL only when everything is fine, so the external
# monitor alerts when a check fails OR the host stops reporting:
#   - root disk below 80 %
#   - WAL archiving not failing (a failing archive_command makes Postgres keep
#     WAL until the disk is full)
#   - newest pgBackRest backup younger than 26 h
# Every ping carries a one-line body with the time in UTC and Swiss local
# time (Healthchecks.io shows it as the ping body).
set -uo pipefail
[ -f /etc/eduskript-ops.env ] && . /etc/eduskript-ops.env
psql() { docker exec eduskript-db psql -U eduskript -d eduskript -tAc "$1" | tr -d ' '; }
stamp="$(date -u '+%Y-%m-%d %H:%M UTC') / $(TZ=Europe/Zurich date '+%H:%M %Z')"
fail() {
  echo "CHECK FAILED $stamp: $*" >&2
  [ -n "${HEALTH_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 --data-raw "FAILED $stamp: $*" "$HEALTH_HEARTBEAT_URL/fail" >/dev/null
  exit 1
}

# After a reboot the timer catches up at once (Persistent=true), before the
# DB container is up; on 2026-10-19 that reported "WAL archiving failing".
# Wait up to 5 min for Postgres instead.
for _ in $(seq 60); do
  docker exec eduskript-db pg_isready -q -U eduskript 2>/dev/null && break
  sleep 5
done
docker exec eduskript-db pg_isready -q -U eduskript 2>/dev/null || fail "postgres not ready after 5 min"

disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$disk" -lt 80 ] || fail "disk ${disk}%"

archiving_broken=$(psql "select failed_count > 0 and last_failed_time > coalesce(last_archived_time, 'epoch') from pg_stat_archiver")
[ "$archiving_broken" = "f" ] || fail "WAL archiving failing"

newest=$(docker exec -u postgres eduskript-db pgbackrest --stanza=eduskript --output=json info \
  | python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"]; print(max(x["timestamp"]["stop"] for x in b) if b else 0)') \
  || fail "pgbackrest info"
age=$(( $(date +%s) - newest ))
[ "$age" -lt 93600 ] || fail "newest backup ${age}s old"

msg="ok $stamp: disk ${disk}%, newest backup $(( age / 3600 ))h old"
[ -n "${HEALTH_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 --retry 3 --data-raw "$msg" "$HEALTH_HEARTBEAT_URL" >/dev/null
echo "$msg"
