import pg from 'pg';
const { Client } = pg;
async function run() {
    console.log("Connecting to Supabase pooler...");
    const client = new Client({ 
        connectionString: 'postgresql://postgres.jrfhprnuxxfwkwjwdsez:Andrei2095120@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
        ssl: { rejectUnauthorized: false }
    });
    try {
        await client.connect();
        await client.query("NOTIFY pgrst, 'reload schema';");
        console.log("[SUCCESS] Schema flushed successfully!");
    } catch(e) {
        console.error("Connection error:", e);
    } finally {
        await client.end();
    }
}
run();
