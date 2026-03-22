import pg from 'pg';
const { Client } = pg;
const urls = [
  'postgresql://postgres.yvfhqadfmjgbzetanfxs:Andrei209512%21@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.yvfhqadfmjgbzetanfxs:SupabaseAI123!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.yvfhqadfmjgbzetanfxs:8sOefnJz7mAx1hgYa3DW6CaoWTleXfZUD4mFNV80A0@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.yvfhqadfmjgbzetanfxs:SupabaseAI123%21@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
];

async function run() {
    for(let url of urls) {
        console.log("Trying:", url.replace(/:[^:@]+@/, ':***@'));
        const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }  });
        try {
            await client.connect();
            console.log("--> WORKED: " + url.replace(/:[^:@]+@/, ':***@'));
            await client.end();
            return;
        } catch(e) {
            console.error("FAIL:", e.message);
        }
    }
}
run();
