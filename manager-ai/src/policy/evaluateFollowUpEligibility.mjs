/**
 * Evaluate Follow-Up Eligibility
 *
 * Determines whether a conversation is eligible for a deferred follow-up
 * after a wait/silence decision.
 *
 * Guards:
 * - No follow-up on ack/silence decisions
 * - No follow-up on closing signals (pure)
 * - No follow-up on customer paused
 * - No follow-up on human takeover
 * - No follow-up on closed/booked/escalated/blocked conversations
 * - Max 1 follow-up per unresolved customer turn
 */

const QUESTION_PATTERNS = [
    /\?$/,
    /cat costa/i, /cât costă/i, /ce pret/i, /ce preț/i,
    /aveti/i, /aveți/i, /exista/i, /există/i,
    /puteti/i, /puteți/i, /se poate/i,
    /cand/i, /când/i, /unde/i, /cum/i,
    /vreau/i, /doresc/i, /as vrea/i, /aș vrea/i,
    /ma intereseaza/i, /mă interesează/i,
    /cautam/i, /căutăm/i,
    /pentru.*petrecere/i, /pentru.*eveniment/i, /pentru.*nunta/i,
    /animator/i, /popcorn/i, /vata.*zahar/i, /ursitoare/i,
    /cifre.*volumetrice/i, /arcada/i, /baloane/i,
    /mos.*craciun/i, /gheata.*carbonica/i, /parfumerie/i
];

const MISSING_FIELD_CHECKS = [
    { field: 'event_date', patterns: [/\d{1,2}\s*(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec)/i, /\d{1,2}[./-]\d{1,2}/] },
    { field: 'location', patterns: [/bucuresti|bucharest|sector|strada|adresa|locatie|locație|oras|oraș|comuna/i] },
    { field: 'guest_count', patterns: [/\d+\s*(copii|persoane|invitati|oaspeti)/i, /cati copii|câți copii/i] },
    { field: 'event_time', patterns: [/ora\s*\d|de la\s*\d|\d{1,2}:\d{2}/i] },
];

/**
 * @param {object} params
 * @param {string} params.replyDecision
 * @param {string} params.lastClientMessage
 * @param {string} params.conversationStage
 * @param {object} [params.existingDraft]
 * @param {string} [params.nextStep]
 * @param {string} [params.conversationStatus]
 * @param {boolean} [params.closingSignalDetected]
 * @param {boolean} [params.customerPausedDetected]
 * @param {boolean} [params.humanTakeoverActive]
 * @param {boolean} [params.aiCommitmentPending]
 * @returns {object}
 */
export function evaluateFollowUpEligibility({
    replyDecision,
    lastClientMessage,
    conversationStage,
    existingDraft,
    nextStep,
    conversationStatus,
    closingSignalDetected = false,
    customerPausedDetected = false,
    humanTakeoverActive = false,
    aiCommitmentPending = false
}) {
    const result = {
        eligible: false,
        reason: 'not_eligible',
        followUpType: null,
        openQuestionDetected: false,
        customerIntentUnanswered: false,
        missingFields: [],
        closingSignalDetected,
        customerPausedDetected,
        humanTakeoverActive,
        aiCommitmentPending
    };

    // ── Guard: only for wait decisions ──
    if (!['wait_for_more_messages', 'wait_for_missing_info'].includes(replyDecision)) {
        return { ...result, reason: 'not_a_wait_decision' };
    }

    // ── Guard: no follow-up on human takeover ──
    if (humanTakeoverActive) {
        return { ...result, reason: 'blocked_human_takeover' };
    }

    // ── Guard: no follow-up on customer paused ──
    if (customerPausedDetected) {
        return { ...result, reason: 'blocked_customer_paused' };
    }

    // ── Guard: no follow-up on closing signal (pure, without open question) ──
    if (closingSignalDetected) {
        return { ...result, reason: 'blocked_closing_signal' };
    }

    // ── Guard: no follow-up on blocked conversation states ──
    const BLOCKED_STATUSES = ['closed', 'booked', 'blocked', 'escalated', 'archived', 'confirmed', 'completed'];
    if (conversationStatus && BLOCKED_STATUSES.includes(conversationStatus)) {
        return { ...result, reason: `blocked_status_${conversationStatus}` };
    }

    // ── Detect open question / customer intent ──
    const msg = lastClientMessage || '';
    const hasQuestion = QUESTION_PATTERNS.some(p => p.test(msg));
    const hasServiceIntent = /animator|popcorn|vata|ursitoare|arcada|baloane|cifre|mos|gheata|parfumerie/i.test(msg);
    const hasEventIntent = /petrecere|eveniment|nunta|botez|aniversare|serbare|party|zi de nastere/i.test(msg);

    result.openQuestionDetected = hasQuestion;
    result.customerIntentUnanswered = hasServiceIntent || hasEventIntent;

    // ── Detect missing fields ──
    const allMsgText = msg.toLowerCase();
    for (const check of MISSING_FIELD_CHECKS) {
        const hasField = check.patterns.some(p => p.test(allMsgText));
        if (!hasField) {
            result.missingFields.push(check.field);
        }
    }

    // ── AI commitment pending is also valid for follow-up ──
    if (aiCommitmentPending) {
        result.eligible = true;
        result.followUpType = replyDecision;
        result.reason = 'eligible_ai_commitment_pending';
        return result;
    }

    // ── Determine eligibility ──
    if (replyDecision === 'wait_for_missing_info') {
        result.eligible = true;
        result.followUpType = 'wait_for_missing_info';
        result.reason = 'eligible_missing_info';
        return result;
    }

    // wait_for_more_messages — eligible only if real question/intent
    if (hasQuestion || hasServiceIntent || hasEventIntent) {
        result.eligible = true;
        result.followUpType = 'wait_for_more_messages';
        result.reason = hasQuestion ? 'eligible_open_question' : 'eligible_unanswered_intent';
        return result;
    }

    return { ...result, reason: 'no_open_question_or_intent' };
}
