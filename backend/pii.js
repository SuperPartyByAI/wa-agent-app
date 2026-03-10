const supabase = require('./supabase');

async function getClientGraphPhone(clientId) {
  try {
    // 1. Get direct links
    const { data: directLinks, error: linkErr } = await supabase
      .from('client_identity_links')
      .select('identifier_value, identifier_type')
      .eq('client_id', clientId);

    if (linkErr) throw linkErr;
    if (!directLinks || directLinks.length === 0) return null;

    const identifierValues = directLinks.map(l => l.identifier_value);

    // 2. Find siblings
    const { data: crossLinks } = await supabase
      .from('client_identity_links')
      .select('client_id')
      .in('identifier_value', identifierValues);

    const siblingClientIds = Array.from(new Set((crossLinks || []).map(l => l.client_id)));

    // 3. Get entire footprint
    const { data: entireFootprint } = await supabase
      .from('client_identity_links')
      .select('identifier_value, identifier_type')
      .in('client_id', siblingClientIds);

    const fullLinks = entireFootprint || [];
    let bestMatch = null;

    // Prioritize MSISDN -> 90
    let explicitMsisdn = fullLinks.find(l => l.identifier_type === 'msisdn');
    if (explicitMsisdn) {
      let finalNum = explicitMsisdn.identifier_value.replace('@s.whatsapp.net', '');
      if (!finalNum.startsWith('+')) finalNum = '+' + finalNum;
      return { e164: finalNum, source: 'msisdn', confidence: 90, siblingClientIds };
    }

    // Fallback JID -> 80
    let explicitJid = fullLinks.find(l => l.identifier_value.endsWith('@s.whatsapp.net'));
    if (explicitJid) {
       let finalNum = explicitJid.identifier_value.replace('@s.whatsapp.net', '');
       if (!finalNum.startsWith('+')) finalNum = '+' + finalNum;
       bestMatch = { e164: finalNum, source: 'jid', confidence: 80, siblingClientIds };
       return bestMatch;
    }

    // New Auto-Capture Rule: VCard / Contact Message -> 85
    if (!bestMatch) {
      const { data: contactMsgs } = await supabase
        .from('messages')
        .select('contact_vcard')
        .in('sender_id', (crossLinks || []).map(l => l.client_id).concat([clientId]))
        .eq('message_type', 'contact')
        .not('contact_vcard', 'is', null)
        .limit(5);

      if (contactMsgs && contactMsgs.length > 0) {
        for (let msg of contactMsgs) {
          const match = msg.contact_vcard.match(/waid=([0-9]+)/);
          if (match && match[1]) {
             let finalNum = match[1];
             if (!finalNum.startsWith('+')) finalNum = '+' + finalNum;
             return { e164: finalNum, source: 'contact_vcard', confidence: 85, siblingClientIds };
          }
        }
      }
    }

    // Fallback 3CX Call Events -> 70
    if (!bestMatch) {
      const { data: voiceCalls } = await supabase
        .from('call_events')
        .select('from_number, to_number, direction')
        .in('client_id', siblingClientIds)
        .limit(10);
        
      if (voiceCalls && voiceCalls.length > 0) {
        // Find the valid external number
        for (let call of voiceCalls) {
          let num = call.direction === 'inbound' ? call.from_number : call.to_number;
          if (num && num.length >= 10 && !num.startsWith('Queue')) {
            // Found a valid external number linked to this client
             if (!num.startsWith('+')) num = '+' + num;
             return { e164: num, source: '3cx_call_event', confidence: 70, siblingClientIds };
          }
        }
      }
    }

    return null;
  } catch (e) {
    console.error(`[PII Resolver] Graph Error: ${e.message}`);
    return null;
  }
}

async function updateClientRealPhoneGraph(clientId) {
  try {
    // 1. Check if client already has a manual admin override (confidence = 100)
    const { data: currentClient } = await supabase
      .from('clients')
      .select('id, real_phone_confidence')
      .eq('id', clientId)
      .single();
      
    if (!currentClient || currentClient.real_phone_confidence === 100) {
      return; // Do not overwrite manual admin
    }

    // 2. Calculate best graph phone
    const bestMatch = await getClientGraphPhone(clientId);
    if (!bestMatch) return;

    // 3. Update if new confidence is better or equal, applying to the ALL siblings in the graph!
    if (bestMatch.confidence >= (currentClient.real_phone_confidence || 0)) {
      const targetIds = bestMatch.siblingClientIds && bestMatch.siblingClientIds.length > 0 
        ? bestMatch.siblingClientIds 
        : [clientId];
        
      await supabase
        .from('clients')
        .update({
          real_phone_e164: bestMatch.e164,
          real_phone_source: bestMatch.source,
          real_phone_confidence: bestMatch.confidence,
          real_phone_updated_at: new Date().toISOString()
        })
        .in('id', targetIds);
        
      console.log(`[PII Auto-Capture] Graph Synchronized! Updated clones [${targetIds.join(',')}] to canonical ${bestMatch.e164} (Source Deducer: ${bestMatch.source})`);
    }
  } catch(e) {
    console.error(`[PII Sync Error] ${e.message}`);
  }
}

module.exports = {
  getClientGraphPhone,
  updateClientRealPhoneGraph
};
