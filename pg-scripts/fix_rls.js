const { Client } = require('pg');

const URIs = [
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@jrfhprnuxxfwkwjwdsez.pooler.supabase.com:6543/postgres',
  'postgresql://postgres:Andrei2095120@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres:Andrei2095120@db.jrfhprnuxxfwkwjwdsez.supabase.co:6543/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@db.jrfhprnuxxfwkwjwdsez.supabase.co:6543/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'
];

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
