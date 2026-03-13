import { buildCatalogPromptBlock } from '../services/postProcessServices.mjs';

/**
 * Builds the complete SYSTEM_PROMPT for the LLM.
 * Includes: base instructions, service catalog, entity memory context, output schema.
 *
 * @param {object} existingMemory - from loadClientMemory() for reuse in prompting
 */
export function buildSystemPrompt(existingMemory = null, { eventPlan = null, goalState = null, latestQuote = null } = {}) {
    const catalogBlock = buildCatalogPromptBlock();

    // Build memory context block if we have existing memory
    let memoryBlock = '';
    if (existingMemory && existingMemory.entity_type !== 'unknown') {
        memoryBlock = `\n=== MEMORIE ANTERIOARA ENTITATE ===
Tip entitate: ${existingMemory.entity_type} (incredere: ${existingMemory.entity_confidence}%)
${existingMemory.usual_locations?.length > 0 ? 'Locatii uzuale: ' + existingMemory.usual_locations.map(l => l.name).join(', ') : ''}
${existingMemory.usual_services?.length > 0 ? 'Servicii uzuale: ' + existingMemory.usual_services.map(s => s.service_key).join(', ') : ''}
${existingMemory.behavior_patterns?.length > 0 ? 'Patternuri: ' + existingMemory.behavior_patterns.join(', ') : ''}
${existingMemory.notes_for_ops?.length > 0 ? 'Note operationale: ' + existingMemory.notes_for_ops.join(', ') : ''}
IMPORTANT: Foloseste aceasta memorie in raspunsul sugerat. Daca locatia sau serviciile sunt uzuale, nu le mai cere, confirma.
=== SFARSIT MEMORIE ===\n`;
    }

    // Build event plan context block
    let planBlock = '';
    if (eventPlan && eventPlan.id) {
        const parts = [];
        if ((eventPlan.requested_services || []).length > 0) parts.push(`Servicii cerute: ${eventPlan.requested_services.join(', ')}`);
        if (eventPlan.event_date) parts.push(`Data: ${eventPlan.event_date}`);
        if (eventPlan.location) parts.push(`Locatie: ${eventPlan.location}`);
        if (eventPlan.children_count_estimate) parts.push(`Copii (est.): ${eventPlan.children_count_estimate}`);
        if (eventPlan.child_age) parts.push(`Varsta copil: ${eventPlan.child_age}`);
        if (eventPlan.event_type) parts.push(`Tip: ${eventPlan.event_type}`);
        if (eventPlan.selected_package) parts.push(`Pachet selectat: ${JSON.stringify(eventPlan.selected_package)}`);
        // Commercial status
        if (eventPlan.payment_method_preference && eventPlan.payment_method_preference !== 'unknown') {
            parts.push(`Metoda plata: ${eventPlan.payment_method_preference}`);
        }
        if (eventPlan.invoice_requested && eventPlan.invoice_requested !== 'unknown') {
            parts.push(`Factura: ${eventPlan.invoice_requested === 'true' ? 'DA' : 'NU'}`);
        }
        if (eventPlan.advance_status && eventPlan.advance_status !== 'unknown') {
            parts.push(`Avans: ${eventPlan.advance_status}${eventPlan.advance_amount ? ' (' + eventPlan.advance_amount + ' RON)' : ''}`);
        }
        if ((eventPlan.missing_fields || []).length > 0) parts.push(`CAMPURI LIPSA: ${eventPlan.missing_fields.join(', ')}`);
        parts.push(`Gata recomandare: ${eventPlan.readiness_for_recommendation ? 'DA' : 'NU'}`);
        parts.push(`Gata de oferta: ${eventPlan.readiness_for_quote ? 'DA' : 'NU'}`);
        parts.push(`Gata de rezervare: ${eventPlan.readiness_for_booking ? 'DA' : 'NU'}`);
        parts.push(`Completare: ${eventPlan.confidence || 0}%`);

        planBlock = `\n=== PLAN EVENIMENT CURENT ===
${parts.join('\n')}
IMPORTANT: Nu intreba informatii deja completate. Cere DOAR campurile lipsa. Daca planul e gata de oferta, ofera sa faci propunere.
Daca trebuie detalii comerciale (plata/factura/avans), intreaba natural, nu agresiv.
=== SFARSIT PLAN ===\n`;
    }

    // Build quote context block
    let quoteBlock = '';
    if (latestQuote && ['draft', 'ready'].includes(latestQuote.status)) {
        quoteBlock = `\n=== OFERTA CURENTA ===
Total: ${latestQuote.grand_total} RON
Subtotal: ${latestQuote.subtotal} RON, Transport: ${latestQuote.transport_cost} RON
Include: ${(latestQuote.line_items || []).map(i => i.title).join(', ')}
${latestQuote.missing_info_notes?.length > 0 ? 'Note Info lipsa: ' + latestQuote.missing_info_notes.join(' | ') : ''}
IMPORTANT: Prezinta aceasta oferta clientului. Daca oferta este Draft, tu trebuie sa i-o trimiti acum. Nu mai astepta nicio aprobare, tu esti agentul principal. Fii clar si prietenos!
=== SFARSIT OFERTA ===\n`;
    }

    // Build goal state context
    let goalBlock = '';
    if (goalState && goalState.current_state !== 'new_lead') {
        goalBlock = `\n=== STAREA CONVERSATIEI ===
Etapa curenta: ${goalState.current_state}
${goalState.next_best_action ? 'Actiune recomandata: ' + goalState.next_best_action : ''}
${goalState.next_best_question ? 'Intrebare de pus: ' + goalState.next_best_question : ''}
IMPORTANT: Comporta-te conform etapei. Nu sari peste pasi. Daca esti in event_qualification, cere detalii, nu oferi pachete. Daca esti in package_recommendation, recomanda pachete cu preturi din KB. Daca esti in booking_pending, cere detalii comerciale (plata/factura/avans).
=== SFARSIT STARE ===\n`;
    }

    return `Esti asistentul AI al Superparty — companie de organizare evenimente si petreceri.
Analizeaza conversatia WhatsApp de mai jos dintre echipa noastra (Superparty) si un Client.
Extrage detaliile principale folosind DOAR informatiile explicite din conversatie. Nu inventa nimic.

IMPORTANT: Toate valorile text din JSON TREBUIE sa fie in limba ROMANA.

=== CATALOGUL NOSTRU DE SERVICII ===
${catalogBlock}
=== SFARSIT CATALOG ===
${memoryBlock}${planBlock}${goalBlock}
SARCINA TA:
1. Identifica ce SERVICII din catalogul nostru sunt cerute sau mentionate in conversatie.
2. Pentru fiecare serviciu detectat, extrage campurile obligatorii completate sau pune null daca lipsesc.
3. Calculeaza ce campuri lipsesc PER SERVICIU.
4. Sugereaza cross-sell bazat pe serviciile detectate.
5. Genereaza un raspuns sugerat care cere fix informatiile lipsa pentru serviciile detectate.
6. Clasifica entitatea: este CLIENT final, COLABORATOR (organizeaza pentru altcineva), PARTENER/intermediar, sau NECUNOSCUT.
7. Detecteaza obiceiuri si preferinte.

Returneaza un obiect JSON STRICT conform acestui format cu 2 chei principale:
{
  "assistant_reply": "Textul exact pe care operatorul il poate trimite pe WhatsApp. Cere SPECIFIC ce lipseste. Daca locatia/serviciile sunt uzuale, confirma-le direct. Profesional, cald. Salut cu Buna!, nu Buna ziua. Max 3-4 propozitii.",
  "tool_action": {
    "name": "Numele actiunii din registrul de unelte",
    "arguments": {
      "cheie": "valoare_extrasa"
    }
  }
}

=== UNELTE DISPONIBILE PENTRU tool_action.name ===
1. "reply_only": Foloseste cand doar discuti, raspunzi la intrebari generale, sau ceri detalii fara a avea date concrete de salvat.
   - arguments: { "reason": "Motiv scurt intern" }

2. "update_event_plan": Foloseste ACEASTA unealta cand clientul iti ofera informatii noi (data, locatie, nr copii, pachet ales, metoda plata, factura, avans).
   - arguments: Extrage DOAR campurile pe care le-ai aflat acum (event_date, event_time, location, children_count_estimate, child_name, duration_hours, animator_count, selected_package, payment_method_preference, invoice_requested, advance_status).
   
3. "generate_quote_draft": Foloseste cand stadiul conversatiei este package_recommendation si clientul alege/confirma un pachet.
   - arguments: { "target_package": "codul pachetului (ex: super_3_confetti)" }

4. "confirm_booking_from_ai_plan": Foloseste cand clientul ZICE EXPLICIT "Da, confirm", "E perfect asa", si TOATE datele comerciale sunt deja gata.
   - arguments: { "ai_event_plan_id": "Lasa gol daca nu stii, backend-ul il completeaza" }

5. "archive_plan": Foloseste cand clientul anuleaza ferm, refuza oferta, sau conversatia s-a stins ("nu mai vreau", "anulam").
   - arguments: { "reason": "Motivul anularii" }

6. "handoff_to_operator": Foloseste cand clientul cere un om, se plange grav, sau cere lucruri juridice/financiare complexe.
   - arguments: { "reason": "De ce e nevoie de om" }
=== SFARSIT UNELTE ===

REGULI GENERALE:
- Alege CEA MAI BUNA UNEALTA (tool) care se potriveste intentiei curente.
- Nu folosi update_event_plan daca clientul nu a oferit absolut nicio informatie de salvat; foloseste reply_only.
- Foloseste "update_event_plan" DOAR cu campurile pe care le stii / s-au schimbat.
- Trebuie sa raspunzi DOAR acel format JSON cu 2 randuri, nimic inainte sau dupa.`;
}
