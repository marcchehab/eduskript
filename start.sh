#!/bin/sh
set -e

echo "Fixing volume permissions..."
# Fix ownership of mounted volumes
sudo chown -R nextjs:nodejs /app/data /app/uploads
sudo chmod -R 755 /app/data /app/uploads

echo "Starting database migration..."
# Run Prisma migrations (apply all pending migration files)
# Use local prisma to ensure version matches package.json (6.11.0, not latest 7.x)
node_modules/.bin/prisma migrate deploy

echo "Seeding admin user if needed..."
# Create admin user if it doesn't exist
node prisma/seed-admin.js || echo "Admin seed failed, continuing..."

echo "Starting Next.js application..."
exec node server.js
