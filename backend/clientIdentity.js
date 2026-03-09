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
        const { data: aliasData, error: rpcErr } = await supabase.rpc('reserve_brand_alias', { p_brand_key: brandParams.brandKey, p_alias_prefix: brandParams.aliasPrefix });
        if (rpcErr) throw rpcErr;

        // AliasData contains explicit OUT variables => { idx, alias, internal_code }
        const insertPayload = {
            full_name: aliasData.alias, // Keep legacy UI mapped
            source: 'whatsapp',
            brand_key: brandParams.brandKey,
            public_alias: aliasData.alias,
            internal_client_code: aliasData.internal_code,
            alias_index: aliasData.idx
        };
        
        if (isLid) insertPayload.wa_identifier = waIdentifier;
        if (phone) insertPayload.phone = phone;

        const { data: newClient, error: insertErr } = await supabase.from('clients').insert(insertPayload).select('id, avatar_url, public_alias').maybeSingle();
        if (insertErr) {
            // Expected Unique Constraint hit if 2 messages from same user land concurrently
            if (insertErr.code === '23505') {
                let recoveryQuery = supabase.from('clients').select('id, avatar_url, public_alias').eq('brand_key', brandParams.brandKey);
                if (isLid) recoveryQuery = recoveryQuery.eq('wa_identifier', waIdentifier);
                else recoveryQuery = recoveryQuery.eq('phone', phone);
                
                const { data: recoveredClient } = await recoveryQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
                if (recoveredClient) return recoveredClient;
            }
            throw insertErr;
        }

        return newClient;

    } catch (allocError) {
        console.error(`[resolveClientIdentity] Atomic Router failed for ${phoneOrWaIdentifier}:`, allocError);
        throw allocError;
    }
}

module.exports = {
    resolveClientIdentity,
    getSessionBrandParams
};
