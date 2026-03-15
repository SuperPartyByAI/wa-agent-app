import crypto from 'crypto';
import {
    AI_WAVE1_TRAFFIC_PERCENT,
    AI_WAVE1_ALLOWED_CHANNELS,
    AI_WAVE1_ENABLED,
    AI_SAFE_AUTOREPLY_ENABLED
} from '../config/env.mjs';

/**
 * Wave 1 Controller — Phase 4
 * 
 * Controls traffic allocation (deterministic cohorting) and
 * Wave 1 eligibility guards for safe autoreply.
 */

// ── Deterministic Bucketing ──
// Hash-based: same conversation_id always maps to same bucket (0-99).
function hashBucket(id) {
    const hash = crypto.createHash('md5').update(id).digest('hex');
    return parseInt(hash.substring(0, 8), 16) % 100;
}

/**
 * Check if a conversation should be included in Wave 1 cohort.
 * @param {string} conversationId
 * @param {string} clientId
 * @param {string} channel - 'whatsapp', 'web', etc.
 * @returns {{ included: boolean, bucket: number, reason: string }}
 */
export function shouldIncludeInWave1(conversationId, clientId, channel = 'whatsapp') {
    // Global kill switch
    if (!AI_WAVE1_ENABLED || !AI_SAFE_AUTOREPLY_ENABLED) {
        return { included: false, bucket: -1, reason: 'wave1_disabled' };
    }

    // Channel filter
    if (AI_WAVE1_ALLOWED_CHANNELS.length > 0 && !AI_WAVE1_ALLOWED_CHANNELS.includes(channel)) {
        return { included: false, bucket: -1, reason: `channel_excluded: ${channel}` };
    }

    // Deterministic bucket
    const bucket = hashBucket(conversationId);
    const included = bucket < AI_WAVE1_TRAFFIC_PERCENT;

    return {
        included,
        bucket,
        reason: included
            ? `cohort_included: bucket=${bucket} < ${AI_WAVE1_TRAFFIC_PERCENT}%`
            : `cohort_excluded: bucket=${bucket} >= ${AI_WAVE1_TRAFFIC_PERCENT}%`
    };
}

/**
 * Wave 1 eligibility guards — 8 checks.
 * Only allows the safest possible autoreplies.
 * 
 * @param {object} params
 * @returns {{ eligible: boolean, blockers: string[] }}
 */
export function isWave1Eligible({
    safetyClass,
    decision,
    toolAction,
    goalState,
    escalation,
    relationshipData,
    mutation,
    ambiguityDetected = false,
    identityUncertain = false
}) {
    const blockers = [];

    // 1. Must be safe_autoreply_allowed
    if (safetyClass !== 'safe_autoreply_allowed') {
        blockers.push(`safety_class: ${safetyClass}`);
    }

    // 2. Tool must be reply_only or update_event_plan
    const toolName = toolAction?.name || toolAction;
    if (toolName && toolName !== 'reply_only' && toolName !== 'update_event_plan') {
        blockers.push(`tool_not_allowed: ${toolName}`);
    }

    // 3. Stage must be in Wave 1 allowed stages
    const ALLOWED_STAGES = ['new_lead', 'greeting', 'discovery', 'event_qualification'];
    const stage = goalState?.current_state || decision?.conversation_stage;
    if (stage && !ALLOWED_STAGES.includes(stage)) {
        blockers.push(`stage_not_allowed: ${stage}`);
    }

    // 4. Confidence must meet minimum
    if (decision?.confidence_score < 75) {
        blockers.push(`confidence_low: ${decision?.confidence_score}`);
    }

    // 5. No booking/quote mutation
    if (mutation?.mutation_type && mutation.mutation_type !== 'no_mutation') {
        blockers.push(`mutation_active: ${mutation.mutation_type}`);
    }

    // 6. No ambiguity
    if (ambiguityDetected) {
        blockers.push('ambiguity_detected');
    }

    // 7. No identity uncertainty
    if (identityUncertain) {
        blockers.push('identity_uncertain');
    }

    // 8. No escalation
    if (escalation?.needs_escalation) {
        blockers.push(`escalation: ${escalation.escalation_reason}`);
    }

    // 9. No active booking conflict
    if (relationshipData?.hasActiveBooking) {
        blockers.push('active_booking_conflict');
    }

    return { eligible: blockers.length === 0, blockers };
}
