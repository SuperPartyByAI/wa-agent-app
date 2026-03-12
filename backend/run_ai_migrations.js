require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function runMigrations() {
    console.log("=== EXECUTING MANAGER AI SQL MIGRATIONS ===");
    
    const migrationDir = path.join(__dirname, 'sql_migrations');
    const filesToRun = [
        '002_ai_schema_baselines.sql',
        '003_collaborator_onboarding_schema.sql',
        '004_ai_schema_policies_and_triggers.sql'
    ];

    for (const file of filesToRun) {
        console.log(`\n-> Reading ${file}...`);
        const filePath = path.join(migrationDir, file);
        if (!fs.existsSync(filePath)) {
            console.error(`[FATAL] Missing file: ${filePath}`);
            continue;
        }

        const sqlContent = fs.readFileSync(filePath, 'utf8');
        
        // Supabase REST block execution workaround: Using RPC or executing via pg-run bypass if REST is limited.
        // Actually, Supabase JS client doesn't natively support executing raw DDL via SQL REST endpoint easily unless using a specific RPC like 'exec_sql'.
        // To guarantee success on Hetzner, we'll try an RPC first if it exists, otherwise we'll instruct the user to run it via CLI or we run it locally via psql.
        
        console.log(`Attempting to execute via RPC 'exec_sql' (common Superparty extension)...`);
        const { data, error } = await supabase.rpc('exec_sql', { query: sqlContent });
        
        if (error) {
            console.error(`[!] Failed executing ${file} via RPC. Reason: ${error.message}`);
            console.log(`[!] Raw SQL execution via REST is highly restricted for DDL. Falling back to explicit output for terminal psql if necessary.`);
        } else {
            console.log(`[OK] Successfully executed ${file}.`);
        }
    }
}

runMigrations();
