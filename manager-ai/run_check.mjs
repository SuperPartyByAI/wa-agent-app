import pg from 'pg';
const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const pool = new pg.Pool({ connectionString });
async function run() {
  try {
    const res = await pool.query("SELECT * FROM ai_client_notebooks;");
    console.log("Notebooks:", JSON.stringify(res.rows, null, 2));
  } catch (e) { console.error(e); } finally { pool.end(); }
}
run();
