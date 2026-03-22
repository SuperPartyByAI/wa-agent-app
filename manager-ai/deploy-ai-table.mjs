import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
async function run() {
    const connectionString = 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei209512%21@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }  });
    try {
        await client.connect();
        console.log("[SUCCESS] Master connection established!");
        const sql = fs.readFileSync('docs/migrations/012_ai_training_messages.sql', 'utf8');
        await client.query(sql);
        console.log("[SUCCESS] SQL Schema 012 applied perfectly.");
        await client.query("NOTIFY pgrst, 'reload schema';");
        console.log("[SUCCESS] PostgREST schema cache forced reload.");
    } catch(e) {
        console.error("FAIL:", e);
    } finally {
        await client.end();
    }
}
run();
