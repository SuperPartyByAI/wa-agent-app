/**
 * Evaluate Follow-Up Eligibility
 *
 * Determines whether a conversation is eligible for a deferred follow-up
 * after a wait/silence decision.
 *
 * Returns:
 *   eligible: boolean
 *   reason: string
 *   followUpType: 'wait_for_more_messages' | 'wait_for_missing_info' | null
 *   openQuestionDetected: boolean
 *   customerIntentUnanswered: boolean
 *   missingFields: string[]
 */

const QUESTION_PATTERNS = [
    /\?$/,
    /cat costa/i, /cât costă/i, /ce pret/i, /ce preț/i,
    /aveti/i, /aveți/i, /exista/i, /există/i,
    /puteti/i, /puteți/i, /se poate/i,
    /cand/i, /când/i, /unde/i, /cum/i,
    /vreau/i, /doresc/i, /as vrea/i, /aș vrea/i,
    /ma intereseaza/i, /mă interesează/i,
    /cautam/i, /căutăm/i, /cautati/i,
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

export function evaluateFollowUpEligibility({
    replyDecision,
    lastClientMessage,
    conversationStage,
    existingDraft,
    nextStep,
    conversationStatus
}) {
    const result = {
        eligible: false,
        reason: 'not_eligible',
        followUpType: null,
        openQuestionDetected: false,
        customerIntentUnanswered: false,
        missingFields: []
    };

    // ── Guard: only for wait decisions ──
    if (!['wait_for_more_messages', 'wait_for_missing_info', 'stay_silent'].includes(replyDecision)) {
        return { ...result, reason: 'not_a_wait_decision' };
    }

    // ── Guard: no follow-up on ack/silence decisions ──
    if (replyDecision === 'stay_silent') {
        return { ...result, reason: 'stay_silent_no_followup' };
    }

    // ── Guard: no follow-up on closed/booked/escalated conversations ──
    const BLOCKED_STATUSES = ['closed', 'booked', 'blocked', 'escalated', 'archived'];
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

    // ── Determine follow-up type ──
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

/**
 * Detect if the current context warrants wait_for_missing_info
 * instead of the normal reply decision.
 *
 * Called from shouldReplyNow to upgrade wait decisions.
 */
export function detectMissingInfo({ lastClientMessage, nextStep, existingDraft }) {
    const msg = (lastClientMessage || '').toLowerCase();

    // Client has real intent but missing critical info
    const hasIntent = /animator|popcorn|vata|ursitoare|petrecere|eveniment|nunta|botez|serbare/i.test(msg);
    if (!hasIntent) return { isMissingInfo: false };

    const missingFields = [];
    for (const check of MISSING_FIELD_CHECKS) {
        const hasField = check.patterns.some(p => p.test(msg));
        if (!hasField) missingFields.push(check.field);
    }

    // If draft already has some fields, don't count those as missing
    if (existingDraft) {
        if (existingDraft.event_date) missingFields.splice(missingFields.indexOf('event_date'), 1);
        if (existingDraft.location) missingFields.splice(missingFields.indexOf('location'), 1);
    }

    const filtered = missingFields.filter(f => f); // remove -1 artifacts
    return {
        isMissingInfo: filtered.length >= 2,
        missingFields: filtered
    };
}
