import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════════════════════
// GOAL STATE DEFINITIONS
// ═══════════════════════════════════════════════════════════

export const GOAL_STATES = {
    new_lead: {
        description: 'Conversație nouă, niciun context',
        allowedNext: ['greeting', 'discovery', 'service_selection'],
        nextBestAction: 'greet_and_discover',
    },
    greeting: {
        description: 'Client a salutat, nu a cerut nimic specific',
        allowedNext: ['discovery', 'service_selection', 'completed'],
        nextBestAction: 'ask_what_they_need',
    },
    discovery: {
        description: 'Discuție deschisă, încă nu știm ce vrea',
        allowedNext: ['service_selection', 'event_qualification', 'completed'],
        nextBestAction: 'discover_services',
    },
    service_selection: {
        description: 'Servicii detectate, în curs de confirmare',
        allowedNext: ['event_qualification', 'package_recommendation', 'discovery'],
        nextBestAction: 'confirm_services',
    },
    event_qualification: {
        description: 'Servicii confirmate, colectăm detalii eveniment',
        allowedNext: ['package_recommendation', 'service_selection', 'cancelled'],
        nextBestAction: 'ask_missing_event_details',
    },
    package_recommendation: {
        description: 'Detalii suficiente, recomandăm pachete',
        allowedNext: ['quotation_draft', 'event_qualification', 'objection_handling'],
        nextBestAction: 'recommend_packages',
    },
    quotation_draft: {
        description: 'Ofertă generată, în așteptare',
        allowedNext: ['quotation_sent', 'package_recommendation', 'objection_handling', 'cancelled'],
        nextBestAction: 'send_or_refine_quote',
    },
    quotation_sent: {
        description: 'Ofertă trimisă clientului',
        allowedNext: ['objection_handling', 'booking_pending', 'quotation_draft', 'cancelled'],
        nextBestAction: 'wait_for_client_decision',
    },
    objection_handling: {
        description: 'Client are obiecții (preț, dată, etc.)',
        allowedNext: ['quotation_draft', 'package_recommendation', 'booking_pending', 'cancelled'],
        nextBestAction: 'handle_objection',
    },
    booking_pending: {
        description: 'Client a acceptat, așteptăm confirmare finală',
        allowedNext: ['booking_confirmed', 'reschedule_pending', 'cancelled'],
        nextBestAction: 'confirm_booking',
    },
    booking_confirmed: {
        description: 'Rezervare confirmată',
        allowedNext: ['reschedule_pending', 'cancelled', 'completed'],
        nextBestAction: 'send_confirmation_recap',
    },
    reschedule_pending: {
        description: 'Client vrea să reprogrameze',
        allowedNext: ['event_qualification', 'booking_pending', 'cancelled'],
        nextBestAction: 'ask_new_date',
    },
    cancelled: {
        description: 'Eveniment anulat',
        allowedNext: ['discovery', 'service_selection'],
        nextBestAction: 'acknowledge_cancellation',
    },
    completed: {
        description: 'Conversație finalizată',
        allowedNext: ['discovery', 'service_selection'],
        nextBestAction: 'none',
    }
};

// ═══════════════════════════════════════════════════════════
// LOAD / PERSIST
// ═══════════════════════════════════════════════════════════

/**
 * Load current goal state for a conversation.
 * Returns the row or a default new_lead state.
 */
export async function loadGoalState(conversationId) {
    const { data, error } = await supabase
        .from('ai_goal_states')
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle();

    if (error) {
        console.error('[GoalState] Load error:', error.message);
    }

    if (data) return data;

    // Default: new_lead
    return {
        conversation_id: conversationId,
        current_state: 'new_lead',
        previous_state: null,
        state_confidence: 80,
        next_best_action: 'greet_and_discover',
        next_best_question: null,
        explanation_for_operator: 'Conversație nouă — așteptăm mesajul clientului.',
        blocking_reasons: [],
        entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        _isNew: true
    };
}

/**
 * Transition goal state. Validates transition, persists, logs history.
 *
 * @returns {{ transitioned: boolean, from: string, to: string, reason: string }}
 */
export async function transitionGoalState(conversationId, newState, {
    trigger = 'message',
    reason = '',
    confidence = 80,
    nextBestAction = null,
    nextBestQuestion = null,
    explanationForOperator = null,
    blockingReasons = [],
    metadata = {}
} = {}) {
    // Load current
    const current = await loadGoalState(conversationId);
    const fromState = current.current_state;

    // Same state — just update action/question, no transition
    if (fromState === newState) {
        await persistGoalState(conversationId, {
            current_state: newState,
            state_confidence: confidence,
            next_best_action: nextBestAction || GOAL_STATES[newState]?.nextBestAction,
            next_best_question: nextBestQuestion,
            explanation_for_operator: explanationForOperator,
            blocking_reasons: blockingReasons
        });
        return { transitioned: false, from: fromState, to: newState, reason: 'same_state_update' };
    }

    // Validate allowed transition
    const stateDef = GOAL_STATES[fromState];
    if (stateDef && !stateDef.allowedNext.includes(newState)) {
        console.warn(`[GoalState] Transition ${fromState} → ${newState} not allowed. Allowed: ${stateDef.allowedNext.join(', ')}`);
        // Still allow it but log as forced
        reason = `FORCED: ${reason} (expected: ${stateDef.allowedNext.join(', ')})`;
    }

    // Persist new state
    await persistGoalState(conversationId, {
        current_state: newState,
        previous_state: fromState,
        state_confidence: confidence,
        entered_at: new Date().toISOString(),
        next_best_action: nextBestAction || GOAL_STATES[newState]?.nextBestAction,
        next_best_question: nextBestQuestion,
        explanation_for_operator: explanationForOperator,
        blocking_reasons: blockingReasons
    });

    // Log to history
    await logGoalTransition(conversationId, {
        from_state: fromState,
        to_state: newState,
        trigger,
        reason,
        confidence,
        metadata_json: metadata
    });

    console.log(`[GoalState] ${fromState} → ${newState} (trigger=${trigger}, reason=${reason})`);
    return { transitioned: true, from: fromState, to: newState, reason };
}

/**
 * Persist goal state (upsert).
 */
async function persistGoalState(conversationId, fields) {
    const { error } = await supabase
        .from('ai_goal_states')
        .upsert({
            conversation_id: conversationId,
            ...fields,
            updated_at: new Date().toISOString(),
            updated_by: 'ai'
        }, { onConflict: 'conversation_id' });

    if (error) {
        console.error('[GoalState] Persist error:', error.message);
    }
}

/**
 * Log a goal state transition to history.
 */
async function logGoalTransition(conversationId, entry) {
    const { error } = await supabase
        .from('ai_goal_state_history')
        .insert({
            conversation_id: conversationId,
            ...entry
        });

    if (error) {
        console.error('[GoalState] History insert error:', error.message);
    }
}

/**
 * Get state metadata (entry conditions, next_best_action template, etc.)
 */
export function getStateMetadata(stateKey) {
    return GOAL_STATES[stateKey] || null;
}
