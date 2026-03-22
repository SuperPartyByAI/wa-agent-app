import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function findConv() {
  const phone = '40737571397';
  
  // 1. Find the client IDs associated with this phone
  const { data: links } = await supabase.from('client_identity_links').select('client_id').like('identifier_value', `%${phone}%`);
  const clientIds = [...new Set(links.map(l => l.client_id))];
  
  // 2. Find the most recently updated conversation for these clients
  const { data: conv } = await supabase.from('conversations')
    .select('id, updated_at')
    .in('client_id', clientIds)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
    
  console.log('Proper Conv ID for Wowparty-05:', conv.id);
  
  // 3. Fetch the last 3 REAL messages
  const { data: msgs } = await supabase.from('messages')
    .select('content, created_at, sender_type')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log('Last 3 REAL messages:', msgs);

  // 4. Fetch the last 3 SHADOW messages
  const { data: shadowMsgs } = await supabase.from('ai_training_messages')
    .select('content, created_at, sender_type')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(3);
    
  console.log('Last 3 SHADOW messages:', shadowMsgs);
}

findConv();
