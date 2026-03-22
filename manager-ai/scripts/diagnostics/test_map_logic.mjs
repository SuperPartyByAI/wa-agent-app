import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const clientId = '0241236f-cd6d-4fa8-a7e1-6266c3e5d72f';

    const { data: convsR } = await supabase.from('conversations').select('id').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1);
    const convIds = convsR.map(c => c.id);

    const { data: msgs } = await supabase.from('messages')
        .select('id, conversation_id, content, sender_type, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(5);

    const { data: decisions } = await supabase.from('ai_reply_decisions')
        .select('suggested_reply, created_at, id, conversation_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(5);

    const decisionsMap = new Map();
    (decisions || []).forEach(d => {
        if (!decisionsMap.has(d.conversation_id)) decisionsMap.set(d.conversation_id, []);
        decisionsMap.get(d.conversation_id).push(d);
    });

    const messagesWithDecisions = msgs.map(m => {
        const conversationDecisions = decisionsMap.get(m.conversation_id) || [];
        const decision = conversationDecisions
            .filter(d => new Date(d.created_at) >= new Date(m.created_at))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
        
        return {
            content: m.content,
            msg_time: m.created_at,
            dec_time: decision?.created_at,
            ai_reply: decision?.suggested_reply?.substring(0, 30) || 'NULL'
        };
    });

    console.log(messagesWithDecisions);
}
run();
