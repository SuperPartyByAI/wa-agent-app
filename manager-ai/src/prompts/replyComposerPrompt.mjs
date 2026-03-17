/**
 * Builds the reply composer prompt for humanized WhatsApp replies.
 * Now respects the Service Detection Confidence Guard:
 * - clear: confirm services concretely
 * - ambiguous/unknown: ask open service discovery question, NO assumptions
 *
 * @param {object} params
 * @param {object} params.replyContext   - from buildReplyContext()
 * @param {object} params.entityMemory  - entity memory
 * @param {object} params.salesCycle    - cycle reasoning result
 * @param {string} params.replyStyle    - detected style mode
 * @param {string} params.draftReply    - analysis draft (reference only)
 * @returns {string} composer prompt
 */
export function buildReplyComposerPrompt({ replyContext, entityMemory, salesCycle, replyStyle, draftReply, progression, nextBestActionGoal }) {

    // ── Structural Context ──
    const style = `Vorbești natural, ca un om real, nu ca un robot.`;

    // ── Build concrete context block ──
    let contextBlock = '';

    // ── SERVICE DETECTION CONFIDENCE GUARD ──
    const svcStatus = replyContext.serviceDetectionStatus || 'clear';

    if (svcStatus === 'unknown' || svcStatus === 'ambiguous') {
        // DISCOVERY MODE — no services confirmed, must ask
        contextBlock += `\nSERVICII: NEDETECTATE SAU AMBIGUE.`;
        contextBlock += `\n→ INTERZIS: Nu enumera serviciile noastre (fără "avem animator, ursitoare...").`;
        contextBlock += `\n→ INTERZIS: Nu presupune ce vrea clientul.`;
        contextBlock += `\n→ OBLIGATORIU: Fii cald și natural. Pune o întrebare deschisă simplă:`;
        contextBlock += `\n   "Suntem aici, cu ce vă putem ajuta?" sau "Despre ce fel de eveniment este vorba?"`;
    } else if (svcStatus === 'partial') {
        // Some confirmed, some ambiguous
        if (replyContext.hasServices) {
            contextBlock += `\nSERVICII CONFIRMATE: ${replyContext.confirmedServicesText}`;
            contextBlock += `\n→ Mentioneaza DOAR aceste servicii confirmate.`;
            contextBlock += `\n→ INTERZIS: Nu adauga alte servicii neconfirmate.`;
        }
    } else {
        // CLEAR — all good
        if (replyContext.hasServices) {
            contextBlock += `\nSERVICII CONFIRMATE: ${replyContext.confirmedServicesText}`;
            contextBlock += `\n→ OBLIGATORIU: Mentioneaza aceste servicii in reply cand confirmi ce ai inteles.`;
        } else {
            contextBlock += `\nSERVICII: niciuna detectata clar. Intreaba ce doreste clientul.`;
        }
    }

    // Next question
    if (replyContext.memoryAwareQuestion) {
        contextBlock += `\n\nINTREBAREA URMATOARE (memory-aware):`;
        contextBlock += `\n→ "${replyContext.memoryAwareQuestion}"`;
        contextBlock += `\nFoloseste aceasta formulare sau una similara natural.`;
    } else if (replyContext.suggestedQuestionPhrase) {
        contextBlock += `\n\nINTREBAREA URMATOARE (cea mai importanta):`;
        contextBlock += `\n→ "${replyContext.suggestedQuestionPhrase}"`;
        contextBlock += `\nIntreaba DOAR asta acum. Restul le afli in mesajele urmatoare.`;
    }

    // Known from memory
    if (replyContext.knownFromMemory.length > 0) {
        contextBlock += `\n\nINFORMATII DEJA CUNOSCUTE (NU LE INTREBA DIN NOU):`;
        for (const k of replyContext.knownFromMemory) {
            contextBlock += `\n- ${k.field}: ${k.value}`;
        }
    }

    // Remaining missing (for awareness, not to dump in reply)
    if (replyContext.trulyMissing.length > 1) {
        contextBlock += `\n\nALTE INFORMATII LIPSA (dar NU le cere pe toate acum):`;
        contextBlock += `\n${replyContext.trulyMissing.slice(1).join(', ')}`;
        contextBlock += `\nAcestea se cer in mesajele urmatoare, NU acum.`;
    }

    // Cycle context
    let cycleContext = '';
    if (salesCycle?.cycle_reason?.includes('closed_cycle')) {
        cycleContext = '\nACESTA E UN CLIENT CARE REVINE. Saluta-l familiar, nu ca pe un strain.';
    }

    // ── Discovery/Clear Mode Safety Guards ──
    let safetyBlock = '';
    if (svcStatus === 'unknown' || svcStatus === 'ambiguous') {
        safetyBlock = `\nINTERZIS: Nu presupune servicii. Nu folosi cuvântul "animator" dacă nu a fost explicit cerut. Nu da liste nesolicitate.`;
    } else {
        safetyBlock = `\nREGULĂ: Fii concret. Confirmă scurt ce ai înțeles din serviciile cerute.`;
    }

    // Progression context
    let progressionBlock = '';
    if (progression) {
        progressionBlock = `\n\n=== STADIU CONVERSATIE ===`;
        progressionBlock += `\nPas curent: ${progression.next_step}`;
        progressionBlock += `\nMotiv: ${progression.next_step_reason}`;
        progressionBlock += `\nStatus: ${progression.progression_status}`;
        progressionBlock += `\nCampuri completate: ${progression.completed_fields.join(', ') || 'niciunul'}`;
        progressionBlock += `\nCampuri lipsa: ${progression.missing_critical_count}`;
        if (progression.progression_status === 'ready_for_quote') {
            progressionBlock += `\n→ IMPORTANT: Toate informatiile sunt complete. Confirma cu clientul si anunta ca un coleg va reveni cu oferta.`;
        }
        if (progression.progression_status === 'confirming') {
            progressionBlock += `\n→ IMPORTANT: Tocmai s-a facut o modificare. Confirma schimbarea cu clientul.`;
        }
    }

    let playbookBlock = '';
    if (nextBestActionGoal && nextBestActionGoal.instruction && nextBestActionGoal.playbookKey) {
        // Extract the playbook injection from NBA instruction
        const match = nextBestActionGoal.instruction.match(/\[PLAYBOOK OVERRIDE[^\n]+/i);
        if (match) {
            playbookBlock = `\n\n=== OVERRIDE PLAYBOOK ADMIN (PRIORITATE MAXIMA) ===\n${match[0]}\nACEASTA ESTE REGULA ABSOLUTA PT ACEST RASPUNS! Ignora exemplele generice daca se contrazic cu ea.`;
        }
    }

    return `${style}
${cycleContext}
${contextBlock}
${progressionBlock}
${playbookBlock}

DRAFT INTERN (doar referinta, NU copia):
"${draftReply}"

${safetyBlock}

=== REGULI STRICTE ===

1. CONFIRMA CONCRET ce ai inteles — dar DOAR daca serviciile sunt CONFIRMATE in context.
   - Daca serviciile NU SUNT confirmate, NU le mentiona. Intreaba deschis.

2. IMPACT CRITIC: Daca "DRAFT INTERN" contine un raspuns oficial, ESTI OBLIGAT sa incluzi acea informatie exact asa cum este in reply-ul tau final!

3. INTERZIS: Nu presupune NICIODATA "animator" ca fallback/default.

4. INTREABA DOAR 1 lucru! Pune DOAR intrebarea urmatoare sau cere doar 1 detaliu critic. Restul se afla in mesajele urmatoare.

5. Fii Scurt — max 2-3 propozitii.

=== EXEMPLE COLAB/RECURENT (doar daca est caz special) ===
Colaborator: "Salut! Da, putem acoperi serviciul. Ce data exact?"
Recurent: "Buna! Ne bucuram ca reveniti! Petrecerea e tot la locatie?"

=== REPLY FINAL ===

Scrie DOAR mesajul final, fara explicatii, fara ghilimele, fara prefixuri.
Raspunde in ROMANA. MAX 2-3 propozitii.`;
}

/**
 * Detects the appropriate reply style based on context.
 */
export function detectReplyStyle({ entityMemory, salesCycle, conversationStage }) {
    if (salesCycle?.cycle_reason?.includes('closed_cycle')) {
        return 'returning_client';
    }
    if (entityMemory?.entity_type === 'collaborator' || entityMemory?.entity_type === 'partner') {
        return 'collaborator';
    }
    if (conversationStage === 'coordination' || conversationStage === 'booking') {
        return 'ops_followup';
    }
    return 'warm_sales';
}
