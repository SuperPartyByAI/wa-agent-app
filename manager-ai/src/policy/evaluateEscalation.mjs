/**
 * Escalation Engine
 *
 * Evaluates whether the AI should stop and hand off to a human operator.
 * Returns a clear, auditable escalation decision.
 *
 * @param {object} params
 * @param {object} params.decision            - LLM decision object
 * @param {object} params.mutation            - from detectEventMutation()
 * @param {object} params.autonomy            - from evaluateAutonomy()
 * @param {object} params.progression         - from evaluateNextStep()
 * @param {object} params.serviceConfidence   - from evaluateServiceConfidence()
 * @param {object} params.analysis            - full LLM analysis
 * @param {string} params.conversationStage   - current conversation stage
 * @param {string} params.lastClientMessage   - latest message from client
 * @returns {object} escalation decision
 */
export function evaluateEscalation({
    decision,
    mutation,
    autonomy,
    progression,
    serviceConfidence,
    analysis,
    conversationStage,
    lastClientMessage
}) {
    const reasons = [];
    let escalationType = null;
    let recommendedAction = null;

    const confidence = decision?.confidence_score || 0;
    const stage = conversationStage || decision?.conversation_stage || 'lead';
    const msg = (lastClientMessage || '').toLowerCase();

    // ── 1. Autonomy policy says blocked ──
    if (autonomy && !autonomy.action_autonomy_allowed && autonomy.autonomy_level === 'blocked') {
        reasons.push(`Politica de autonomie: ${autonomy.autonomy_decision_reason}`);
        escalationType = 'policy';
        recommendedAction = `Verifică acțiunea "${autonomy.effective_action}" și aprobă manual.`;
    }

    // ── 2. Ready for quote (all info collected) ──
    if (progression?.progression_status === 'ready_for_quote') {
        reasons.push('Toate informațiile critice sunt completate — pregătit pentru ofertă.');
        escalationType = escalationType || 'policy';
        recommendedAction = recommendedAction || 'Pregătește oferta și trimite-o clientului.';
    }

    // ── 3. LLM explicitly says needs human review ──
    if (decision?.needs_human_review && !decision?.can_auto_reply) {
        reasons.push('LLM: needs_human_review=true');
        escalationType = escalationType || 'confidence';
    }

    // ── 4. LLM escalation reason ──
    if (decision?.escalation_reason) {
        reasons.push(`LLM escalation: ${decision.escalation_reason}`);
        escalationType = escalationType || 'confidence';
        recommendedAction = recommendedAction || decision.escalation_reason;
    }

    // ── 5. Low confidence on mutation ──
    if (mutation && mutation.mutation_type !== 'no_mutation' && (mutation.mutation_confidence || 0) < 50) {
        reasons.push(`Mutație "${mutation.mutation_type}" cu confidence scăzut (${mutation.mutation_confidence}).`);
        escalationType = escalationType || 'confidence';
        recommendedAction = recommendedAction || `Verifică mutația "${mutation.mutation_type}" manual.`;
    }

    // ── 6. Sentiment detection (basic) ──
    const negativePatterns = [
        /nemul[tț]umit/i, /nervos/i, /suparat/i, /dezamagit/i,
        /nu (e|este) ok/i, /reclamatie/i, /plangere/i,
        /nu merge/i, /e prost/i, /ramburs/i, /banii inapoi/i,
        /nu (sunt|suntem) (de acord|multumit)/i
    ];
    if (negativePatterns.some(p => p.test(msg))) {
        reasons.push('Sentiment negativ detectat în mesajul clientului.');
        escalationType = escalationType || 'sentiment';
        recommendedAction = recommendedAction || 'Client potențial nemulțumit — verifică manual.';
    }

    // ── 7. Sensitive stages ──
    const SENSITIVE_STAGES = ['booking', 'payment', 'coordination'];
    if (SENSITIVE_STAGES.includes(stage)) {
        reasons.push(`Conversație în stadiu sensibil: "${stage}".`);
        escalationType = escalationType || 'policy';
        recommendedAction = recommendedAction || `Stadiu sensibil "${stage}" — operatorul ar trebui să continue.`;
    }

    // ── 8. Persistent service ambiguity ──
    const svcStatus = serviceConfidence?.service_detection_status || 'unknown';
    if (svcStatus === 'ambiguous' && (serviceConfidence?.ambiguous_services?.length || 0) > 2) {
        reasons.push('Ambiguitate persistentă pe servicii (>2 servicii ambigue).');
        escalationType = escalationType || 'complexity';
        recommendedAction = recommendedAction || 'Clarifică serviciile manual cu clientul.';
    }

    // ── 9. Payment/booking keywords ──
    const paymentPatterns = [
        /plat[aă]/i, /achit/i, /transfer/i, /factur[aă]/i,
        /confirm[aă]m/i, /book/i, /rezerv/i
    ];
    if (paymentPatterns.some(p => p.test(msg)) && stage !== 'lead' && stage !== 'qualifying') {
        reasons.push('Mesaj legat de plată/booking — necesită operator.');
        escalationType = escalationType || 'policy';
        recommendedAction = recommendedAction || 'Client vrea să confirme/plătească — procesează manual.';
    }

    // ── Build result ──
    const needsEscalation = reasons.length > 0;

    return {
        needs_escalation: needsEscalation,
        escalation_reason: needsEscalation ? reasons.join(' | ') : null,
        escalation_type: escalationType,
        escalation_reasons_list: reasons,
        recommended_operator_action: recommendedAction
    };
}
