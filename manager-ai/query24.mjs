import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/superparty-manager-ai/.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
console.log("Using URL:", SUPABASE_URL);

const s = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    const { data: clients } = await s.from('clients')
        .select('id, full_name, public_alias')
        .eq('public_alias', 'Superparty-24');
    
    if (clients && clients.length > 0) {
        const cId = clients[0].id;
        console.log(`Found Superparty-24 with ID: ${cId}`);
        const { data: convs } = await s.from('conversations')
             .select('id, last_message_at, updated_at')
             .eq('client_id', cId);
        console.log(`Convs for Superparty-24:`, convs);
        
        const { data: msgs } = await s.from('messages')
             .select('id, created_at, content')
             .eq('conversation_id', convs[0].id)
             .order('created_at', { ascending: false })
             .limit(3);
        console.log(`Top msgs for Superparty-24:`, msgs);
    } else {
        console.log("Superparty-24 not found.");
    }
}
run();
