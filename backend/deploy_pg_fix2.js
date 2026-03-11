require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function deployFix() {
  console.log("=== EXECUTING RAW SQL MIGRATION VIA REST ===");
  try {
    const rawSql = fs.readFileSync('/opt/wa-agent-app/backend/sql_migrations/202603110001_client_creation_deadlock_fix.sql', 'utf8');
    
    // Some Supabase setups map raw SQL evaluation internally to a hidden pg_execute
    // Let's attempt the standard `exec` or we can just run a raw query string using internal REST undocumented endpoints
    // Actually, Supabase JS doesn't have a `.query()` natively, you either use RPC or PG module.
    // If PG module failed due to IPv4 pooler issues, let's use the explicit session port with the direct DB connection string
    // Let's print out what connection string it actually tried
    console.log("Connecting securely locally bypassing pooler...");

    const { Client } = require('pg');
    
    // Get direct PG connection string directly from environment 
    // Usually SUPABASE_DB_PASSWORD can be combined with standard port 5432 and the IP
    // For local Supabase (if self-hosted) or remote Supabase, we can use the exact URI from `process.env.SUPABASE_CONNECTION_STRING` if it exists.
    
    // Instead of forcing pooler address, let's just parse the actual database URL
    const pwd = process.env.SUPABASE_DB_PASSWORD;
    // We can also try the ipv6 host if pooler is broken: db.qntpnyhwnhngkicxozss.supabase.co
    const connectionString = process.env.DATABASE_URL || `postgres://postgres.qntpnyhwnhngkicxozss:${pwd}@db.qntpnyhwnhngkicxozss.supabase.co:5432/postgres`;
    
    console.log("Using Host: db.qntpnyhwnhngkicxozss.supabase.co");
    
    const client = new Client({ connectionString });
    await client.connect();
    console.log("Connected Successfully to native IPv6 host.");
    await client.query(rawSql);
    console.log("DDL Injected.");
    await client.end();
  } catch(e) {
    console.error("Deploy failed:", e);
  }
}

deployFix();
