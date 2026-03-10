const { Client } = require('pg');
require("dotenv").config();

const URIs = process.env.SUPABASE_CONNECTION_STRING ? [process.env.SUPABASE_CONNECTION_STRING] : [];

async function run() {
  for(let u of URIs) {
    const c = new Client({ connectionString: u, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try {
      console.log('Trying -> ' + u.split('@')[1]);
      await c.connect();
      console.log('SUCCESS!');
      await c.query('ALTER TABLE public.whatsapp_sessions DISABLE ROW LEVEL SECURITY;');
      console.log('RLS disabled!');
      await c.end();
      return; // Stop on success
    } catch(e) {
      console.log('FAIL: ' + e.message);
    }
  }
}
run();
