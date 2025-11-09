#!/bin/bash

# Deployment script for Eduskript
# Watches GitHub Actions build and deploys to VPS once complete

set -e

# Configuration - Use environment variables with defaults
REPO="${DEPLOY_REPO:-marcchehab/eduskript}"
IMAGE="${DEPLOY_IMAGE:-ghcr.io/marcchehab/eduskript:latest}"
VPS_HOST="${DEPLOY_VPS_HOST}"
VPS_USER="${DEPLOY_VPS_USER}"

# Validate required environment variables
if [ -z "$VPS_HOST" ]; then
  echo -e "${RED}❌ Error: DEPLOY_VPS_HOST environment variable is not set${NC}"
  echo "Please set it before running this script:"
  echo "  export DEPLOY_VPS_HOST=your-vps-hostname"
  exit 1
fi

if [ -z "$VPS_USER" ]; then
  echo -e "${RED}❌ Error: DEPLOY_VPS_USER environment variable is not set${NC}"
  echo "Please set it before running this script:"
  echo "  export DEPLOY_VPS_USER=your-vps-username"
  exit 1
fi

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Eduskript Deployment Script${NC}"
echo ""

# Step 1: Watch GitHub Actions build
echo -e "${BLUE}📦 Watching GitHub Actions build for ${REPO}...${NC}"
echo "Press Ctrl+C to cancel"
echo ""

while true; do
  # Check if gh is available and authenticated
  if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ Error: gh CLI is not installed${NC}"
    echo "Please install it: https://cli.github.com/"
    exit 1
  fi

  # Try to get workflow run status
  if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ Error: gh CLI is not authenticated${NC}"
    echo "Please run: gh auth login"
    exit 1
  fi

  # Get latest workflow run
  RUN_DATA=$(gh run list --repo "$REPO" --limit 1 --json status,conclusion,workflowName,createdAt,databaseId 2>/dev/null)

  if [ -z "$RUN_DATA" ] || [ "$RUN_DATA" = "[]" ]; then
    echo -e "${YELLOW}⏳ No workflow runs found yet. Waiting...${NC}"
    sleep 10
    continue
  fi

  STATUS=$(echo "$RUN_DATA" | jq -r '.[0].status')
  CONCLUSION=$(echo "$RUN_DATA" | jq -r '.[0].conclusion')
  WORKFLOW=$(echo "$RUN_DATA" | jq -r '.[0].workflowName')
  RUN_ID=$(echo "$RUN_DATA" | jq -r '.[0].databaseId')
  TIMESTAMP=$(date '+%H:%M:%S')

  if [ "$CONCLUSION" = "null" ] || [ -z "$CONCLUSION" ]; then
    CONCLUSION="running"
  fi

  echo -e "${BLUE}[${TIMESTAMP}]${NC} ${WORKFLOW}: ${STATUS} - ${CONCLUSION}"

  # Check if completed
  if [ "$STATUS" = "completed" ]; then
    echo ""

    # Check if successful
    if [ "$CONCLUSION" = "success" ]; then
      echo -e "${GREEN}✅ Build completed successfully!${NC}"
      echo ""
      break
    else
      echo -e "${RED}❌ Build failed with conclusion: ${CONCLUSION}${NC}"
      echo "View details: https://github.com/${REPO}/actions/runs/${RUN_ID}"
      exit 1
    fi
  fi

  sleep 10
done

# Step 2: Deploy to VPS
echo -e "${BLUE}🚢 Deploying to VPS (${VPS_HOST})...${NC}"
echo ""

# Check if SSH connection works
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "${VPS_USER}@${VPS_HOST}" exit 2>/dev/null; then
  echo -e "${RED}❌ Error: Cannot connect to ${VPS_HOST}${NC}"
  echo "Please ensure:"
  echo "  1. You have SSH access to ${VPS_HOST}"
  echo "  2. Your SSH key is configured"
  echo "  3. The hostname is correct"
  exit 1
fi

# SSH into VPS and deploy
echo -e "${BLUE}🔄 Pulling latest Docker image...${NC}"

ssh "${VPS_USER}@${VPS_HOST}" << 'ENDSSH'
set -e

IMAGE="ghcr.io/marcchehab/eduskript:latest"

echo "📦 Pulling Docker image: ${IMAGE}"
docker pull "${IMAGE}"

echo ""
echo "🔄 Restarting Docker containers..."

# Find containers using the image
CONTAINERS=$(docker ps -a --filter "ancestor=${IMAGE}" --format "{{.Names}}" || true)

if [ -z "$CONTAINERS" ]; then
  echo "⚠️  No containers found using this image"
  echo "You may need to manually start your containers"
else
  echo "Found containers: ${CONTAINERS}"
  for CONTAINER in $CONTAINERS; do
    echo "🔄 Restarting ${CONTAINER}..."
    docker restart "${CONTAINER}"
  done

  echo ""
  echo "✅ Containers restarted successfully"
fi

echo ""
echo "📊 Current Docker status:"
docker ps

ENDSSH

echo ""
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}🎉 Your application should now be running with the latest changes${NC}"
