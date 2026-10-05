# Break-glass: eduskript.org is down and Chris is unreachable

For the trusted person with emergency access to Chris' Bitwarden. Goal: get
the site back up or at least keep the data safe. Don't delete anything.

## What is where

- Server: Infomaniak VPS "eduskript-prod" (ov-275f28.infomaniak.ch,
  179.237.126.129). Infomaniak login: Bitwarden item "Infomaniak".
- SSH key: Bitwarden SSH item "eduskript-prod" (user `debian`, has sudo).
- All app secrets: Bitwarden note "eduskript prod.env".
- Backups: on the server (`/var/lib/eduskript/pgbackrest`) and encrypted at
  Scaleway (bucket `eduskript-backups`, passphrase = `PGBACKREST_REPO2_CIPHER_PASS`
  in prod.env).
- Code + deploy config: GitHub repo eduskript, `config/deploy.yml`.

## 1. Look

```
ssh debian@ov-275f28.infomaniak.ch
sudo docker ps -a          # eduskript-web-*, kamal-proxy, eduskript-db, eduskript-caddy should be "Up"
df -h /; free -h
sudo eduskript-health      # disk, WAL archiving, backup age
```

## 2. The usual fixes (try in this order)

1. Something not "Up": `sudo docker start <name>` (or `sudo reboot` — all
   containers restart automatically).
2. Disk full: `sudo docker system prune -f` (removes unused images only).
3. App crashes after a recent deploy: on a computer with the repo and Docker,
   `bin/kamal rollback <previous version>` (`bin/kamal app containers` lists them).

## 3. If the server is lost

Follow `scripts/ops/RESTORE.md` section B, or hand this file plus the
Bitwarden access to someone who knows Docker/Linux.

## 4. Tell people

Teachers who use eduskript: short email via Brevo or Chris' mail account;
status note on the eduskript.org frontpage is not possible while it is down.
