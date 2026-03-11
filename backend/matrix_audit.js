require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function fullMatrixAudit() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); const todayIso = today.toISOString();

  // 1. Get all sessions
  const { data: sessions, error: sessErr } = await supabase.from('whatsapp_sessions').select('session_key, label, brand_key, alias_prefix, status');
  if (sessErr) { console.error(sessErr); return; }
  
  console.log(`--- SESSIONS MATRIX (${sessions.length} registered) ---`);
  const sessionMap = {};
  for (const s of sessions) {
    sessionMap[s.session_key] = s;
    console.log(`Session: ${s.session_key} | Label: ${s.label} | Status: ${s.status}`);
  }

  // 2. Get ALL outbound messages sent today
  const { data: msgs, error: msgErr } = await supabase
    .from('messages')
    .select('id, conversation_id, content, created_at, direction, sender_type')
    .or('direction.eq.outbound,sender_type.eq.agent')
    .gte('created_at', todayIso)
    .order('created_at', { ascending: false });

  if (msgErr) { console.error(msgErr); return; }
  
  const conversationGroups = {};
  for (const m of msgs) {
    if (!conversationGroups[m.conversation_id]) conversationGroups[m.conversation_id] = [];
    conversationGroups[m.conversation_id].push(m);
  }

  const convIds = Object.keys(conversationGroups);
  console.log(`\n--- FOUND ${convIds.length} HOST-DRIVEN CONVERSATIONS TODAY ---`);

  if(convIds.length === 0) return;

  // 3. Get raw conversation rows
  const { data: rawConvs, error: rawErr } = await supabase.from('conversations').select('id, status, session_id').in('id', convIds);
  const rawConvMap = {};
  rawConvs?.forEach(c => rawConvMap[c.id] = c);

  // 4. Get v_inbox_summaries rows
  const { data: viewRows, error: viewErr } = await supabase.from('v_inbox_summaries').select('*').in('conversation_id', convIds);
  const viewMap = {};
  viewRows?.forEach(v => viewMap[v.conversation_id] = v);

  // 5. Output Matrix
  console.log("\n--- FULL AUDIT MATRIX ---");
  console.log("FORMAT: [Conv_ID] | Sess | Alias | LastMsg | is_in_msgs | is_in_convs | is_in_view\n");
  
  for (const cId of convIds) {
    const raw = rawConvMap[cId];
    const vw = viewMap[cId];
    const msgsForC = conversationGroups[cId];
    const latestMsg = msgsForC[0]; // Already ordered DESC

    const sessStr = raw ? (sessionMap[raw.session_id]?.label || raw.session_id) : 'UNKNOWN';
    const aliasStr = vw ? (vw.public_alias || vw.full_name || 'NoName') : 'N/A';
    const contentStr = vw ? vw.last_message_content : latestMsg.content;
    const timeStr = vw ? vw.last_message_at : latestMsg.created_at;

    const inMsgs = msgsForC.length > 0 ? 'YES' : 'NO';
    const inConvs = raw ? 'YES' : 'NO';
    const inView = vw ? 'YES' : 'NO';

    console.log(`Conv: ${cId} | QR: ${sessStr} | Alias: ${aliasStr}`);
    console.log(` -> Msg: "${contentStr.substring(0,25)}..." @ ${timeStr}`);
    console.log(` -> Audit: in_msgs=${inMsgs} | in_convs=${inConvs} | in_view=${inView}`);
    console.log(` -> Is Host-Phone Generated (from_me=true in View): ${vw?.last_message_from_me === true ? 'YES' : 'NO'}\n`);
  }
}

fullMatrixAudit();
