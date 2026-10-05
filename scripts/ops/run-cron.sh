#!/bin/bash
# Daily app cron (billing renewals, trial emails, cleanup — src/app/api/cron/route.ts).
# Run as root by eduskript-cron.timer (install-ops.sh); replaces the former
# GitHub Actions workflow. Calls the app through kamal-proxy on loopback, so
# nothing leaves the host. Needs CRON_SECRET in /etc/eduskript-ops.env (same
# value as the app's); pings CRON_HEARTBEAT_URL (+ /fail) if set.
set -uo pipefail
[ -f /etc/eduskript-ops.env ] && . /etc/eduskript-ops.env
: "${CRON_SECRET:?CRON_SECRET missing in /etc/eduskript-ops.env}"

body=$(mktemp)
code=$(curl -sS -o "$body" -w '%{http_code}' -m 600 -X POST \
  -H 'Host: eduskript.org' -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  http://127.0.0.1:8080/api/cron)
echo "HTTP $code: $(head -c 2000 "$body")"
rm -f "$body"

ok=0; [[ "$code" == 2* ]] && ok=1
if [ -n "${CRON_HEARTBEAT_URL:-}" ]; then
  [ $ok = 1 ] && suffix="" || suffix="/fail"
  curl -fsS -m 10 --retry 3 --data-raw "HTTP $code" "$CRON_HEARTBEAT_URL$suffix" >/dev/null
fi
[ $ok = 1 ]
