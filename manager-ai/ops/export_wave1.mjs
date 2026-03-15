import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ts = Date.now();

async function exportData() {
    console.log("Starting exports for Wave 1 Canary (Node.js version)...");

    // Query 1: last 200 change logs
    let { data: changeLog } = await supabase
        .from('ai_event_change_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
    fs.writeFileSync(`change_log_${ts}.json`, JSON.stringify(changeLog || [], null, 2));
    console.log(`Exported change_log_${ts}.json (${changeLog?.length || 0} rows)`);

    // Query 2: recently modified events
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    let { data: eventsRecent } = await supabase
        .from('ai_client_events')
        .select('*')
        .gt('updated_at', twoHoursAgo);
    fs.writeFileSync(`events_recent_${ts}.json`, JSON.stringify(eventsRecent || [], null, 2));
    console.log(`Exported events_recent_${ts}.json (${eventsRecent?.length || 0} rows)`);

    // Query 3: reply decisions
    let { data: replyDecisions } = await supabase
        .from('ai_reply_decisions')
        .select('*')
        .gt('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(200);
    fs.writeFileSync(`reply_decisions_${ts}.json`, JSON.stringify(replyDecisions || [], null, 2));
    console.log(`Exported reply_decisions_${ts}.json (${replyDecisions?.length || 0} rows)`);

    // Sample conversations
    let convIds = [...new Set((changeLog || []).map(r => r.conversation_id).filter(id => id))];
    if (convIds.length === 0) {
        convIds = [...new Set((replyDecisions || []).map(r => r.conversation_id).filter(id => id))];
    }
    
    // Fallback if no conversation_ids found on recent rows
    if (convIds.length === 0) {
        console.log("No conversations found, skipping samples.");
    }

    const sampleIds = convIds.slice(0, 3);
    for (const convId of sampleIds) {
        let { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
        fs.writeFileSync(`conv_${convId}_messages.json`, JSON.stringify(msgs || [], null, 2));
        
        let { data: evLogs } = await supabase.from('ai_event_change_log').select('*').eq('conversation_id', convId).order('created_at');
        fs.writeFileSync(`conv_${convId}_changelog.json`, JSON.stringify(evLogs || [], null, 2));
        console.log(`Exported samples for conv ${convId}`);
    }

    console.log("Exports completed.");
}

exportData().catch(e => {
    console.error(e);
    process.exit(1);
});
