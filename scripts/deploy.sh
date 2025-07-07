#!/bin/bash

# Eduscript Enhanced Direct Deployment Script
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}
PROJECT_DIR="$HOME/eduscript"
LOG_FILE="$HOME/logs/deploy-$(date +%Y%m%d-%H%M%S).log"
BACKUP_DIR="$HOME/backups/eduscript"
NODE_VERSION="22"

echo "🚀 Starting eduscript deployment for $ENVIRONMENT environment..."

# Create necessary directories
mkdir -p "$HOME/logs" "$BACKUP_DIR"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to handle errors
handle_error() {
    log "❌ Error occurred during deployment!"
    log "🔄 Attempting to restore from backup..."
    if [ -d "$BACKUP_DIR/current" ]; then
        cp -r "$BACKUP_DIR/current/." "$PROJECT_DIR/" 2>/dev/null || true
        log "📦 Backup restored. Please check manually."
    fi
    exit 1
}

trap handle_error ERR

# Load environment variables
if [ -f "$PROJECT_DIR/.env.production" ]; then
    log "🔧 Loading production environment variables..."
    set -a
    source "$PROJECT_DIR/.env.production"
    set +a
fi

# Pre-deployment backup
log "💾 Creating backup..."
rm -rf "$BACKUP_DIR/current"
mkdir -p "$BACKUP_DIR/current"
if [ -d "$PROJECT_DIR" ]; then
    cp -r "$PROJECT_DIR/." "$BACKUP_DIR/current/" 2>/dev/null || true
fi

cd "$PROJECT_DIR"

# Ensure correct Node.js version
log "🔍 Checking Node.js version..."
if command -v uberspace >/dev/null 2>&1; then
    uberspace tools version use node $NODE_VERSION || log "⚠️  Could not set Node.js version"
fi

# Health checks before build
log "🏥 Running pre-deployment checks..."
node --version
npm --version

# Check if we're in the right directory
log "📁 Current directory: $(pwd)"
log "📁 Directory contents: $(ls -la | wc -l) items"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    log "❌ package.json not found in current directory!"
    exit 1
fi

# Check if pnpm is available, install if not
if ! command -v pnpm >/dev/null 2>&1; then
    log "📦 Installing pnpm..."
    npm install -g pnpm
fi

# Dependencies
log "📦 Installing dependencies..."
pnpm install --frozen-lockfile --prefer-offline

# Verify Prisma is available
log "🔍 Verifying Prisma installation..."
if ! pnpm exec prisma --version >/dev/null 2>&1; then
    log "❌ Prisma not found in node_modules. Trying to install..."
    pnpm install @prisma/client prisma
fi

# Database operations
log "🗃️ Generating Prisma client..."
pnpm exec prisma generate

if [ "$ENVIRONMENT" = "production" ]; then
    log "🔧 Running database migrations..."
    pnpm exec prisma migrate deploy
else
    log "🔧 Pushing database schema..."
    pnpm exec prisma db push --skip-generate
fi

# Build
log "🏗️ Building application..."
NODE_ENV=production pnpm run build:production

# Post-build checks
log "🔍 Post-build validation..."
if [ ! -d ".next" ]; then
    log "❌ Build failed - .next directory not found"
    exit 1
fi

# Check if build output exists and has content
if [ ! "$(ls -A .next 2>/dev/null)" ]; then
    log "❌ Build failed - .next directory is empty"
    exit 1
fi

# Restart application (Uberspace-specific)
log "🔄 Restarting application..."
if [ -f "$HOME/.config/supervisord/conf.d/eduscript.ini" ]; then
    supervisorctl restart eduscript || log "⚠️  Could not restart via supervisor"
fi

# Create/update process management if using PM2
if command -v pm2 >/dev/null 2>&1; then
    pm2 restart eduscript 2>/dev/null || pm2 start npm --name "eduscript" -- start
fi

log "🎉 Deployment completed successfully!"

# Cleanup old logs and backups
log "🧹 Cleaning up old files..."
find "$HOME/logs" -name "deploy-*.log" -type f -mtime +7 -delete 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +3 | tail -n +6 | xargs rm -rf 2>/dev/null || true

echo "✅ Eduscript deployment finished successfully!"
echo "📊 Deployment log: $LOG_FILE"
