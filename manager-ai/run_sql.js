import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

async function run() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  });
  await client.connect();
  const sql = fs.readFileSync(process.argv[2], 'utf8');
  await client.query(sql);
  console.log("Migration applied successfully.");
  await client.end();
}
run().catch(console.error);
