const supabase = require('./supabase');

async function testUpsert() {
    console.log("Testing upsert constraint...");
    
    const upsertPayload = [
        {
            client_id: '1be196a5-c9f2-4d2f-903d-0b55cb268ba5',
            brand_key: 'SUPERPARTY',
            identifier_type: 'lid',
            identifier_value: 'test_upsert_123@lid',
            is_primary: false
        }
    ];
    
    const { data, error } = await supabase
        .from('client_identity_links')
        .upsert(upsertPayload, { onConflict: 'brand_key,identifier_value', ignoreDuplicates: true })
        .select();
        
    if (error) {
        console.error("UPSERT CONFLICT ERROR:", JSON.stringify(error, null, 2));
    } else {
        console.log("UPSERT SUCCESS:", data);
        
        // Clean up
        await supabase.from('client_identity_links').delete().eq('identifier_value', 'test_upsert_123@lid');
    }
}

testUpsert().then(() => process.exit(0)).catch(console.error);
