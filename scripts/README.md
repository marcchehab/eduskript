# Development Setup Scripts

This directory contains scripts to automate the Eduskript development environment setup.

## Quick Start

### Linux/macOS/WSL
```bash
pnpm setup
# or directly:
bash scripts/setup-dev.sh
```

### Windows (PowerShell - Recommended)
```powershell
pnpm setup:windows
# or directly:
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1
```

### Windows (Command Prompt)
```cmd
scripts\setup-dev.bat
```

## What These Scripts Do

All scripts perform the same setup steps:

1. ✓ Check Docker is installed and running
2. ✓ Install pnpm dependencies (if needed)
3. ✓ Generate `.env.local` configuration file
4. ✓ Start PostgreSQL container via Docker Compose
5. ✓ Wait for PostgreSQL to be ready
6. ✓ Generate Prisma client
7. ✓ Run database migrations
8. ✓ Seed admin user

## Requirements

- **Docker Desktop** installed and running
- **Node.js 22.x** installed
- **pnpm** package manager installed

## After Setup

Once the setup completes successfully:

1. **Start the dev server:**
   ```bash
   pnpm dev
   ```

2. **Open your browser:**
   ```
   http://localhost:3000
   ```

3. **Login with admin credentials:**
   - Email: `eduadmin@eduskript.org`
   - Password: `letseducate`

## Managing PostgreSQL

The setup creates a Docker container named `eduskript-postgres-dev`.

**View logs:**
```bash
docker logs eduskript-postgres-dev
```

**Stop container:**
```bash
docker stop eduskript-postgres-dev
```

**Start container:**
```bash
docker start eduskript-postgres-dev
```

**Remove container and data:**
```bash
docker compose -f docker-compose.local.yml down -v
```

## Script Files

- **`setup-dev.sh`** - Bash script for Linux/macOS/WSL
- **`setup-dev.ps1`** - PowerShell script for Windows (colorized output)
- **`setup-dev.bat`** - Batch script for Windows Command Prompt

## Troubleshooting

### Docker not found
- Install Docker Desktop: https://www.docker.com/products/docker-desktop/
- Make sure Docker Desktop is running
- Restart your terminal after installation

### Port already in use
The scripts use default ports:
- PostgreSQL: `5432`
- Next.js: `3000`

If these are taken, you can manually edit `.env.local` to use different ports.

### Permission denied (PowerShell)
If you get a script execution error, run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Database already exists
The scripts are safe to re-run. If the database already exists, it will be reused.
To start fresh, remove the container first:
```bash
docker compose -f docker-compose.local.yml down -v
```
