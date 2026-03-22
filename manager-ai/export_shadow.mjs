import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function formatLog() {
    // 1. Fetch top 5 recent conversations with real client messages
    const { data: convs } = await supabase
        .from('conversations')
        .select(`
            id,
            client_id
        `)
        .order('updated_at', { ascending: false })
        .limit(5);
        
    for (const conv of convs) {
        console.log(`\n\n======================================================`);
        console.log(`👤 CLIENT ID: ${conv.client_id}`);
        console.log(`======================================================`);
        
        const { data: shadow, error } = await supabase
            .from('ai_training_messages')
            .select('sender_type, content, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true });
            
        if (error || !shadow || shadow.length === 0) {
            console.log(`[Fara Date in Simulator - AI inca nu a vizitat acest client]`);
            continue;
        }
        
        for (const msg of shadow) {
            const time = new Date(msg.created_at).toLocaleTimeString();
            if (msg.sender_type === 'client') {
                console.log(`[${time}] 👱‍♂️ CLIENT: ${msg.content}`);
            } else {
                console.log(`[${time}] 🤖 SIMULATOR AI: \x1b[36m${msg.content}\x1b[0m`);
            }
        }
    }
}

formatLog();
