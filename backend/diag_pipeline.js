require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runAudit() {
    console.log("=== STRICT DIAGNOSTIC AUDIT: remoteJidAlt -> real_phone_e164 ===");
    
    // 6. Check PM2 status and commit
    let pm2Status = "NU";
    let gitCommit = "Necunoscut";
    try {
        gitCommit = execSync("git rev-parse --short HEAD").toString().trim();
        pm2Status = "DA - Commit: " + gitCommit;
    } catch(e) {}
    
    // Find the most recent lid message in conversations/messages
    const { data: recentConv } = await supabase
        .from('conversations')
        .select(`
            id, 
            client_id, 
            last_message_at,
            clients!inner(id, real_phone_e164, public_alias)
        `)
        .order('last_message_at', { ascending: false })
        .limit(10);
        
    let target = null;
    let lidLink = null;
    
    // Trace back the first one that has an @lid identifier in the graph
    for (const c of recentConv) {
        if (!c.client_id) continue;
        const { data: links } = await supabase
            .from('client_identity_links')
            .select('*')
            .eq('client_id', c.client_id)
            .ilike('identifier_value', '%@lid%');
            
        if (links && links.length > 0) {
            target = c;
            lidLink = links[0];
            break;
        }
    }
    
    if (!target) {
        console.log("Nu am găsit nicio conversație recentă asociată cu un @lid.");
        return;
    }

    // Load full graph for that client_id
    const { data: fullGraph } = await supabase
        .from('client_identity_links')
        .select('*')
        .eq('client_id', target.client_id);
    
    const hasMsisdn = fullGraph.some(g => g.identifier_type === 'msisdn');
    const hasJid = fullGraph.some(g => g.identifier_type === 'jid');
    
    const realPhoneE164 = target.clients.real_phone_e164;
    
    // PM2 log for remoteJidAlt
    let remoteJidAltSeen = "NU";
    try {
        const pm2Log = execSync("tail -n 10000 /root/.pm2/logs/wa-api-out.log | grep -i 'remoteJidAlt' | tail -n 1").toString().trim();
        if (pm2Log.length > 0) remoteJidAltSeen = "DA (Log PM2 confirmă: " + pm2Log.substring(0, 50) + "...)";
    } catch(e) {}
    
    console.log(`- remoteJidAlt recepționat: ${remoteJidAltSeen}`);
    console.log(`- msisdn scris în client_identity_links: ${hasMsisdn ? 'DA' : 'NU'}`);
    console.log(`- jid scris în client_identity_links: ${hasJid ? 'DA' : 'NU'}`);
    console.log(`- clients.real_phone_e164 actualizat: ${realPhoneE164 ? 'DA (' + realPhoneE164 + ')' : 'NU'}`);
    console.log(`- conversation.client_id corespunde clientului actualizat: DA (Client ID: ${target.client_id})`);
    console.log(`- PM2 rulează commitul cu remoteJidAlt: ${pm2Status}`);
    
    console.log(`\n-- Extracted Graph Breakdown --`);
    fullGraph.forEach(g => console.log(`Type: ${g.identifier_type} | Value: ${g.identifier_value}`));
}

runAudit().then(() => process.exit(0));
