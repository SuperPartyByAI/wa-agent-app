import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

// The connection string from the Supabase dashboard
const connectionString = process.env.DATABASE_URL || process.env.PG_URL || "postgres://postgres.yfxrtkchjpskqbksfmyz:SupabaseAI123!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

async function runSQL() {
  console.log("Connecting directly to PostgreSQL...");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected!");
    
    // Read the query
    const sql = fs.readFileSync('wipe_tests.sql', 'utf8');
    
    console.log("Executing cascading wipe script...");
    await client.query(sql);
    
    console.log("✅ All test clients and their related data have been completely wiped.");
  } catch (err) {
    console.error("❌ SQL Execution Error:", err);
  } finally {
    await client.end();
  }
}

runSQL();
