#!/bin/bash

# Eduskript Deployment Script
# Run this on your VPS after initial setup

set -e

DEPLOY_DIR="/home/fedora/eduskript"
GITHUB_REPO=${1:-"marcchehab/eduskript"}
DEPLOYMENT_REPO="marcchehab/eduskript-deployment"

echo "🚀 Deploying Eduskript..."

# Clone or update deployment configuration
if [ ! -d "$DEPLOY_DIR" ]; then
    echo "📥 Cloning deployment configuration..."
    git clone https://github.com/$DEPLOYMENT_REPO.git $DEPLOY_DIR
else
    echo "📥 Updating deployment configuration..."
    cd $DEPLOY_DIR
    git pull origin main
fi

cd $DEPLOY_DIR

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Copy .env.example to .env and configure it first:"
    echo "cp .env.example .env && nano .env"
    exit 1
fi

# Load environment variables
source .env

# Update GITHUB_REPOSITORY in docker-compose if provided
if [ "$GITHUB_REPO" != "your-username/eduskript" ]; then
    echo "📝 Updating repository in docker-compose.yml..."
    sed -i "s|ghcr.io/.*:|ghcr.io/$GITHUB_REPO:|g" docker-compose.yml
fi

# Check if user is in docker group
if ! groups | grep -q docker; then
    echo "❌ User not in docker group. Please run:"
    echo "sudo usermod -aG docker $USER"
    echo "Then log out and back in, or run: newgrp docker"
    exit 1
fi

# Login to GitHub Container Registry for private repos
if [ ! -z "$GITHUB_TOKEN" ] && [ ! -z "$GITHUB_ACTOR" ]; then
    echo "🔐 Logging into GitHub Container Registry..."
    echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_ACTOR --password-stdin
fi

# Pull latest images
echo "📦 Pulling latest Docker images..."
docker-compose pull

# Start services
echo "🔄 Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service status
echo "📊 Service Status:"
docker-compose ps

# Show logs for any failed services
for service in $(docker-compose ps --services --filter "status=exited"); do
    echo "❌ $service failed to start. Logs:"
    docker-compose logs --tail=20 $service
done

# Initialize database if needed
echo "🗄️ Checking database..."
if [ ! -f "./data/database.db" ]; then
    echo "📥 Initializing database..."
    docker-compose exec -T eduskript npx prisma migrate deploy
    docker-compose exec -T eduskript npx prisma db seed 2>/dev/null || true
else
    echo "🔄 Running database migrations..."
    docker-compose exec -T eduskript npx prisma migrate deploy
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Services available at:"
echo "  - Application: http://$(curl -s ifconfig.me):3000"
echo "  - Nginx Proxy Manager: http://$(curl -s ifconfig.me):81"
echo ""
echo "📝 Next steps:"
echo "1. Configure Nginx Proxy Manager at port 81"
echo "2. Set up your custom domains and SSL certificates"
echo "3. Test your application functionality"
echo ""
echo "📊 Monitor with: docker-compose logs -f"