# Setup

Get Eduskript running locally in 5 minutes.

## Prerequisites

- Node.js 22.x
- pnpm
- Docker

## Steps

```bash
# Clone
git clone https://github.com/marcchehab/eduskript
cd eduskript

# Install
pnpm install

# Start Postgres
pnpm db:local

# Configure
cp .env.example .env.local
```

Edit `.env.local`:
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/eduskript_dev"
NEXTAUTH_SECRET="any-random-string"
NEXTAUTH_URL="http://localhost:3000"
```

```bash
# Setup database
pnpm db:generate
pnpm db:push

# Run
pnpm dev
```

Open http://localhost:3000

## Create Admin Account

```bash
pnpm db:seed
```

Login: `eduadmin@eduskript.org` / `letseducate`

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server |
| `pnpm test` | Run tests (watch) |
| `pnpm test:run` | Run tests (once) |
| `pnpm validate` | Type-check + lint + test |
| `pnpm db:studio` | Browse database |

## Troubleshooting

**Stale data?**
```bash
rm -rf .next && pnpm dev
```

**Database issues?**
```bash
pnpm db:local:stop && pnpm db:local
```
