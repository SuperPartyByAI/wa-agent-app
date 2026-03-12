#!/bin/bash
set -e

echo "=== INITIALIZING DIRECT PSQL AI MIGRATIONS ==="

# Define the local path on Hetzner
MIGRATION_DIR="/opt/wa-agent-app/backend/sql_migrations"

# Source variables to get SUPABASE_URL
source /opt/wa-agent-app/backend/.env

# Parse standard Postgres connection string from REST URL or use DB_URL if it exists
if [ -z "$DATABASE_URL" ]; then
    echo "[!] DATABASE_URL not explicitly set in .env. Attempting to parse or require user action."
    # Temporary fallback: Print instructions if missing
    cat "$MIGRATION_DIR/002_ai_schema_baselines.sql" | grep CREATE | head -n 3
    echo "...(Please execute manually via Supabase Dashboard SQL Editor)..."
    exit 1
fi

# 002
echo "Executing 002_ai_schema_baselines.sql..."
psql "$DATABASE_URL" -f "$MIGRATION_DIR/002_ai_schema_baselines.sql"

# 003
echo "Executing 003_collaborator_onboarding_schema.sql..."
psql "$DATABASE_URL" -f "$MIGRATION_DIR/003_collaborator_onboarding_schema.sql"

# 004
echo "Executing 004_ai_schema_policies_and_triggers.sql..."
psql "$DATABASE_URL" -f "$MIGRATION_DIR/004_ai_schema_policies_and_triggers.sql"

echo "=== PSQL EXECUTIONS COMPLETED ==="
