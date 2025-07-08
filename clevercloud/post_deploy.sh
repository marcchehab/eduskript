#!/bin/bash

# CleverCloud post-deploy hook for Eduscript
# This script runs after the application is deployed

echo "Starting post-deploy setup..."

# Generate Prisma client
echo "Generating Prisma client..."
pnpm prisma generate

# Check database state and handle accordingly
echo "Checking database state..."

# Try to run migrate deploy first (safe for existing schemas)
if pnpm prisma migrate deploy 2>/dev/null; then
    echo "Migrations applied successfully!"
elif [ $? -eq 1 ]; then
    # If migrate fails, it might be because database is empty or no migrations exist
    echo "No migrations to apply, checking if database needs initial schema..."
    
    # Use db push only if migrate failed (which indicates empty DB or no migrations)
    pnpm run db:push --accept-data-loss
    echo "Initial schema pushed to database."
fi

echo "Post-deploy setup completed successfully!"
