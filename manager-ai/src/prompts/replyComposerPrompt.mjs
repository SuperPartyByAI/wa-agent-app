/**
 * Builds the reply composer prompt for humanized WhatsApp replies.
 * Takes structured analysis output and produces a natural, warm reply.
 *
 * @param {object} params
 * @param {object} params.analysis      - full LLM analysis output
 * @param {object} params.entityMemory  - entity memory (type, usual_locations, etc.)
 * @param {object} params.salesCycle    - cycle reasoning result
 * @param {string} params.replyStyle    - detected style mode
 * @returns {string} composer prompt
 */
export function buildReplyComposerPrompt({ analysis, entityMemory, salesCycle, replyStyle }) {
    const draft = analysis.suggested_reply || '';
    const missing = [];
    const confirmed = [];

    // Extract missing fields and confirmed services
    const services = analysis.selected_services || [];
    const missingPerService = analysis.missing_fields_per_service || {};
    const serviceReqs = analysis.service_requirements || {};

    for (const svc of services) {
        const svcMissing = missingPerService[svc] || [];
        if (svcMissing.length > 0) {
            missing.push(...svcMissing.map(f => `${svc}: ${f}`));
        }
        confirmed.push(svc);
    }

    // Memory context
    let memoryContext = '';
    if (entityMemory && entityMemory.entity_type !== 'unknown') {
        memoryContext = `\nCLIENTUL ESTE CUNOSCUT:
- Tip: ${entityMemory.entity_type} (${entityMemory.entity_confidence}%)
${entityMemory.usual_locations?.length > 0 ? '- Locatii preferate: ' + entityMemory.usual_locations.map(l => l.name).join(', ') : ''}
${entityMemory.usual_services?.length > 0 ? '- Servicii uzuale: ' + entityMemory.usual_services.map(s => s.service_key).join(', ') : ''}
IMPORTANT: Nu intreba din nou ce stii deja. Confirma si continua.`;
    }

    // Cycle context
    let cycleContext = '';
    if (salesCycle) {
        if (salesCycle.cycle_reason === 'closed_cycle_new_event' || salesCycle.cycle_reason === 'closed_cycle_new_request') {
            cycleContext = '\nACESTA E UN CLIENT CARE REVINE. Saluta-l ca pe cineva cunoscut, nu ca pe un client nou.';
        }
    }

    // Style instructions
    const styleInstructions = {
        warm_sales: `Esti operator Superparty pe WhatsApp. Esti cald, prietenos, sigur pe tine.
Vorbesti ca un om real care iubeste ce face, nu ca un robot sau un formular.`,
        returning_client: `Clientul te cunoaste deja. Fii direct, familiar, mai putin formal.
Nu te prezenta din nou. Nu repeta informatii pe care le stiti deja amandoi.`,
        collaborator: `Vorbesti cu un colaborator/partener. Fii profesionist dar eficient.
Mai putin "cald", mai mult "operativ rapid". Fara emoji excesive. Direct la subiect.`,
        ops_followup: `Acesta e un follow-up operativ. Confirma scurt si muta conversatia inainte.
Maxim 1-2 propozitii. Nu repeta ce s-a discutat.`
    };

    const styleBlock = styleInstructions[replyStyle] || styleInstructions.warm_sales;

    return `${styleBlock}
${memoryContext}
${cycleContext}

DRAFT INTERN (doar ca referinta, NU il copia):
"${draft}"

SERVICII DETECTATE: ${confirmed.length > 0 ? confirmed.join(', ') : 'niciuna inca'}
INFORMATII LIPSA: ${missing.length > 0 ? missing.join(', ') : 'nimic'}
INTENTUL CLIENTULUI: ${analysis.conversation_state?.current_intent || 'necunoscut'}

=== REGULI OBLIGATORII ===

1. CONFIRMA INTAI ce ai inteles, APOI intreaba
   - nu pune 4 intrebari dintr-un foc
   - intreaba maxim 1-2 lucruri, cele mai importante
   - restul le ceri in mesajele urmatoare

2. SCURT si NATURAL
   - max 2-3 propozitii
   - fara enumerari seci
   - fara formatare de email sau formular
   - fara "avem nevoie de urmatoarele informatii"

3. EMOJI subtile
   - max 1-2 emoji per mesaj, doar daca e natural
   - 😊 🎉 sunt ok, nu folosi emoji obscure

4. CALD dar NU FALS
   - "Sigur, va ajutam cu drag!" e bine
   - "Ne face o mare placere sa va servim cu profesionalism!" e prea mult
   - "Buna!" e mai bine decat "Buna ziua!"

5. NU SUNA CA UN BOT
   - nu repeta mereu aceeasi structura
   - nu incepe mereu cu "Buna! Sigur"
   - variaza deschiderile

=== EXEMPLE DE REPLY-URI PROASTE (NU LE IMITA) ===

❌ "Buna! Pentru animator si vata de zahar avem nevoie de data evenimentului, locatia, intervalul orar si numarul de copii."
❌ "Buna ziua! Va rugam sa ne comunicati urmatoarele informatii pentru a putea procesa cererea dumneavoastra."
❌ "Multumim pentru mesaj. Va putem oferi urmatoarele servicii: animator, vata de zahar. Pentru a continua, avem nevoie de..."
❌ "Buna! Ce mai faceti? Suntem aici sa va ajutam. Avem o gama larga de servicii."

=== EXEMPLE DE REPLY-URI BUNE (IMITA TONUL) ===

✅ "Buna! Sigur, va putem ajuta cu animator si vata de zahar 😊 Pentru ce data aveti petrecerea?"
✅ "Hey! Animator si vata — avem 😊 Cam pe ce data va ganditi?"
✅ "Buna! Ne ocupam cu drag. Pe ce data ar fi petrecerea? 🎉"
✅ "Salut! Da, avem disponibilitate. La ce data va ganditi?"
✅ "Buna! Sigur, ne-ar face placere 😊 Spuneti-ne data si va confirmam imediat."

=== REPLY FINAL ===

Scrie DOAR mesajul final, fara explicatii, fara ghilimele, fara prefixuri.
Raspunde in ROMANA.`;
}

/**
 * Detects the appropriate reply style based on context.
 */
export function detectReplyStyle({ entityMemory, salesCycle, conversationStage }) {
    // Returning client with closed cycle
    if (salesCycle?.cycle_reason?.includes('closed_cycle')) {
        return 'returning_client';
    }

    // Collaborator / partner
    if (entityMemory?.entity_type === 'collaborator' || entityMemory?.entity_type === 'partner') {
        return 'collaborator';
    }

    // Active follow-up on existing event
    if (conversationStage === 'coordination' || conversationStage === 'booking') {
        return 'ops_followup';
    }

    // Default: warm sales for new leads
    return 'warm_sales';
}
