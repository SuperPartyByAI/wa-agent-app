#!/bin/bash
# deploy_manager_ai.sh — Single canonical deploy script
# Deploys manager-ai from the GitHub repo to the runtime directory.
#
# Usage: ./deploy_manager_ai.sh
#
# Canonical paths:
#   Runtime (PM2):  /root/manager-ai/
#   Git clone:      /root/manager-ai-repo/
#
# Flow:
#   1. git pull in repo clone
#   2. rsync src/ and entry files to runtime
#   3. pm2 restart
#
set -euo pipefail

REPO_DIR="/root/manager-ai-repo"
RUNTIME_DIR="/root/manager-ai"
MANAGER_AI_SUBDIR="${REPO_DIR}/manager-ai"

echo "=== Manager-AI Deploy ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Pull latest from GitHub
echo "[1/4] Pulling latest from GitHub..."
cd "$REPO_DIR"
git fetch origin main
git reset --hard origin/main
COMMIT=$(git rev-parse --short HEAD)
echo "  HEAD: $COMMIT"
echo ""

# 2. Verify manager-ai subdir exists
if [ ! -d "$MANAGER_AI_SUBDIR/src" ]; then
  echo "❌ ERROR: $MANAGER_AI_SUBDIR/src not found!"
  exit 1
fi

# 3. Sync source files to runtime
echo "[2/4] Syncing source files..."
rsync -av --delete \
  "$MANAGER_AI_SUBDIR/src/" "$RUNTIME_DIR/src/" \
  --exclude='*.test.*' \
  --exclude='__tests__' \
  | tail -5
echo ""

# 4. Sync entry point files
echo "[3/4] Syncing entry files..."
for f in manager-ai-api.mjs manager-ai-worker.mjs; do
  if [ -f "$MANAGER_AI_SUBDIR/$f" ]; then
    cp "$MANAGER_AI_SUBDIR/$f" "$RUNTIME_DIR/$f"
    echo "  ✅ $f"
  fi
done
# Sync catalog if it exists separately
if [ -f "$MANAGER_AI_SUBDIR/src/services/catalog.json" ]; then
  cp "$MANAGER_AI_SUBDIR/src/services/catalog.json" "$RUNTIME_DIR/src/services/catalog.json"
  echo "  ✅ catalog.json"
fi
echo ""

# 5. Restart PM2
echo "[4/4] Restarting PM2..."
cd "$RUNTIME_DIR"
pm2 restart manager-ai-api --update-env 2>&1 | grep -E "status|name|uptime|pid"
echo ""

# 6. Verify
echo "=== Verification ==="
echo "Runtime files: $(find $RUNTIME_DIR/src -name '*.mjs' | wc -l) .mjs files"
echo "Repo commit: $COMMIT"
echo "PM2 status: $(pm2 jlist 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'])" 2>/dev/null || echo 'check manually')"
echo ""
echo "✅ Deploy complete: $COMMIT"
