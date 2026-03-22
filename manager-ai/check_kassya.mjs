import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    try {
        const { data: profs, error: profErr } = await supabase
            .from('clients')
            .select('id, full_name, public_alias')
            .eq('full_name', 'Kassya-8');
        if (profErr) { console.error("Profile error", profErr); return; }
        if (!profs || profs.length === 0) { console.log("No Kassya found"); return; }
        console.log("Found profile:", profs);
        const clientId = profs[0].id;
        const { data: convs, error: convErr } = await supabase
            .from('conversations')
            .select('id')
            .eq('client_id', clientId);
            
        if (convErr) {
            console.error("Error finding conversation:", convErr);
            return;
        }
        
        console.log("Found conversations:", convs);
        if (!convs || convs.length === 0) return;
        const convId = convs[0].id;
        const { data: msgs, error: msgErr } = await supabase
            .from('messages')
            .select('content, sender_type')
            .eq('conversation_id', convId);
            
        if (msgErr) {
            console.error("Error finding messages:", msgErr);
            return;
        }

        let totalChars = 0;
        msgs.forEach(m => {
            totalChars += (m.content || '').length;
        });

        const totalTokens = Math.ceil(totalChars / 4);
        const costUSD = (totalTokens / 1000000) * 0.075;
        const costRON = costUSD * 4.6; // approx exchange rate
        
        console.log("-----------------------------------------");
        console.log(`Client: ${profs[0].full_name || profs[0].public_alias}`);
        console.log(`Total messages in history: ${msgs.length}`);
        console.log(`Total characters: ${totalChars}`);
        console.log(`Estimated Tokens (approx): ${totalTokens}`);
        console.log(`Cost in USD for this conversation: $${costUSD.toFixed(6)}`);
        console.log(`Cost in RON for this conversation: ${costRON.toFixed(6)} RON`);
        console.log("-----------------------------------------");
        
    } catch (e) {
        console.error("Exception:", e);
    }
}
check();
