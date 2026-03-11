#!/bin/bash
set -e

echo "================================================="
echo " Deploying ManagerAi (manager-ai-api & worker) "
echo "================================================="

REPO_URL="https://github.com/SuperPartyByAI/wa-agent-app.git"
CANONICAL_DIR="/opt/wa-agent-app"
MANAGER_AI_DIR="$CANONICAL_DIR/manager-ai"

if [ -d "$CANONICAL_DIR" ]; then
    echo "Updating repository at $CANONICAL_DIR..."
    cd $CANONICAL_DIR
    git config --global --add safe.directory $CANONICAL_DIR
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning fresh repository to $CANONICAL_DIR..."
    git clone $REPO_URL $CANONICAL_DIR
fi

echo "Installing node dependencies..."
cd $MANAGER_AI_DIR
npm install

echo "Restarting PM2 Processes (manager-ai-api & manager-ai-worker)..."
pm2 delete manager-ai-api 2>/dev/null || true
pm2 delete manager-ai-worker 2>/dev/null || true

pm2 start manager-ai-api.mjs --name "manager-ai-api" --cwd "$MANAGER_AI_DIR"
pm2 start manager-ai-worker.mjs --name "manager-ai-worker" --cwd "$MANAGER_AI_DIR"

pm2 save

echo "================================================="
echo " Deployment Complete! Verify logs below:"
echo "================================================="
pm2 show manager-ai-api | grep "script path"
pm2 show manager-ai-worker | grep "script path"
git log -n 1 --oneline
