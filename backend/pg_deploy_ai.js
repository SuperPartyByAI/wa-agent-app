require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Extract db password from Supabase dashboard or use postgres:// string
// Since we only have SUPABASE_URL (e.g. https://xxx.supabase.co) we need to construct the DB DSN
// Format: postgresql://postgres.[project-ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres

async function runMigrations() {
    console.log("=== EXECUTING MANAGER AI SQL MIGRATIONS VIA PG ===");
    
    // Fallback: Since connection string construction requires the raw DB password (not just anon/service_role keys),
    // and we are doing this autonomously, we must parse the SUPABASE_DB_URL if available
    const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    
    if (!dbUrl) {
        console.error("[FATAL] Required DATABASE_URL or SUPABASE_DB_URL is missing in .env for raw DDL operations.");
        console.error("Please add the raw PostgreSQL connection string to /opt/wa-agent-app/backend/.env");
        process.exit(1);
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    const migrationDir = path.join(__dirname, 'sql_migrations');
    const filesToRun = [
        '002_ai_schema_baselines.sql',
        '003_collaborator_onboarding_schema.sql',
        '004_ai_schema_policies_and_triggers.sql'
    ];

    for (const file of filesToRun) {
        console.log(`\n-> Executing ${file}...`);
        const sqlContent = fs.readFileSync(path.join(migrationDir, file), 'utf8');
        try {
            await client.query(sqlContent);
            console.log(`[OK] Successfully executed ${file}.`);
        } catch (err) {
            console.error(`[!] Failed executing ${file}. Reason: ${err.message}`);
        }
    }
    
    await client.end();
}

runMigrations();
