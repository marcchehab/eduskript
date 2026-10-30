#!/bin/bash
# Install/refresh the backup + health timers on the VPS. Idempotent.
#   scp -r scripts/ops eduskript-prod:/tmp/ && ssh eduskript-prod sudo bash /tmp/ops/install-ops.sh
# Schedules (Europe/Zurich), kept clear of the 02:00–02:45 unattended-upgrades
# window: full Sunday 01:15, diff Mon–Sat 01:15, health check hourly at :20
# UTC, app cron daily 03:00 UTC (was GitHub Actions until 2026-10-05),
# object storage backup (files-backup.sh) daily 03:15. The
# health check is on UTC because in local time the autumn clock change skips
# one run (02:20 exists twice, systemd runs it once): 2026-10-25 that missed
# ping exceeded the 1 h + 30 min grace and raised a false alarm.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SRC/pgbackrest-backup.sh" /usr/local/sbin/eduskript-backup
install -m 755 "$SRC/health-check.sh" /usr/local/sbin/eduskript-health
install -m 755 "$SRC/run-cron.sh" /usr/local/sbin/eduskript-cron
install -m 755 "$SRC/files-backup.sh" /usr/local/sbin/eduskript-files-backup
command -v rclone >/dev/null || apt-get install -y rclone
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
OnCalendar=*-*-* *:20:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
U
unit eduskript-cron.service <<'U'
[Unit]
Description=eduskript daily app cron (POST /api/cron)
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/eduskript-cron
U
unit eduskript-cron.timer <<'U'
[Unit]
Description=Daily eduskript app cron
[Timer]
OnCalendar=*-*-* 03:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
U
unit eduskript-files-backup.service <<'U'
[Unit]
Description=Object storage backup dc3-a -> dc4-a (rclone crypt)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
Nice=10
IOSchedulingClass=idle
ExecStart=/usr/local/sbin/eduskript-files-backup
U
unit eduskript-files-backup.timer <<'U'
[Unit]
Description=Nightly object storage backup
[Timer]
OnCalendar=*-*-* 03:15
Persistent=true
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable --now eduskript-backup-full.timer eduskript-backup-diff.timer eduskript-health.timer eduskript-cron.timer \
  eduskript-files-backup.timer
systemctl list-timers 'eduskript-*' --no-pager
