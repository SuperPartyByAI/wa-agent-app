require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { execSync } = require('child_process');

async function pushFix() {
  console.log("=== FINAL ATTEMPT: BYPASSING PG CONNECTORS ENTIRELY ===");
  try {
     const rawSql = fs.readFileSync('/opt/wa-agent-app/backend/sql_migrations/202603110001_client_creation_deadlock_fix.sql', 'utf8');
     fs.writeFileSync('/tmp/fix.sql', rawSql);

     console.log("Using local Postgres client if installed on Hetzner...");
     const pwd = process.env.SUPABASE_DB_PASSWORD;
     // Let's explicitly try using SSL mode require with the pooler IP
     const cmd = `PGPASSWORD="${pwd}" psql "postgresql://postgres.qntpnyhwnhngkicxozss:${pwd}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require" -f /tmp/fix.sql`;
     
     try {
       const out = execSync(cmd).toString();
       console.log("PSQL Deploy Success:", out);
     } catch(err) {
       console.error("PSQL Connect Failed. Detailed error:", err.message);
     }
  } catch(e) {
      console.error(e);
  }
}

pushFix();
