/**
 * Next Best Action Engine
 *
 * Determines the optimal next action for the AI agent based on:
 * - Goal state
 * - Event plan completeness
 * - Quote state
 * - Knowledge base match
 * - Escalation / human takeover status
 */

/**
 * @param {object} params
 * @param {object} params.goalState       - from loadGoalState()
 * @param {object} params.eventPlan       - from loadOrCreateEventPlan()
 * @param {object} params.quoteState      - latest ai_quotes row or null
 * @param {object} params.kbMatch         - from knowledgeMatcher
 * @param {object} params.escalation      - from evaluateEscalation()
 * @param {boolean} params.humanTakeover  - is operator active?
 * @param {object} params.services        - detected services info
 * @returns {{ action: string, question: string|null, explanation: string, priority: string }}
 */
export function evaluateNextBestAction({
    goalState,
    eventPlan,
    quoteState,
    kbMatch,
    escalation,
    humanTakeover = false,
    services
}) {
    const state = goalState?.current_state || 'new_lead';
    const plan = eventPlan || {};

    // ── Human takeover → defer ──
    if (humanTakeover) {
        return {
            action: 'defer_to_operator',
            question: null,
            explanation: 'Operatorul a preluat conversația.',
            priority: 'low'
        };
    }

    // ── Escalation needed → escalate ──
    if (escalation?.needs_escalation) {
        return {
            action: 'escalate_to_operator',
            question: null,
            explanation: `Escalare: ${escalation.escalation_reason}`,
            priority: 'high'
        };
    }

    // ── KB factual query → answer from KB ──
    if (kbMatch && kbMatch.score >= 0.75) {
        return {
            action: 'answer_from_knowledge_base',
            question: null,
            explanation: `Răspuns factual din KB: ${kbMatch.knowledgeKey} (scor ${kbMatch.score.toFixed(2)})`,
            priority: 'high'
        };
    }

    // ── State-specific actions ──
    switch (state) {
        case 'new_lead':
        case 'greeting':
            return {
                action: 'greet_and_discover',
                question: 'Cu ce vă putem ajuta?',
                explanation: 'Client nou — întrebăm ce servicii dorește.',
                priority: 'medium'
            };

        case 'discovery':
            return {
                action: 'discover_services',
                question: 'Ce tip de eveniment planificați? Ce servicii vă interesează?',
                explanation: 'Nu cunoaștem încă serviciile dorite.',
                priority: 'medium'
            };

        case 'service_selection':
            return {
                action: 'confirm_services',
                question: `Am înțeles că doriți: ${(plan.requested_services || []).join(', ')}. Este corect?`,
                explanation: 'Servicii detectate, așteptăm confirmare.',
                priority: 'medium'
            };

        case 'event_qualification': {
            // Find what's missing
            const missing = plan.missing_fields || [];
            const missingLabels = {
                event_date: 'data evenimentului',
                location: 'locația',
                guest_count: 'câți copii/invitați',
                child_age: 'vârsta copilului',
                event_time: 'ora'
            };

            if (missing.length > 0) {
                const firstMissing = missing[0];
                const label = missingLabels[firstMissing] || firstMissing;
                return {
                    action: `ask_${firstMissing}`,
                    question: `Ne puteți spune ${label}?`,
                    explanation: `Lipsesc ${missing.length} detalii: ${missing.join(', ')}`,
                    priority: 'high'
                };
            }

            // All filled → move to recommendation
            return {
                action: 'recommend_packages',
                question: null,
                explanation: 'Toate detaliile sunt completate. Putem recomanda pachete.',
                priority: 'high'
            };
        }

        case 'package_recommendation': {
            const svcList = (plan.requested_services || []).join(', ');
            return {
                action: 'recommend_packages',
                question: null,
                explanation: `Recomandăm pachete pentru: ${svcList}. Așteptăm selecție.`,
                priority: 'high'
            };
        }

        case 'quotation_draft': {
            if (quoteState?.status === 'draft') {
                return {
                    action: 'send_quote',
                    question: 'Să vă trimit propunerea detaliată?',
                    explanation: 'Ofertă draft pregătită. Așteptăm aprobarea de trimis.',
                    priority: 'high'
                };
            }
            return {
                action: 'generate_quote_draft',
                question: null,
                explanation: 'Generăm oferta pe baza planului de eveniment.',
                priority: 'high'
            };
        }

        case 'quotation_sent':
            return {
                action: 'wait_for_client_decision',
                question: null,
                explanation: 'Ofertă trimisă. Așteptăm răspunsul clientului.',
                priority: 'low'
            };

        case 'objection_handling':
            return {
                action: 'handle_objection',
                question: null,
                explanation: 'Clientul are obiecții. Oferim alternative sau clarificări.',
                priority: 'high'
            };

        case 'booking_pending':
            return {
                action: 'confirm_booking',
                question: 'Confirmăm totul? Vă trimit un rezumat.',
                explanation: 'Client a acceptat. Așteptăm confirmare finală.',
                priority: 'high'
            };

        case 'booking_confirmed':
            return {
                action: 'send_confirmation_recap',
                question: null,
                explanation: 'Rezervare confirmată. Trimitem recap.',
                priority: 'medium'
            };

        case 'reschedule_pending':
            return {
                action: 'ask_new_date',
                question: 'Pe ce dată doriți să reprogramăm?',
                explanation: 'Client vrea reprogramare. Întrebăm noua dată.',
                priority: 'high'
            };

        case 'cancelled':
            return {
                action: 'acknowledge_cancellation',
                question: null,
                explanation: 'Evenimentul a fost anulat.',
                priority: 'low'
            };

        case 'completed':
            return {
                action: 'none',
                question: null,
                explanation: 'Conversație finalizată.',
                priority: 'low'
            };

        default:
            return {
                action: 'discover_services',
                question: 'Cu ce vă putem ajuta?',
                explanation: 'Stare necunoscută — revenim la discovery.',
                priority: 'medium'
            };
    }
}
