import { buildCatalogPromptBlock } from '../services/postProcessServices.mjs';
import { ACTION_REGISTRY } from '../actions/actionRegistry.mjs';

/**
 * Builds the tools block for the system prompt dynamically.
 * Prefers Context Pack snapshot if available, falls back to live registry.
 */
function buildToolsBlock(contextPack) {
    const registry = contextPack?.action_registry_snapshot || {};
    // Use context pack if it has tools, otherwise use live registry
    const source = Object.keys(registry).length > 0 ? registry : null;
    
    if (!source) {
        // Fallback: build from live ACTION_REGISTRY
        return buildToolsFromLiveRegistry();
    }

    // Build from context pack snapshot
    let idx = 1;
    const lines = [];
    for (const [name, entry] of Object.entries(source)) {
        const args = [...(entry.requiredArgs || []), ...(entry.optionalArgs || [])];
        const argsStr = args.length > 0 ? `arguments: { ${args.map(a => `"${a}": "..."`).join(', ')} }` : 'arguments: {}';
        lines.push(`${idx}. "${name}": ${entry.description}\n   - ${argsStr}`);
        idx++;
    }
    return lines.join('\n\n');
}

/**
 * Fallback: builds the tools block directly from the live ACTION_REGISTRY.
 */
function buildToolsFromLiveRegistry() {
    let idx = 1;
    const lines = [];
    for (const [name, entry] of Object.entries(ACTION_REGISTRY)) {
        const props = Object.keys(entry.schema?.properties || {});
        const argsStr = props.length > 0 ? `arguments: { ${props.map(p => `"${p}": "..."`).join(', ')} }` : 'arguments: {}';
        lines.push(`${idx}. "${name}": ${entry.description}\n   - ${argsStr}`);
        idx++;
    }
    return lines.join('\n\n');
}

/**
 * Builds the complete SYSTEM_PROMPT for the LLM.
 * Includes: base instructions, service catalog, entity memory context, output schema.
 *
 * @param {object} existingMemory - from loadClientMemory() for reuse in prompting
 */
export function buildSystemPrompt(existingMemory = null, { eventPlan = null, goalState = null, latestQuote = null, contextPack = null, relationshipData = null, activeRolesText = null } = {}) {
    const catalogBlock = buildCatalogPromptBlock();

    let roleBlock = '';
    if (activeRolesText) {
        roleBlock = `\n=== FISE DE POST (ROLURI ACTIVE) ===\n${activeRolesText}\n=== SFARSIT FISE DE POST ===\n
CRITIC IMPORTANT: Tu ESTI constrans comercial de regulile de mai sus! 
Obligatoriu cand generezi \`assistant_reply\`, TREBUIE sa iti compui textul folosind EXACT frazele din 'APPROVED SALES COPY GUIDELINES' (Intro, Upsell, Closing question) ale serviciului detectat. Nu mai da raspunsuri generice tip "Ce servicii va intereseaza?", ci raspunde exact cu oferta/intro-ul pentru serviciul detectat.\n`;
    }

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

    // Build relationship memory block
    let relationBlock = '';
    if (relationshipData) {
        const parts = [];
        if (relationshipData.conversationCount > 1) parts.push(`Client RECURENT — ${relationshipData.conversationCount} conversatii anterioare`);
        else parts.push('Client NOU — prima conversatie');
        if (relationshipData.eventPlanCount > 0) parts.push(`${relationshipData.eventPlanCount} planuri de eveniment (inclusiv curente/trecute)`);
        if (relationshipData.hasActiveBooking) parts.push('ARE o rezervare activa');
        if (relationshipData.hasPastBookings) parts.push(`A avut rezervari anterioare`);
        if (relationshipData.hasPastCancellations) parts.push('A anulat anterior');
        if (relationshipData.lastInteractionAt) parts.push(`Ultima interactiune: ${relationshipData.lastInteractionAt}`);
        
        if (parts.length > 0) {
            relationBlock = `\n=== RELATIE CLIENT ===
${parts.join('\n')}
IMPORTANT: Daca este client recurent, saluta-l cald si scurt. Nu-l trata ca pe un lead nou. Daca are rezervare activa, verifica daca doreste modificare sau eveniment NOU — cere clarificare.
=== SFARSIT RELATIE ===\n`;
        }
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
${roleBlock}${memoryBlock}${relationBlock}${planBlock}${goalBlock}
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
${buildToolsBlock(contextPack)}
=== SFARSIT UNELTE ===
${contextPack ? `[context_pack v${contextPack.action_registry_version} | SHA:${(contextPack.deployed_commit_sha || '').substring(0, 8)} | prompt:${contextPack.prompt_version}]` : ''}

REGULI GENERALE:
- Alege CEA MAI BUNA UNEALTA (tool) care se potriveste intentiei curente.
- CRITIC: Daca ultimul mesaj al clientului este DOAR un salut (ex. "Buna", "Buna seara", "Salut"), TREBUIE sa folosesti DOAR unealta "reply_only". Aceasta asigura furnizarea unui raspuns scurt si cald de deschidere.
- Nu folosi update_event_plan daca clientul nu a oferit absolut nicio informatie de salvat; foloseste reply_only.
- Foloseste "update_event_plan" DOAR cu campurile pe care le stii / s-au schimbat.
- CRITIC: Cand folosesti update_event_plan, PUNE in arguments FIECARE CAMP extras din mesaj.
  Exemplu: daca clientul zice "vreau pe 20 aprilie in Bucuresti", arguments TREBUIE sa contina:
  { "event_date": "2026-04-20", "location": "București" }
  NU lasa arguments gol — daca ai ales update_event_plan, PUNE datele in arguments!
- Formate acceptate: event_date=YYYY-MM-DD, event_time=HH:MM, children_count_estimate=numar, location=text, selected_package=text, invoice_requested=true/false, payment_method_preference=text, advance_status=text.

REGULI DE CLARIFICARE (OBLIGATORII):
- Daca mesajul clientului este AMBIGUU sau INCOMPLET, NU executa side effects. Foloseste "reply_only" si cere clarificare naturala.
- Daca nu e clar daca clientul vrea eveniment NOU sau MODIFICARE la unul existent, INTREABA inainte de a executa.
- Daca nu e clar daca vrea OFERTA sau CONFIRMARE, cere clarificare.
- Daca mesajul este vag ("vreau si eu ceva", "muta-l pe maine", "da, e bine") si nu exista context suficient, cere detalii.
- Daca referinta la entitate este neclara (care eveniment? care rezervare?), cere specificare.
- NU inventa informatii. NU ghici date, locatii sau servicii. Daca nu stii, intreaba.
- Cand ceri clarificare, fii SCURT, POLITICOS si UTIL. Exemple:
  "Scuze, nu am inteles exact. Vrei eveniment nou sau sa modificam cel existent?"
  "Nu mi-e clar daca vrei doar oferta sau sa confirmam rezervarea. Ce preferi?"
  "Poti reformula putin? Vreau sa notez corect."
  "Nu am prins exact data si ora. Mi le poti scrie complet?"
- Preferi clarificarea in loc de executie gresita.
- Trebuie sa raspunzi DOAR acel format JSON cu 2 randuri, nimic inainte sau dupa.`;
}
