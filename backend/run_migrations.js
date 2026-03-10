require("dotenv").config({ path: "/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env" });
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

async function run() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("Missing SUPABASE_DB_URL in your .env file!");
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log("Connected to Supabase Postgres Engine via pg driver.");

    const migration5 = fs.readFileSync("/Users/universparty/wa-web-launcher/wa-agent-app/supabase/migrations/202603100005_whatsapp_media_columns.sql", "utf8");
    console.log("Applying Migration 0005 (Media)...");
    await client.query(migration5);
    console.log("Migration 0005 applied successfully.");

    const migration7 = fs.readFileSync("/Users/universparty/wa-web-launcher/wa-agent-app/supabase/migrations/202603100007_message_contact_columns.sql", "utf8");
    console.log("Applying Migration 0007 (Contact VCard)...");
    await client.query(migration7);
    console.log("Migration 0007 applied successfully.");

  } catch (err) {
    console.error("Database schema patch error:", err);
  } finally {
    await client.end();
  }
}

run();
