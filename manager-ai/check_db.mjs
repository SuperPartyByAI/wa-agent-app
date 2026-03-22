import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Searching for Rumi or Jinu...");
    const { data: drafts, error: draftErr } = await supabase.from('ai_event_drafts')
        .select('id, created_at, updated_at, structured_data_json')
        .order('created_at', { ascending: false })
        .limit(100);

    const filtered = drafts.filter(d => {
        const char = d.structured_data_json?.['Personajul Dorit'] || '';
        return char.includes('Rumi') || char.includes('Jinu');
    });

    console.log(JSON.stringify(filtered, null, 2));
}
run();
