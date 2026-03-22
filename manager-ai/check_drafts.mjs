import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });

const mainDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const vertexDb = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("--- RECENT EVENT DRAFTS (CRM DB) ---");
    const { data: drafts } = await mainDb.from('ai_event_drafts').select('id, draft_type, structured_data_json, created_at, updated_at').order('updated_at', {ascending: false}).limit(5);
    console.log(JSON.stringify(drafts, null, 2));

    console.log("\n--- RECENT AI ACTIONS (VERTEX DB) ---");
    const { data: logs, error } = await vertexDb.from('vertex_action_logs').select('*').limit(5);
    const { data: msgs } = await vertexDb.from('vertex_messages').select('role, content, created_at').order('created_at', {ascending: false}).limit(5);
    console.log("\n--- RECENT AI MESSAGES ---\n", JSON.stringify(msgs, null, 2));
}
run();
