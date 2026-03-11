const fs = require('fs');
const { execSync } = require('child_process');

function pushFix() {
  console.log("=== FINAL NATIVE DB DEPLOYMENT ===");
  try {
     const envRaw = fs.readFileSync('/opt/wa-agent-app/.env', 'utf-8');
     const match = envRaw.match(/SUPABASE_DB_PASSWORD=([^"\n]+)/);
     if (!match) throw new Error("Could not find SUPABASE_DB_PASSWORD in .env");
     
     const pwd = match[1].trim();
     console.log("DB Password extracted successfully.");

     const rawSql = fs.readFileSync('/opt/wa-agent-app/backend/sql_migrations/202603110001_client_creation_deadlock_fix.sql', 'utf8');
     fs.writeFileSync('/tmp/fix.sql', rawSql);

     // Force usage of port 5432 Direct Connection (IPv4 connection pooler but bypassing PgBouncer transaction mode)
     const host = "aws-0-eu-central-1.pooler.supabase.com";
     const cmd = `export PGPASSWORD="${pwd}" && psql -h ${host} -p 5432 -U postgres.qntpnyhwnhngkicxozss -d postgres -f /tmp/fix.sql`;
     
     try {
       console.log("Executing PSQL via terminal...");
       const out = execSync(cmd).toString();
       console.log("PSQL RESPONSE:", out);
     } catch(err) {
       console.error("PSQL Connect Failed. Output:", err.stdout ? err.stdout.toString() : err.message);
       console.error("PSQL STDERR:", err.stderr ? err.stderr.toString() : "none");
     }
  } catch(e) {
      console.error(e.message);
  }
}

pushFix();
