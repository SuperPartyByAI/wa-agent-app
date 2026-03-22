require('dotenv').config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data, error } = await supabase.from('vertex_config').select('*').eq('config_key', 'system_prompt').single();
    if (error) console.error(error);
    else console.log("\n--- AI SYSTEM PROMPT ---\n" + data.config_value + "\n------------------------\n");
}
run();
