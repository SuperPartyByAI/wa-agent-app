import pg from 'pg';
const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const pool = new pg.Pool({ connectionString });
async function run() {
  try {
    const data = {
      "locatie": "La locul de joaca Gymboland",
      "data": "Azi la 16:00",
      "numele_copilului_si_genul": "David, Baietel, 5 ani"
    };
    await pool.query(
      `INSERT INTO ai_client_notebooks (phone_number, template_key, extracted_data) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (phone_number, template_key) DO UPDATE SET extracted_data = EXCLUDED.extracted_data;`,
      ['+40700000000', 'template_animator', JSON.stringify(data)]
    );
    console.log("Inserted fake lead!");
  } catch (e) { console.error(e); } finally { pool.end(); }
}
run();
