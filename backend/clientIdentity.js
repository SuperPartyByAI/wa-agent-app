const supabase = require('./supabase');

const sessionBrandCache = new Map();

async function getSessionBrandParams(sessionId) {
    if (sessionBrandCache.has(sessionId)) return sessionBrandCache.get(sessionId);

    const { data } = await supabase.from('whatsapp_sessions').select('label, brand_key, alias_prefix').eq('session_key', sessionId).limit(1).maybeSingle();
    let label = (data && data.label) ? data.label.trim() : 'Unknown';
    let brandKey = (data && data.brand_key) ? data.brand_key : label.toUpperCase().replace(/\s+/g, '_');
    let aliasPrefix = (data && data.alias_prefix) ? data.alias_prefix : label.split(' ')[0];

    const params = { label, brandKey, aliasPrefix };
    sessionBrandCache.set(sessionId, params);
    return params;
}

/**
 * Normalizes inputs and handles identity creation / alias mapping.
 * Avoids any unique constraint violations organically via recursive loops and PostgREST Native OUT maps.
 */
async function resolveClientIdentity(phoneOrWaIdentifier, sessionId) {
    const isLid = phoneOrWaIdentifier.includes('@lid');
    const isGroup = phoneOrWaIdentifier.includes('@g.us');
    
    let identifiers = [];

    if (isLid) {
        identifiers.push({ type: 'lid', value: phoneOrWaIdentifier });
    } else if (isGroup) {
        identifiers.push({ type: 'group_jid', value: phoneOrWaIdentifier });
    } else {
        // Extract raw deterministic numeric MSISDN string
        const phone = phoneOrWaIdentifier.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('+', '');
        identifiers.push({ type: 'msisdn', value: phone });
        // Extrapolate official WhatsApp JID to guarantee symmetrical SQL Database Locking across fragmented endpoints
        identifiers.push({ type: 'jid', value: `${phone}@s.whatsapp.net` });
    }

    const brandParams = await getSessionBrandParams(sessionId);

    // Initial Lookup via Normalized Identity Links
    const { data: linkData } = await supabase
        .from('client_identity_links')
        .select('client_id, clients!inner(id, avatar_url, public_alias)')
        .eq('brand_key', brandParams.brandKey)
        .in('identifier_value', identifiers.map(i => i.value))
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (linkData && linkData.clients) return linkData.clients;

    // Creation or Split-Brain Auto-Merge Attempt via Atomic SQL Engine
    try {
        const rpcPayload = {
            p_brand_key: brandParams.brandKey,
            p_alias_prefix: brandParams.aliasPrefix,
            p_identifiers: identifiers,
            p_source: 'whatsapp'
        };

        // This RPC executes the entire lookup -> merge check -> insert sequence atomically natively in Postgres
        // It catches standard unique_violations (code 23505) and loops internally until physical legitimately-bounded completion.
        const { data: clientData, error: rpcErr } = await supabase.rpc('create_client_identity_safe', rpcPayload);
        
        if (rpcErr) throw rpcErr;
        
        // Supabase RPCs returning TABLE resolve as an array of rows
        return Array.isArray(clientData) ? clientData[0] : clientData;

    } catch (allocError) {
        console.error(`[resolveClientIdentity] Atomic Router failed for ${phoneOrWaIdentifier}:`, allocError);
        throw allocError;
    }
}

module.exports = {
    resolveClientIdentity,
    getSessionBrandParams
};
