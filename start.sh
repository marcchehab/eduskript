#!/bin/sh
set -e

echo "Starting database migration..."

# Run database migrations 
npx prisma migrate deploy

echo "Database migration completed. Starting application..."

# Start the application
exec node server.js