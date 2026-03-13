import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEventPlan, extractEventPlanUpdates } from '../src/events/eventPlanEvaluator.mjs';

describe('Event Plan Evaluator', () => {

    it('empty plan → all fields missing', () => {
        const result = evaluateEventPlan({});
        assert.equal(result.missingFields.length, 5);
        assert.equal(result.readinessForQuote, false);
        assert.equal(result.readinessForBooking, false);
        assert.equal(result.completionPercent, 0);
    });

    it('partial plan → correct missing fields', () => {
        const result = evaluateEventPlan({
            requested_services: ['animator'],
            event_date: '20 aprilie',
            location: 'București'
        });
        assert.equal(result.missingFields.length, 2);
        assert.ok(result.missingFields.includes('guest_count'));
        assert.ok(result.missingFields.includes('event_time'));
        assert.equal(result.readinessForQuote, true); // has services + date + location
        assert.equal(result.readinessForBooking, false);
    });

    it('complete plan → ready for quote', () => {
        const result = evaluateEventPlan({
            requested_services: ['animator'],
            event_date: '20 aprilie',
            location: 'București',
            guest_count: 18,
            event_time: '16:00'
        });
        assert.equal(result.missingFields.length, 0);
        assert.equal(result.readinessForQuote, true);
        assert.equal(result.completionPercent, 100);
    });

    it('complete plan + package → ready for booking', () => {
        const result = evaluateEventPlan({
            requested_services: ['animator'],
            event_date: '20 aprilie',
            location: 'București',
            guest_count: 18,
            event_time: '16:00',
            selected_package: { package: 3, service: 'animator' }
        });
        assert.equal(result.readinessForQuote, true);
        assert.equal(result.readinessForBooking, true);
    });

    it('null plan → full defaults', () => {
        const result = evaluateEventPlan(null);
        assert.equal(result.confidence, 0);
        assert.equal(result.readinessForQuote, false);
        assert.equal(result.completionPercent, 0);
    });
});

describe('Extract Event Plan Updates', () => {

    it('extracts date + location from LLM analysis', () => {
        const analysis = {
            event_draft: {
                structured_data: {
                    date: '20 aprilie',
                    location: 'București'
                }
            },
            selected_services: ['animator']
        };
        const updates = extractEventPlanUpdates(analysis, {});
        assert.equal(updates.event_date, '20 aprilie');
        assert.equal(updates.location, 'București');
        assert.deepEqual(updates.requested_services, ['animator']);
    });

    it('extracts guest count from numar_copii', () => {
        const analysis = {
            event_draft: {
                structured_data: {
                    numar_copii: '18'
                }
            },
            selected_services: []
        };
        const updates = extractEventPlanUpdates(analysis, {});
        assert.equal(updates.guest_count, 18);
    });

    it('merges services with existing', () => {
        const analysis = {
            event_draft: { structured_data: {} },
            selected_services: ['popcorn']
        };
        const updates = extractEventPlanUpdates(analysis, {
            requested_services: ['animator']
        });
        assert.deepEqual(updates.requested_services.sort(), ['animator', 'popcorn']);
    });

    it('skips null values from LLM', () => {
        const analysis = {
            event_draft: {
                structured_data: {
                    date: 'null',
                    location: null
                }
            },
            selected_services: []
        };
        const updates = extractEventPlanUpdates(analysis, {});
        assert.equal(updates.event_date, undefined);
        assert.equal(updates.location, undefined);
    });
});
