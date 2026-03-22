import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data, error } = await s.from('conversations')
      .select('id, client_id, messages(created_at)')
      .limit(1, { foreignTable: 'messages' })
      .order('created_at', { foreignTable: 'messages', ascending: false })
      .limit(10);
    console.log(JSON.stringify(data, null, 2), error);
}
run();
