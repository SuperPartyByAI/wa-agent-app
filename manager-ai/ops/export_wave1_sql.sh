#!/usr/bin/env bash
# export_wave1_sql.sh
TIMESTAMP=$(date +%s)
echo "Starting exports for Wave 1 Canary..."

# Extract vars from .env for local testing if not set
if [ -z "$DB_HOST" ]; then
    export DB_HOST=$(cat ../.env | grep SUPABASE_DB_URL= | cut -d '@' -f2 | cut -d ':' -f1)
    # the format is postgres://postgres.[project-ref]:[db-password]@[aws-region].pooler.supabase.com:6543/postgres
    # Just in case, this is a fallback. The proper way is to set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in environment.
    export PGPASSWORD=$DB_PASSWORD
fi

#read -p "Press Enter to run the pg_dump/psql exports for Wave1... (Ensure DB_USER, DB_HOST, DB_NAME, DB_PASSWORD are set!)"

# Query 1: last 200 change logs
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\copy (SELECT * FROM public.ai_event_change_log ORDER BY created_at DESC LIMIT 200) TO 'change_log_${TIMESTAMP}.json' WITH (FORMAT json)"
echo "Exported change_log_${TIMESTAMP}.json"

# Query 2: recently modified events
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\copy (SELECT * FROM public.ai_client_events WHERE updated_at > now() - interval '2 hour') TO 'events_recent_${TIMESTAMP}.json' WITH (FORMAT json)"
echo "Exported events_recent_${TIMESTAMP}.json"

# Query 3: reply decisions
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\copy (SELECT * FROM public.ai_reply_decisions WHERE created_at > now() - interval '2 hour') TO 'reply_decisions_${TIMESTAMP}.json' WITH (FORMAT json)"
echo "Exported reply_decisions_${TIMESTAMP}.json"

echo "Exports completed."
