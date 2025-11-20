#!/bin/bash
# Force rebuild to invalidate incorrect Docker cache
set -e

echo "=== Eduskript Docker Container Starting ==="
echo "Node version: $(node --version)"
echo "DATABASE_URL: ${DATABASE_URL:0:50}..." # Show first 50 chars only
echo ""

echo "Fixing volume permissions..."
# Fix ownership of mounted volumes
sudo chown -R nextjs:nodejs /app/data /app/uploads
sudo chmod -R 755 /app/data /app/uploads
echo "✓ Permissions fixed"
echo ""

echo "Starting database migration..."
# Run Prisma migrations (Prisma 7.x with LibSQL adapter)
pnpm prisma migrate deploy
echo "✓ Migrations completed"
echo ""

echo "Seeding admin user if needed..."
# Create admin user if it doesn't exist
node prisma/seed-admin.js || echo "⚠ Admin seed failed, continuing..."
echo ""

echo "Starting Next.js application..."
echo "=== Application Starting ==="
exec node server.js
