import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNextBestAction } from '../src/workflow/evaluateNextBestAction.mjs';

describe('Next Best Action Engine', () => {

    it('greeting state → greet_and_discover', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'greeting' },
            eventPlan: {},
            quoteState: null,
            kbMatch: null,
            escalation: { needs_escalation: false },
            humanTakeover: false,
            services: { selected: [], detection_status: 'unknown' }
        });
        assert.equal(result.action, 'greet_and_discover');
    });

    it('event_qualification with missing fields → ask_field', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'event_qualification' },
            eventPlan: { missing_fields: ['guest_count', 'event_time'] },
            quoteState: null,
            kbMatch: null,
            escalation: { needs_escalation: false },
            humanTakeover: false,
            services: { selected: ['animator'] }
        });
        assert.equal(result.action, 'ask_guest_count');
        assert.ok(result.question.length > 0);
    });

    it('human takeover → defer', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'event_qualification' },
            eventPlan: {},
            quoteState: null,
            kbMatch: null,
            escalation: { needs_escalation: false },
            humanTakeover: true,
            services: { selected: ['animator'] }
        });
        assert.equal(result.action, 'defer_to_operator');
    });

    it('escalation → escalate', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'event_qualification' },
            eventPlan: {},
            quoteState: null,
            kbMatch: null,
            escalation: { needs_escalation: true, escalation_reason: 'Nemulțumire' },
            humanTakeover: false,
            services: { selected: ['animator'] }
        });
        assert.equal(result.action, 'escalate_to_operator');
    });

    it('KB match with high score → answer_from_kb', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'discovery' },
            eventPlan: {},
            quoteState: null,
            kbMatch: { score: 0.85, knowledgeKey: 'animator_packages' },
            escalation: { needs_escalation: false },
            humanTakeover: false,
            services: { selected: [] }
        });
        assert.equal(result.action, 'answer_from_knowledge_base');
    });

    it('quotation_draft with draft quote → send_quote', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'quotation_draft' },
            eventPlan: {},
            quoteState: { status: 'draft' },
            kbMatch: null,
            escalation: { needs_escalation: false },
            humanTakeover: false,
            services: { selected: ['animator'] }
        });
        assert.equal(result.action, 'send_quote');
    });

    it('event_qualification with all filled → recommend_packages', () => {
        const result = evaluateNextBestAction({
            goalState: { current_state: 'event_qualification' },
            eventPlan: { missing_fields: [] },
            quoteState: null,
            kbMatch: null,
            escalation: { needs_escalation: false },
            humanTakeover: false,
            services: { selected: ['animator'] }
        });
        assert.equal(result.action, 'recommend_packages');
    });
});
