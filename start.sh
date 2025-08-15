#!/bin/sh
set -e

echo "Fixing data directory permissions..."

# Fix ownership of the data directory to nextjs user
chown -R nextjs:nodejs /app/data

echo "Starting database migration as nextjs user..."

# Switch to nextjs user and run migrations
su nextjs -c "npx prisma migrate deploy"

echo "Database migration completed. Starting application..."

# Start the application as nextjs user
exec su nextjs -c "node server.js"