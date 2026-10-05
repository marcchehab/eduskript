#!/bin/bash
# Install/refresh the backup + health timers on the VPS. Idempotent.
#   scp -r scripts/ops eduskript-prod:/tmp/ && ssh eduskript-prod sudo bash /tmp/ops/install-ops.sh
# Schedules (Europe/Zurich), kept clear of the 02:00–02:45 unattended-upgrades
# window: full Sunday 01:15, diff Mon–Sat 01:15, health check hourly at :20.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SRC/pgbackrest-backup.sh" /usr/local/sbin/eduskript-backup
install -m 755 "$SRC/health-check.sh" /usr/local/sbin/eduskript-health
[ -f /etc/eduskript-ops.env ] || install -m 600 /dev/null /etc/eduskript-ops.env

unit() { cat > "/etc/systemd/system/$1"; }
unit eduskript-backup@.service <<'U'
[Unit]
Description=pgBackRest %i backup of eduskript-db
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/eduskript-backup %i
U
unit eduskript-backup-full.timer <<'U'
[Unit]
Description=Weekly full pgBackRest backup
[Timer]
OnCalendar=Sun *-*-* 01:15
Persistent=true
Unit=eduskript-backup@full.service
[Install]
WantedBy=timers.target
U
unit eduskript-backup-diff.timer <<'U'
[Unit]
Description=Daily differential pgBackRest backup
[Timer]
OnCalendar=Mon..Sat *-*-* 01:15
Persistent=true
Unit=eduskript-backup@diff.service
[Install]
WantedBy=timers.target
U
unit eduskript-health.service <<'U'
[Unit]
Description=eduskript ops health check (disk, WAL archiving, backup age)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/eduskript-health
U
unit eduskript-health.timer <<'U'
[Unit]
Description=Hourly eduskript ops health check
[Timer]
OnCalendar=*-*-* *:20
Persistent=true
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable --now eduskript-backup-full.timer eduskript-backup-diff.timer eduskript-health.timer
systemctl list-timers 'eduskript-*' --no-pager
