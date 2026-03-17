import pg from 'pg';
const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const pool = new pg.Pool({ connectionString });
async function run() {
  try {
    const data = {
      "locatie": "Acasa la client (Bucuresti Sector 1)",
      "data": "Sambata viitoare, ora 12",
      "numele_copilului_si_genul": "David, baietel care implineste 5 ani"
    };
    await pool.query(
      `INSERT INTO ai_client_notebooks (phone_number, template_key, extracted_data) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (phone_number, template_key) DO UPDATE SET extracted_data = EXCLUDED.extracted_data;`,
      ['+407TEST_NOTEBOOK', 'template_animator', JSON.stringify(data)]
    );
    console.log("Inserted secondary fake lead to trigger UI!");
  } catch (e) { console.error(e); } finally { pool.end(); }
}
run();
