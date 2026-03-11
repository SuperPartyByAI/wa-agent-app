#!/bin/bash
set -e

echo "==========================================="
echo " Deploying whts-up (wa-api) Canonical"
echo "==========================================="

REPO_URL="https://github.com/SuperPartyByAI/wa-agent-app.git"
CANONICAL_DIR="/opt/wa-agent-app"
BACKEND_DIR="$CANONICAL_DIR/backend"

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

echo "Installing dependencies..."
cd $BACKEND_DIR
npm install

echo "Restarting PM2 Process (wa-api)..."
# Ensure the process runs from the generic canonical path
pm2 delete wa-api 2>/dev/null || true
pm2 start index.js --name "wa-api" --cwd "$BACKEND_DIR"
pm2 save

echo "==========================================="
echo " Deployment Complete! Verify logs below:"
echo "==========================================="
pm2 show wa-api | grep "script path"
git log -n 1 --oneline
