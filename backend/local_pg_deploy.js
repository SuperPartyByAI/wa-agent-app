require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

async function deployFix() {
  const pwd = process.env.SUPABASE_DB_PASSWORD;
  const connectionString = `postgres://postgres.qntpnyhwnhngkicxozss:${pwd}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }  });
  
  try {
    const rawSql = fs.readFileSync('/Users/universparty/wa-web-launcher/wa-agent-app/backend/sql_migrations/202603110001_client_creation_deadlock_fix.sql', 'utf8');
    
    await client.connect();
    console.log("Connected to PG Direct on 5432 Locally. Deploying hotfix...");
    await client.query(rawSql);
    console.log("Deployment Successful. The Pl/PgSQL block has been overwritten.");
    
  } catch(e) {
    console.error("FATAL PG ERROR: ", e.message);
  } finally {
    await client.end();
  }
}

deployFix();
