const supabase = require('./supabase');

const sessionBrandCache = new Map();

async function getSessionBrandParams(sessionId) {
    if (sessionBrandCache.has(sessionId)) return sessionBrandCache.get(sessionId);

    const { data } = await supabase.from('whatsapp_sessions').select('label, brand_key, alias_prefix').eq('session_key', sessionId).limit(1).maybeSingle();
    
    if (data && (data.label || data.brand_key)) {
        let label = data.label ? data.label.trim() : sessionId;
        let brandKey = data.brand_key ? data.brand_key : label.toUpperCase().replace(/\s+/g, '_');
        let aliasPrefix = data.alias_prefix ? data.alias_prefix : label.split(' ')[0];
        
        const params = { label, brandKey, aliasPrefix };
        sessionBrandCache.set(sessionId, params);
        return params;
    }

    // Structural Fallback for initially unlabelled sessions
    // Do NOT cache this, allowing automatic recovery once the session gets a human label
    const safeSuffix = sessionId.replace('wa_', '').substring(0, 6).toUpperCase();
    return {
        label: `QR-${safeSuffix}`,
        brandKey: `SESSION_${safeSuffix}`,
        aliasPrefix: `QR-${safeSuffix}`
    };
}

/**
 * Normalizes inputs and handles identity creation / alias mapping.
 * Avoids any unique constraint violations organically via recursive loops and PostgREST Native OUT maps.
 */
async function resolveClientIdentity(phoneOrWaIdentifier, sessionId, altWaIdentifier = null) {
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

    if (altWaIdentifier && altWaIdentifier.includes('@s.whatsapp.net')) {
        const altPhone = altWaIdentifier.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('+', '');
        identifiers.push({ type: 'msisdn', value: altPhone });
        identifiers.push({ type: 'jid', value: `${altPhone}@s.whatsapp.net` });
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

    if (linkData && linkData.clients) {
        const clientId = linkData.client_id;
        const upsertPayload = identifiers.map(i => ({
            client_id: clientId,
            brand_key: brandParams.brandKey,
            identifier_type: i.type,
            identifier_value: i.value
        }));
        
        // Asynchronously bind any missing aliases (like MSISDN if it just appeared from remoteJidAlt)
        supabase.from('client_identity_links').upsert(upsertPayload, { onConflict: 'brand_key,identifier_value', ignoreDuplicates: true }).then(() => {
            const { updateClientRealPhoneGraph } = require('./pii');
            updateClientRealPhoneGraph(clientId).catch(() => {});
        });

        return linkData.clients;
    }

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
        const client = Array.isArray(clientData) ? clientData[0] : clientData;
        
        if (client && client.id) {
            const { updateClientRealPhoneGraph } = require('./pii');
            setTimeout(() => {
                updateClientRealPhoneGraph(client.id).catch(() => {});
            }, 0);
        }

        return client;

    } catch (allocError) {
        console.error(`[resolveClientIdentity] Atomic Router failed for ${phoneOrWaIdentifier}:`, allocError);
        throw allocError;
    }
}

module.exports = {
    resolveClientIdentity,
    getSessionBrandParams,
    sessionBrandCache
};
