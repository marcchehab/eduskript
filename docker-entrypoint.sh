#!/bin/sh
# Container start sequence — mirrors `pnpm start` in package.json, which Koyeb
# still uses. Seeds are idempotent and their failures are tolerated, exactly as
# there. `exec` hands PID 1's child slot to node so SIGTERM from kamal-proxy's
# drain reaches the server (instrumentation.ts flushes metrics on it); tini in
# the Dockerfile ENTRYPOINT reaps zombies.
#
# Runs before the server listens, so kamal's deploy_timeout must cover migrate
# + all seeds (config/deploy.yml).
set -e

./node_modules/.bin/prisma migrate deploy
node scripts/seed-admin.js   || echo 'Seeding failed, continuing...'
node scripts/seed-demo.mjs   || echo 'Demo seed failed, continuing...'
node scripts/sync-docs.mjs   || echo 'Docs sync failed, continuing...'
node scripts/seed-plugins.mjs || echo 'Plugin seed failed, continuing...'

exec node --max-old-space-size="${NODE_HEAP_MB:-1536}" .next/standalone/server.js
