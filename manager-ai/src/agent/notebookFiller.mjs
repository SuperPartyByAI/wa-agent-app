// src/agent/notebookFiller.mjs
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * 1. Preluăm Caietul activ al clientului sau îi creăm unul provizoriu 
 * bazat pe serviciul cerut.
 */
export async function getActiveNotebook(phoneNumber, primaryService) {
    if (!primaryService) return null;
    
    // Simplificare: Preluăm un template cu key similar cu serviciul
    const templateKey = `template_${primaryService}`;
    
    try {
        // Caută template-ul în DB
        const { data: tpl } = await supabase.from('ai_notebook_templates')
            .select('*').eq('key', templateKey).single();
            
        if (!tpl) return null; // Nu există șablon strict pentru asta

        // Caută sau creează live notebook-ul clientului
        const { data: notebook, error } = await supabase.from('ai_client_notebooks')
            .select('*')
            .eq('phone_number', phoneNumber)
            .eq('template_key', templateKey)
            .single();

        if (notebook) {
            return { template: tpl, liveData: notebook.extracted_data };
        } else {
            // Se va insera la prima detecție de date fixe
            return { template: tpl, liveData: {} };
        }
    } catch (err) {
        console.error('[NotebookFiller] Eroare citire notebook:', err);
        return null;
    }
}

/**
 * 2. Construim string-ul care ajunge în Promptul Principal
 */
export function buildNotebookPromptSection(notebookContext) {
    if (!notebookContext) return '';

    const { template, liveData } = notebookContext;
    const fields = template.json_schema?.proprietati_cerute || [];
    
    let instructions = `\n--- [Sistem Notebook: Completare Șablon] ---\n`;
    instructions += `Ai primit un 'Șablon' pentru a afla detalii despre: ${template.name}.\n`;
    if (template.system_prompt_instruction) {
        instructions += `Directiva ta specială: ${template.system_prompt_instruction}\n`;
    }
    
    instructions += `\nIată ce știm DEJA (Căsuțe completate):\n`;
    let hasFilled = false;
    for(const key in liveData) {
         instructions += `- ${key}: ${liveData[key]}\n`;
         hasFilled = true;
    }
    if (!hasFilled) instructions += `- Nimic completat încă.\n`;

    instructions += `\nIată ce mai trebuie să afli NATURAL în discuție:\n`;
    let stillMissing = [];
    fields.forEach(f => {
        if (!liveData[f.nume]) {
            instructions += `- ${f.nume} (${f.descriere})\n`;
            stillMissing.push(f.nume);
        }
    });

    instructions += `\nREGULĂ CRITICĂ PENTRU LLM JSON OUTPUT:\n`;
    instructions += `Dacă în mesajul de azi al clientului ai identificat informații noi pentru căsuțele goale, adaugă în JSON-ul tău de răspuns un obiect separat "notebook_updates". EXEMPLU:
    {
       "assistant_reply": "Sigur, la ce oră începe petrecerea?",
       "notebook_updates": { "locatie": "Acasă la client" }
    }\n`;
    
    return instructions;
}

/**
 * 3. Salvăm datele extrase înapoi în Supabase (Caietul Clientului)
 */
export async function updateNotebookIfRequired(phoneNumber, primaryService, llmUpdates) {
    if (!llmUpdates || Object.keys(llmUpdates).length === 0) return;
    if (!primaryService) return;
    
    const templateKey = `template_${primaryService}`;
    
    console.log(`[NotebookFiller] Aplicare bife noi pt ${phoneNumber}:`, llmUpdates);
    
    try {
        // Obținem starea curentă
        const { data: notebook } = await supabase.from('ai_client_notebooks')
            .select('extracted_data')
            .eq('phone_number', phoneNumber)
            .eq('template_key', templateKey)
            .single();
            
        const currentState = notebook ? notebook.extracted_data : {};
        const newState = { ...currentState, ...llmUpdates };
        
        // Salvăm
        await supabase.from('ai_client_notebooks').upsert({
            phone_number: phoneNumber,
            template_key: templateKey,
            extracted_data: newState,
            updated_at: new Date().toISOString()
        }, { onConflict: 'phone_number, template_key' });
        
    } catch(err) {
        console.error('[NotebookFiller] Eroare la salvarea filei de notebook:', err);
    }
}
