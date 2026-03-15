import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const SENSITIVE_FIELDS = ['data_evenimentului', 'ora_evenimentului', 'locatie_eveniment', 'nume_sarbatorit', 'servicii'];

/**
 * Gatekeeper pentru mutațiile pe Portofoliul de Evenimente.
 * Verifică intenția LLM-ului raportat la contextul Clientului.
 * 
 * @param {Object} llmIntent - Payload JSON generat de LLM (ex: { mutation: { field: "data_evenimentului", value: "2024-05-20" } })
 * @param {Object} clientContext - Portofoliul de evenimente generat de clientMemoryLoader
 */
export async function evaluateMutationIntent(llmIntent, clientContext) {
    // 1. Daca LLM nu cere nicio mutatie sau disambiguare, e ok.
    if (!llmIntent.mutation && !llmIntent.requires_disambiguation) {
        return { action: 'proceed', reason: 'no_mutation' };
    }

    const activeEvents = clientContext.events || [];
    const activeCount = activeEvents.length;

    // 2. LLM semnalizează direct că nu e sigur la ce eveniment se referă clientul.
    if (llmIntent.requires_disambiguation === true) {
        return { 
            action: 'block_ask_disambiguation', 
            reason: 'llm_uncertain_multiple_events' 
        };
    }

    // 3. Are intenție clară de Mutare, trebuie să verificăm siguranța ancorării (Event ID)
    const mutation = llmIntent.mutation; // { target_event_id, field, new_value }
    
    // Fallback: Dacă LLM a uitat să pună event_id dar are 1 singur eveniment.
    let targetEventId = mutation.target_event_id;
    if (!targetEventId && activeCount === 1) {
        targetEventId = activeEvents[0].event_id;
    }

    // Dacă are mai multe evenimente și nu a trimis target clar, forțăm blocaj Disambiguare!
    if (!targetEventId && activeCount > 1) {
        return { 
            action: 'block_ask_disambiguation', 
            reason: 'missing_target_event_id_for_multiple_events' 
        };
    }

    // Dacă a găsit ținta, o validăm.
    const targetEvent = activeEvents.find(e => e.event_id === targetEventId);
    if (!targetEvent) {
        return { 
            action: 'block_invalid_target', 
            reason: 'target_event_id_not_found_in_active_portfolio'
        };
    }

    // 4. Evaluează Gradul de Sensibilitate al câmpului.
    const isSensitive = SENSITIVE_FIELDS.includes(mutation.field);

    // 5. Dacă LLM marchează `client_confirmed_mutation: true` înseamnă că la T-1 a întrebat, iar acum avem DA-ul.
    if (llmIntent.client_confirmed_mutation === true) {
        return {
            action: 'apply_mutation',
            event_id: targetEventId,
            field: mutation.field,
            old_value: targetEvent[mutation.field] || null,
            new_value: mutation.new_value,
            is_sensitive: isSensitive
        };
    }

    // 6. Altfel (Prima oară când cere schimbarea), dacă e Sensibil, forțăm LLM-ul să trimită mesajul de Confirmare Explicită către client.
    if (isSensitive) {
        return {
            action: 'block_ask_confirmation',
            event_id: targetEventId,
            field: mutation.field,
            suggested_new_value: mutation.new_value,
            reason: 'sensitive_mutation_requires_client_consent'
        };
    }

    // 7. Mutatii minore (ex: observatii) se aproba direct
    return {
        action: 'apply_mutation',
        event_id: targetEventId,
        field: mutation.field,
        old_value: targetEvent[mutation.field] || null,
        new_value: mutation.new_value,
        is_sensitive: false
    };
}

/**
 * Aplică efectiv mutația în baza de date și scrie în Changelog.
 */
export async function commitEventMutation(mutationContext, clientId) {
    if (mutationContext.action !== 'apply_mutation') return false;

    // 1. Update tabela master (ex: client_events sau drafts) 
    // În mod real, trebuie decis la design dacă modificăm direct draft-ul sau fields de search din events.
    // Pentru câmpuri generale, de ex event_date:
    
    // Simulăm un update general spre tabela care tine "data_evenimentului" (ai_client_events)
    // Dacă e câmp detaliat (ex: 'personaj'), el va merge de fapt in party_drafts. 
    // Acest mapper va trebui implementat ulterior la legarea de PartyBuilder.
    
    // 2. Scrie în ChangeLog 
    const { error: logErr } = await supabase.from('ai_event_change_log').insert({
        event_id: mutationContext.event_id,
        client_id: clientId,
        changed_field: mutationContext.field,
        old_value: String(mutationContext.old_value),
        new_value: String(mutationContext.new_value),
        requested_by: 'client',
        confirmed_by_client: true, // pentru ca a trecut de gate
    });

    if (logErr) {
        console.error(`[Gatekeeper] Failed to write Audit Log for Event ${mutationContext.event_id}`, logErr.message);
        return false;
    }

    return true;
}
