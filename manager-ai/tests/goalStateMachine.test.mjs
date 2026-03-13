import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoalTransition } from '../src/workflow/goalTransitions.mjs';

describe('Goal State Transitions', () => {

    it('new_lead + greeting → greeting', () => {
        const result = evaluateGoalTransition({
            currentState: 'new_lead',
            isGreeting: true,
            lastClientMessage: 'Bună seara',
            services: { selected: [] },
            eventPlan: null,
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'greeting');
    });

    it('new_lead + services → service_selection', () => {
        const result = evaluateGoalTransition({
            currentState: 'new_lead',
            isGreeting: false,
            lastClientMessage: 'Vreau animator și popcorn',
            services: { selected: ['animator', 'popcorn'] },
            eventPlan: null,
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'service_selection');
    });

    it('greeting + no service → discovery', () => {
        const result = evaluateGoalTransition({
            currentState: 'greeting',
            isGreeting: false,
            lastClientMessage: 'Am nevoie de ceva pentru petrecere',
            services: { selected: [] },
            eventPlan: null,
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'discovery');
    });

    it('discovery + services → service_selection', () => {
        const result = evaluateGoalTransition({
            currentState: 'discovery',
            isGreeting: false,
            lastClientMessage: 'Vreau animator',
            services: { selected: ['animator'] },
            eventPlan: null,
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'service_selection');
    });

    it('service_selection + date → event_qualification', () => {
        const result = evaluateGoalTransition({
            currentState: 'service_selection',
            isGreeting: false,
            lastClientMessage: 'pe 20 aprilie în București',
            services: { selected: ['animator'] },
            eventPlan: { requested_services: ['animator'], event_date: '20 aprilie', location: 'București' },
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'event_qualification');
    });

    it('event_qualification + ready → package_recommendation', () => {
        const result = evaluateGoalTransition({
            currentState: 'event_qualification',
            isGreeting: false,
            lastClientMessage: '18 copii, fetița face 6 ani',
            services: { selected: ['animator'] },
            eventPlan: { readiness_for_quote: true },
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'package_recommendation');
    });

    it('cancel intent → cancelled', () => {
        const result = evaluateGoalTransition({
            currentState: 'event_qualification',
            isGreeting: false,
            lastClientMessage: 'Anulăm petrecerea',
            services: { selected: [] },
            eventPlan: {},
            analysis: {},
            mutation: { mutation_type: 'cancel_event' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'cancelled');
    });

    it('quotation_sent + accept → booking_pending', () => {
        const result = evaluateGoalTransition({
            currentState: 'quotation_sent',
            isGreeting: false,
            lastClientMessage: 'Da, confirmăm',
            services: { selected: ['animator'] },
            eventPlan: {},
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'booking_pending');
    });

    it('quotation_sent + objection → objection_handling', () => {
        const result = evaluateGoalTransition({
            currentState: 'quotation_sent',
            isGreeting: false,
            lastClientMessage: 'E prea scump, aveți alt preț?',
            services: { selected: ['animator'] },
            eventPlan: {},
            analysis: {},
            mutation: { mutation_type: 'no_mutation' }
        });
        assert.equal(result.shouldTransition, true);
        assert.equal(result.newState, 'objection_handling');
    });
});
