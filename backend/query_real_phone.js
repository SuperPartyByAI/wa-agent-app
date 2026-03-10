const supabase = require('./supabase');

async function checkRealPhone() {
    console.log("Checking exact DB state for Y1 / 40737571397...");
    
    // Find client ID by identifier_value
    const { data: links, error: err } = await supabase
        .from('client_identity_links')
        .select('client_id, clients!inner(id, full_name, real_phone_e164, real_phone_source, real_phone_confidence)')
        .eq('identifier_value', '40737571397')
        .limit(1)
        .maybeSingle();
        
    if (err) {
        console.error("Query Error:", err);
        return;
    }
    
    if (!links || !links.clients) {
        console.log("❌ No client found matching 40737571397 alias.");
        return;
    }
    
    const c = links.clients;
    console.log(`\nClient Found via MSISDN Alias: ${c.full_name} (${c.id})`);
    console.log(`  real_phone_e164: ${c.real_phone_e164 === null ? 'NULL ❌ (No extraction exists)' : c.real_phone_e164 + ' ✅ (Extracted!)'}`);
    console.log(`  source: ${c.real_phone_source}`);
    console.log(`  confidence: ${c.real_phone_confidence}`);
    
    if (c.real_phone_e164 === null) {
       console.log("\nCONCLUSION: The MSISDN exists in links, but pii.js failed to propagate it to real_phone_e164.");
    } else {
       console.log("\nCONCLUSION: 100% SUCCESS. remoteJidAlt bound the MSISDN alias, and updateClientRealPhoneGraph extracted it to the canonical property!");
    }
}

checkRealPhone().then(() => process.exit(0)).catch(console.error);
