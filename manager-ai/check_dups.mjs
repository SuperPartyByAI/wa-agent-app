import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: recentConvs } = await supabase.from('conversations')
    .select('client_id, updated_at')
    .order('updated_at', { ascending: false })
    .limit(300);
    
  let uniqueClientIds = [];
  for (const conv of recentConvs || []) {
      if (conv.client_id && !uniqueClientIds.includes(conv.client_id)) {
          uniqueClientIds.push(conv.client_id);
      }
  }

  const { data: clientsRaw } = await supabase.from('clients')
      .select('id, real_phone_e164, full_name, public_alias, avatar_url, brand_key')
      .in('id', uniqueClientIds);
      
  const clientMap = new Map((clientsRaw || []).map(c => [c.id, c]));
  
  const results = [];
  const seenPhones = new Set();
  
  for (const cid of uniqueClientIds) {
      const c = clientMap.get(cid);
      if (c) {
          const phoneNumber = c.real_phone_e164 || c.public_alias || c.id;
          if (!seenPhones.has(phoneNumber)) {
              seenPhones.add(phoneNumber);
              results.push({
                 phone_number: phoneNumber,
                 alias: c.public_alias || c.full_name || null,
                 brand_key: c.brand_key
              });
          }
      }
  }
  
  const byAlias = {};
  for (const r of results) {
     const k = r.alias || "unknown";
     if (!byAlias[k]) byAlias[k] = [];
     byAlias[k].push(r);
  }
  
  const dupsByAlias = Object.entries(byAlias).filter(([k, list]) => list.length > 1 && k !== "unknown");
  
  console.log(`Found ${results.length} total unique phones returned in UI.`);
  console.log(`Of which, aliases duplicate ${dupsByAlias.length} times.`);
  if (dupsByAlias.length > 0) {
      for (const [k, list] of dupsByAlias.slice(0, 5)) {
          console.log(`\nAlias: ${k}`);
          console.log(list);
      }
  }
  
  // What about real_phone_e164 duplicates? The Map is by client.id, but does the same real_phone_e164 exist under different client ids?
  // Our api does `seenPhones.add(phoneNumber)`.
  const byPhone = {};
  for (const r of results) {
     const k = r.phone_number;
     if (!byPhone[k]) byPhone[k] = [];
     byPhone[k].push(r);
  }
  const dupsByPhone = Object.entries(byPhone).filter(([k, list]) => list.length > 1);
  console.log(`\nDuplicates by Phone: ${dupsByPhone.length}`);
}

check();
