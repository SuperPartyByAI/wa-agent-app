import pg from 'pg';
const { Client } = pg;
const urls = [
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:SupabaseAI123!@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
  'postgresql://postgres.jrfhprnuxxfwkwjwdsez:SupabaseAI123!@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
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
