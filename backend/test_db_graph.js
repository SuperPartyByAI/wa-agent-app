const supabase = require('./supabase');

async function testExtraction() {
    console.log("Mocking webhook hook for Superparty-U11...");
    let { data } = await supabase.from('clients').select('id, public_alias, full_name, real_phone_e164').eq('public_alias', 'Superparty-U11').maybeSingle();
    
    if (!data) return console.log("Not found in database at all.");
    console.log("Database Row Data:", JSON.stringify(data, null, 2));

    const { data: conv } = await supabase.from('conversations').select('id, client_id, updated_at').eq('client_id', data.id).limit(2).order('updated_at', {ascending: false});
    console.log("Conversations Row Data:", JSON.stringify(conv, null, 2));
}

testExtraction().then(() => process.exit(0));
