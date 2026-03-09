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
    const isLid = phoneOrWaIdentifier.includes('@lid') || phoneOrWaIdentifier.includes('@g.us');
    const waIdentifier = isLid ? phoneOrWaIdentifier : null;
    const phone = !isLid ? phoneOrWaIdentifier : null;

    const brandParams = await getSessionBrandParams(sessionId);

    // Initial Lookup
    let query = supabase.from('clients').select('id, avatar_url, public_alias').eq('brand_key', brandParams.brandKey);
    if (isLid) query = query.eq('wa_identifier', waIdentifier);
    else query = query.eq('phone', phone);
    
    let { data: existingClient } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (existingClient) return existingClient;

    // Creation Attempt via Atomic RPG Logic
    try {
        const rpcPayload = {
            p_brand_key: brandParams.brandKey,
            p_alias_prefix: brandParams.aliasPrefix,
            p_phone: phone,
            p_wa_identifier: waIdentifier,
            p_source: 'whatsapp'
        };

        // This RPC executes the entire lookup -> alias reserve -> internal_code generation -> insert sequence atomically natively in Postgres
        // It catches standard unique_violations (code 23505) and loops internally until physical uniquely-bounded completion.
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
