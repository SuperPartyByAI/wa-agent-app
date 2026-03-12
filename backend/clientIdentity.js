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

/**
 * Rebases technical aliases (QR-* or Unknown-*) for all clients belonging to a specific session
 * when that session receives a human-readable label or brand key.
 * Now structurally handles sequential index allocation to avoid UNIQUE constraints.
 */
async function rebaseRouteAliases(sessionId, newLabel, newBrandKey, newAliasPrefix) {
    console.log(`[RebaseRoute] Started rebase for ${sessionId} -> Prefix: ${newAliasPrefix}, Brand: ${newBrandKey}`);
    
    // 1. Fetch conversations mapped to this route
    const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('client_id')
        .eq('session_id', sessionId)
        .limit(10000);
        
    if (convErr || !convs) return;
    
    const clientIds = [...new Set(convs.map(c => c.client_id))].filter(Boolean);
    if (clientIds.length === 0) return;

    // Detect the current sequence highest watermark for the target brand
    let currentMaxIndex = 0;
    const { data: maxIdxData } = await supabase.from('clients')
      .select('alias_index')
      .eq('brand_key', newBrandKey)
      .order('alias_index', { ascending: false })
      .limit(1);

    if (maxIdxData && maxIdxData.length > 0 && maxIdxData[0].alias_index) {
        currentMaxIndex = maxIdxData[0].alias_index;
    }

    // 2. Scan clients in batches
    for (let i = 0; i < clientIds.length; i += 100) {
        const batchIds = clientIds.slice(i, i + 100);
        const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, public_alias, brand_key')
            .in('id', batchIds);
            
        if (cErr || !clients) continue;
        
        for (const client of clients) {
            if (!client.public_alias) continue;

            // Only rebase if it's currently a technical fallback alias or on a different brand
            if (client.public_alias.startsWith('QR-') || client.public_alias.startsWith('Unknown') || client.brand_key === 'UNKNOWN' || client.brand_key !== newBrandKey) {
                currentMaxIndex++;
                const newAlias = `${newAliasPrefix}-${currentMaxIndex.toString().padStart(2, '0')}`;
                
                console.log(`[RebaseRoute] Rebasing client: ${client.id} | ${client.public_alias} -> ${newAlias} | Brand: ${newBrandKey} (Index: ${currentMaxIndex})`);
                
                await supabase.from('clients').update({
                    public_alias: newAlias,
                    brand_key: newBrandKey,
                    alias_index: currentMaxIndex
                }).eq('id', client.id);
                
                await supabase.from('client_identity_links').update({
                    brand_key: newBrandKey
                }).eq('client_id', client.id).neq('brand_key', newBrandKey);
                
                await supabase.from('brand_alias_counters').upsert({
                    brand_key: newBrandKey,
                    current_index: currentMaxIndex,
                    updated_at: new Date().toISOString()
                });
            }
        }
    }
}

module.exports = {
    resolveClientIdentity,
    getSessionBrandParams,
    rebaseRouteAliases,
    sessionBrandCache
};
