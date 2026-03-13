/**
 * AI Analytics Event Recorder
 *
 * Lightweight fire-and-forget event recording for observability.
 * Events are persisted to ai_analytics_events for queryable analytics.
 *
 * Usage:
 *   import { recordEvent } from '../analytics/recordAiEvent.mjs';
 *   recordEvent('kb_match_found', conversationId, { knowledgeKey, score, mode });
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Record a single analytics event. Fire-and-forget.
 *
 * @param {string} eventType — e.g. kb_match_found, decision_reply_now
 * @param {string|null} conversationId
 * @param {object} [payload] — event-specific data
 */
export function recordEvent(eventType, conversationId, payload = {}) {
    supabase.from('ai_analytics_events')
        .insert({
            event_type: eventType,
            conversation_id: conversationId || null,
            payload
        })
        .then(({ error }) => {
            if (error) console.warn(`[Analytics] Insert error for ${eventType}:`, error.message);
        })
        .catch(() => {});
}

/**
 * Record a KB miss for gap analysis. Fire-and-forget.
 */
export function recordKbMiss(conversationId, clientMessage, bestScore, detectedServices) {
    supabase.from('ai_kb_misses')
        .insert({
            conversation_id: conversationId || null,
            client_message: (clientMessage || '').substring(0, 500),
            best_score: bestScore || 0,
            detected_services: detectedServices || []
        })
        .then(({ error }) => {
            if (error) console.warn('[Analytics] KB miss insert error:', error.message);
        })
        .catch(() => {});
}

/**
 * Batch-record multiple events. Fire-and-forget.
 */
export function recordEvents(events) {
    if (!events || events.length === 0) return;
    supabase.from('ai_analytics_events')
        .insert(events.map(e => ({
            event_type: e.type,
            conversation_id: e.conversationId || null,
            payload: e.payload || {}
        })))
        .then(({ error }) => {
            if (error) console.warn('[Analytics] Batch insert error:', error.message);
        })
        .catch(() => {});
}
