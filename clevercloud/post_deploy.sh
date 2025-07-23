#!/bin/bash

# CleverCloud post-deploy hook for Eduscript
# This script runs after the application is deployed

set -e

echo "🚀 Starting post-deploy setup..."

# Check if POSTGRESQL_ADDON_URI is available
if [ -z "$POSTGRESQL_ADDON_URI" ]; then
    echo "❌ ERROR: POSTGRESQL_ADDON_URI not found"
    echo "Please configure PostgreSQL addon in CleverCloud console"
    exit 1
fi

# Construct DATABASE_URL with connection parameters for Prisma
export DATABASE_URL="${POSTGRESQL_ADDON_URI}?connection_limit=1&pool_timeout=20"

echo "✅ Database URL configured with connection parameters"

# Generate Prisma client (should already be done in build, but ensure it's available)
echo "🔧 Ensuring Prisma client is generated..."
pnpm prisma generate

# Check database state and handle accordingly
echo "🗄️  Checking database state..."

# First, try to run migrate deploy (safe for existing schemas)
echo "🔄 Attempting to apply migrations..."
if pnpm prisma migrate deploy 2>/dev/null; then
    echo "✅ Migrations applied successfully!"
else
    echo "⚠️  No migrations found or migration failed, checking database state..."
    
    # Check if database has tables (is initialized)
    TABLES_COUNT=$(pnpm prisma db execute --stdin <<< "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tail -n 1 || echo "0")
    
    if [ "$TABLES_COUNT" -eq "0" ]; then
        echo "📝 Database is empty, pushing initial schema..."
        if pnpm prisma db push --accept-data-loss; then
            echo "✅ Initial schema pushed to database"
        else
            echo "❌ ERROR: Database schema push failed"
            exit 1
        fi
    else
        echo "✅ Database already initialized with $TABLES_COUNT tables"
    fi
fi

# Optional: Run database seeding if seed file exists
if [ -f "prisma/seed.ts" ] || [ -f "prisma/seed.js" ]; then
    echo "🌱 Running database seed..."
    if pnpm prisma db seed; then
        echo "✅ Database seeded successfully"
    else
        echo "⚠️  Database seeding failed (this is usually not critical)"
    fi
fi

echo "🎉 Post-deploy setup completed successfully!"
echo "🌐 Application should be available at: $NEXTAUTH_URL"
