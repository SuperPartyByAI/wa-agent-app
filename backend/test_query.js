const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env" });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, status, messages(content, created_at, from_me)")
    .order("created_at", { foreignTable: "messages", ascending: false })
    .limit(1, { foreignTable: "messages" })
    .limit(5);
    
  if (error) console.error("Error:", error);
  else console.log(JSON.stringify(data[0], null, 2));
}
run();
