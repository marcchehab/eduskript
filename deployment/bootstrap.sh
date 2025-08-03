#!/bin/bash

# Eduskript Bootstrap Script
# Run this first on a clean VPS to set everything up

set -e

DEPLOYMENT_REPO="marcchehab/eduskript-deployment"
DEPLOY_DIR="/home/fedora/eduskript"

echo "🎯 Bootstrapping Eduskript deployment..."

# Run system setup first
echo "🔧 Setting up system dependencies..."
curl -fsSL https://raw.githubusercontent.com/$DEPLOYMENT_REPO/main/setup-fedora.sh | bash

echo "📂 Cloning deployment configuration..."
git clone https://github.com/$DEPLOYMENT_REPO.git $DEPLOY_DIR

echo "📝 Configuration setup:"
echo "1. Edit your .env file: cd $DEPLOY_DIR && cp .env.example .env && nano .env"
echo "2. Run deployment: cd $DEPLOY_DIR && ./deploy.sh"
echo ""
echo "✨ Bootstrap complete! Follow the steps above to configure and deploy."