import pg from 'pg';
const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const pool = new pg.Pool({ connectionString });
async function run() {
  try {
    const res = await pool.query("SELECT key, name FROM ai_notebook_templates;");
    console.log("Templates:", JSON.stringify(res.rows, null, 2));
    
    // Auto-fix the key if text_animator exists but template_animator doesn't
    const hasTest = res.rows.some(r => r.key === 'test_animator');
    const hasTemplate = res.rows.some(r => r.key === 'template_animator');
    if (hasTest && !hasTemplate) {
      await pool.query("UPDATE ai_notebook_templates SET key='template_animator' WHERE key='test_animator';");
      console.log("Fixed 'test_animator' -> 'template_animator'");
    }
  } catch (e) { console.error(e); } finally { pool.end(); }
}
run();
