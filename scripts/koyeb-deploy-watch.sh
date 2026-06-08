#!/usr/bin/env bash
#
# Watch the Koyeb deploy triggered by a git push and fire a desktop notification
# when it starts, settles HEALTHY, or fails. Spawned detached from .husky/pre-push
# (runs only after validation passes). Ephemeral and self-terminating:
#
#   baseline current deploy -> wait for the NEW one this push creates -> track to
#   a terminal state -> notify -> exit.
#
# Bounded two ways: an internal MAX loop budget AND a hard `timeout` wrapper in the
# hook (so a hung CLI call can't keep it alive forever). See .husky/pre-push.
#
# No-ops silently if koyeb / jq / notify-send are missing, so contributors without
# the Koyeb CLI or a desktop session aren't affected.

set -euo pipefail

SERVICE="${1:-f84d4b3f}"   # eduskript web service
POLL=20                    # seconds between polls
MAX=$((18 * 60))           # internal budget; outer `timeout` in the hook is the hard cap

# Graceful no-op when tooling is absent (CI, headless contributors, etc.).
command -v koyeb       >/dev/null 2>&1 || exit 0
command -v jq          >/dev/null 2>&1 || exit 0
command -v notify-send >/dev/null 2>&1 || exit 0

# notify-send needs a session bus; a hook-spawned process usually inherits it.
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

notify() { notify-send -a "Koyeb" "${1:-?}" "${2:-}" -u "${3:-normal}" 2>/dev/null || true; }

latest() {
  koyeb deployments list --service "$SERVICE" -o json 2>/dev/null \
    | jq -r '.deployments[0] | "\(.id) \(.status)"'
}

read -r BASE_ID _ < <(latest) || true   # deploy present at push time = baseline
NEW_ID=""; FAILS=0; elapsed=0

while [ "$elapsed" -lt "$MAX" ]; do
  sleep "$POLL"; elapsed=$((elapsed + POLL))
  read -r ID STATUS < <(latest) || true
  [ -z "${ID:-}" ] && continue           # transient API hiccup

  if [ -z "$NEW_ID" ]; then
    [ "$ID" = "$BASE_ID" ] && continue    # our deploy not created yet
    NEW_ID="$ID"
    notify "Deploy started" "eduskript · ${ID:0:8} ($STATUS)" normal
  fi

  case "$STATUS" in
    HEALTHY)       notify "Deploy HEALTHY ✅" "eduskript · ${ID:0:8}" normal; exit 0 ;;
    ERROR|STOPPED) notify "Deploy FAILED ❌" "eduskript · ${ID:0:8} ($STATUS)" critical; exit 0 ;;
    # UNHEALTHY is transient during cutover (migrate + seed before bind); only alert
    # if it persists for 3 consecutive polls.
    UNHEALTHY)     FAILS=$((FAILS + 1))
                   if [ "$FAILS" -ge 3 ]; then
                     notify "Deploy UNHEALTHY ⚠️" "eduskript · ${ID:0:8} — stuck" critical
                     exit 0
                   fi ;;
    *)             FAILS=0 ;;
  esac
done

# Saw a new deploy but it never settled within the budget.
[ -n "$NEW_ID" ] && notify "Deploy watch timed out ⏱" "eduskript · ${NEW_ID:0:8} never settled" critical
# No new deploy at all (push rejected / no rebuild) -> exit quietly.
exit 0
