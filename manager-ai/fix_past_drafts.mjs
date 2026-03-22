import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Fetching up to 100 drafts to find grouped characters...");
    const { data: drafts } = await supabase.from('ai_event_drafts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    let splitCount = 0;
    for (const draft of drafts || []) {
        if (!draft.structured_data_json) continue;
        
        const characterField = draft.structured_data_json['Personajul Dorit'] || draft.structured_data_json.personaj_dorit || '';
        
        // Match things like "Rumi și Jinu", "Elsa si Spiderman"
        if (typeof characterField === 'string' && (characterField.includes(' și ') || characterField.includes(' si ') || characterField.includes(','))) {
            const splitNames = characterField.split(/\s+și\s+|\s+si\s+|,/).map(n => n.trim()).filter(n => n.length > 0);
            
            if (splitNames.length > 1) {
                console.log(`\nFound target DRAFT ID: ${draft.id}`);
                console.log(`Original character field: "${characterField}"`);
                splitCount++;
                
                const firstChar = splitNames[0];
                const updatedFirstJson = { ...draft.structured_data_json };
                updatedFirstJson['Personajul Dorit'] = firstChar;
                
                await supabase.from('ai_event_drafts').update({
                    structured_data_json: updatedFirstJson,
                    updated_at: new Date().toISOString()
                }).eq('id', draft.id);
                console.log(`-> Split 1: Overwrote draft with [${firstChar}]`);

                for (let i = 1; i < splitNames.length; i++) {
                    const nextChar = splitNames[i];
                    const newJson = { ...draft.structured_data_json };
                    newJson['Personajul Dorit'] = nextChar;
                    
                    const newDraft = { ...draft };
                    delete newDraft.id; 
                    delete newDraft.created_at;
                    newDraft.updated_at = new Date().toISOString();
                    newDraft.structured_data_json = newJson;
                    
                    await supabase.from('ai_event_drafts').insert(newDraft);
                    console.log(`-> Split 2+: Spawned new draft for [${nextChar}]`);
                }
            }
        }
    }
    
    const { data: events } = await supabase.from('ai_client_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    for (const ev of events || []) {
        if (!ev.event_details) continue;
        const evChar = ev.event_details['Personajul Dorit'] || ev.event_details.personaj_dorit || '';
        if (typeof evChar === 'string' && (evChar.includes(' și ') || evChar.includes(' si ') || evChar.includes(','))) {
            const evSplits = evChar.split(/\s+și\s+|\s+si\s+|,/).map(n => n.trim()).filter(n => n.length > 0);
            
            if (evSplits.length > 1) {
                console.log(`\nFound target EVENT ID: ${ev.id}`);
                console.log(`Original character field: "${evChar}"`);
                splitCount++;
                
                const firstChar = evSplits[0];
                const upFirst = { ...ev.event_details };
                upFirst['Personajul Dorit'] = firstChar;
                
                await supabase.from('ai_client_events').update({ 
                    event_details: upFirst,
                    updated_at: new Date().toISOString()
                }).eq('id', ev.id);
                console.log(`-> Split 1: Overwrote event with [${firstChar}]`);

                for (let i = 1; i < evSplits.length; i++) {
                    const nextChar = evSplits[i];
                    const newEvJson = { ...ev.event_details };
                    newEvJson['Personajul Dorit'] = nextChar;
                    
                    const newEv = { ...ev };
                    delete newEv.id;
                    delete newEv.created_at;
                    newEv.event_details = newEvJson;
                    newEv.updated_at = new Date().toISOString();
                    
                    await supabase.from('ai_client_events').insert(newEv);
                    console.log(`-> Split 2+: Spawned new CRM event for [${nextChar}]`);
                }
            }
        }
    }
    
    if (splitCount === 0) {
        console.log("No grouped characters found! All drafts are already cleanly separated or entirely empty.");
    } else {
        console.log(`\nSUCCESS: Synchronized ${splitCount} grouped entries into independent single-character records.`);
    }
}
run();
