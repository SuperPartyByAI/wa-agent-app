require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase Env Variables. Please run with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const sessionLabelCache = {};

async function getBrandInfo(sessionId) {
   if (!sessionId) return { label: 'Unknown', key: 'UNKNOWN' };
   if (sessionLabelCache[sessionId]) return sessionLabelCache[sessionId];
   
   const { data } = await supabase.from('whatsapp_sessions').select('label').eq('session_key', sessionId).limit(1).maybeSingle();
   const label = (data && data.label) ? data.label : 'Agent';
   const key = label.trim().toUpperCase().replace(/\s+/g, '_');
   
   sessionLabelCache[sessionId] = { label, key };
   return sessionLabelCache[sessionId];
}

async function migrate() {
    console.log("Starting Retroactive Brand Aliasing Migration...");

    // 1. Fetch all clients that have not been aliased yet
    const { data: clients, error: fetchErr } = await supabase.from('clients').select('id, wa_identifier, phone, full_name').is('public_alias', null);
    
    if (fetchErr) {
        console.error("Failed to fetch clients:", fetchErr.message);
        return;
    }
    
    console.log(`Found ${clients.length} legacy clients requiring Brand Aliases.`);

    for (const client of clients) {
        try {
            // 2. Determine their origin brand by looking at their earliest conversation
            const { data: convs } = await supabase.from('conversations')
                .select('session_id')
                .eq('client_id', client.id)
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();
            
            const sessionId = convs ? convs.session_id : null;
            const brandInfo = await getBrandInfo(sessionId);

            // 3. Obtain the next available safe integer index for this brand
            // Since we call the RPC, we respect the Postgres atomic locking guaranteeing safety across the node and the migration worker!
            const { data: nextIdxData, error: rpcErr } = await supabase.rpc('get_next_brand_alias_index', { p_brand_key: brandInfo.key });
            
            if (rpcErr) throw rpcErr;
            
            let nextIdx = nextIdxData !== null ? nextIdxData : 1;
            
            // 4. Generate persistent public identifiers
            const internalCode = `CL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            const publicAlias = `${brandInfo.label}-${nextIdx.toString().padStart(2, '0')}`;

            console.log(`Migrating Client [${client.id}] -> Brand: ${brandInfo.key} | Alias: ${publicAlias}`);

            // 5. Hardcode the structural transformation in Supabase
            const { error: updateErr } = await supabase.from('clients').update({
                public_alias: publicAlias,
                internal_client_code: internalCode,
                brand_key: brandInfo.key,
                alias_index: nextIdx,
                // Optional: Maintain historical source of truth in full_name if empty
                full_name: client.full_name && !client.full_name.includes('WAC-') ? client.full_name : publicAlias
            }).eq('id', client.id);

            if (updateErr) throw updateErr;

        } catch (err) {
            console.error(`Failed to migrate client ${client.id}:`, err.message);
        }
    }

    console.log("Migration Successfully Concluded.");
}

migrate();
