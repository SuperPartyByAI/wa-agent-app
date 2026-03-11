require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function findRealClientConversation() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); const todayIso = today.toISOString();

  // Find conversations updated today
  const { data: convs, error: convErr } = await supabase
    .from('conversations')
    .select('id, client_id, session_id, updated_at')
    .gte('updated_at', todayIso);

  if (convErr) return console.error(convErr);
  
  const convIds = convs.map(c => c.id);
  console.log(`Found ${convIds.length} conversations updated today.`);
  
  // Find messages for these conversations
  const { data: msgs, error: msgErr } = await supabase
    .from('messages')
    .select('conversation_id, content, created_at, direction, sender_type')
    .in('conversation_id', convIds)
    .gte('created_at', todayIso)
    .order('created_at', { ascending: false });

  if (msgErr) return console.error(msgErr);

  const grouped = {};
  for (const m of msgs) {
    if (!grouped[m.conversation_id]) grouped[m.conversation_id] = { inbound: 0, outbound: 0, msgs: [] };
    grouped[m.conversation_id].msgs.push(m);
    if (m.direction === 'inbound') grouped[m.conversation_id].inbound++;
    if (m.direction === 'outbound' || m.sender_type === 'agent') grouped[m.conversation_id].outbound++;
  }

  // Real client conversations likely have both inbound and outbound
  for (const cId in grouped) {
    const stats = grouped[cId];
    if (stats.outbound > 0 && stats.inbound > 0) {
      console.log(`\n[REAL CLIENT SUSPECT] ConvID: ${cId} | Inbound today: ${stats.inbound} | Outbound today: ${stats.outbound}`);
      const latest = stats.msgs[0];
      console.log(` -> Last Msg: [${latest.direction}] ${latest.content.substring(0, 50)}`);
      
      const { data: vInfo } = await supabase.from('v_inbox_summaries').select('conversation_id, last_message_content').eq('conversation_id', cId).single();
      if (vInfo) {
         console.log(` -> In View: YES, content: ${vInfo.last_message_content.substring(0, 50)}`);
      } else {
         console.log(` -> In View: NO! THIS MIGHT BE IT!`);
      }
    }
  }
}

findRealClientConversation();
