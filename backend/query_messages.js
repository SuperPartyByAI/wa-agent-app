const supabase = require('./supabase');

async function checkLatestMessages() {
    console.log("Checking latest messages...");
    
    const { data: msgs, error: err } = await supabase
        .from('messages')
        .select('id, created_at, content, conversation_id, conversations(client_id)')
        .order('created_at', { ascending: false })
        .limit(3);
        
    if (err) {
        console.error("Query Error:", err);
        return;
    }
    
    for (const msg of msgs) {
        console.log(`\nMsg: ${msg.content} at ${msg.created_at}`);
        if(msg.conversations && msg.conversations.client_id) {
            const cid = msg.conversations.client_id;
            const { data: pd } = await supabase.from('clients').select('full_name, real_phone_e164, avatar_url').eq('id', cid).single();
            const { data: ld } = await supabase.from('client_identity_links').select('identifier_value, identifier_type').eq('client_id', cid);
            console.log(`  Client: ${pd ? pd.full_name : cid} | Canonical: ${pd?.real_phone_e164}`);
            console.log(`  Links: ${JSON.stringify(ld)}`);
        }
    }
}

checkLatestMessages().then(() => process.exit(0)).catch(console.error);
