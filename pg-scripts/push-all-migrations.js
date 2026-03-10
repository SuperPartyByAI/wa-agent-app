const { Client } = require("pg");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const URIs = process.env.SUPABASE_CONNECTION_STRING ? [process.env.SUPABASE_CONNECTION_STRING] : [];

async function run() {
    let client = null;
    
    for (let u of URIs) {
        console.log("Trying", u.split('@')[1], "...");
        client = new Client({ connectionString: u, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
        try {
            await client.connect();
            console.log("SUCCESSFULLY CONNECTED");
            break;
        } catch(e) {
            console.log("FAIL:", e.message);
            client = null;
        }
    }
    
    if (!client) {
        console.error("All connection strings failed.");
        return;
    }
    
    const migs = [
        "202603090001_client_alias_privacy.sql",
        "202603090002_client_alias_hardening.sql",
        "202603090003_zero_trust_rls_exposure.sql",
        "202603100001_client_identity_links.sql",
        "202603100002_auto_merge_fk_completeness.sql",
        "202603100003_inbox_message_previews.sql"
    ];
    
    const dir = path.join(__dirname, "..", "supabase", "migrations");
    
    for (const m of migs) {
        console.log("Applying", m, "...");
        const sql = fs.readFileSync(path.join(dir, m), "utf8");
        try {
            await client.query(sql);
            console.log("SUCCESS:", m);
        } catch (e) {
            console.error("ERROR in", m, ":", e.message);
            break; 
        }
    }
    await client.end();
}
run().catch(console.error);
