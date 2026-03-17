import pg from 'pg';
import fs from 'fs';

const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const pool = new pg.Pool({ connectionString });

async function run() {
  try {
    const sql = fs.readFileSync('./docs/migrations/011_notebook_storage.sql', 'utf8');
    const res = await pool.query(sql);
    console.log("Migration 011 applied successfully!");
  } catch (err) {
    console.error("Failed to apply migration:", err);
  } finally {
    await pool.end();
  }
}
run();
