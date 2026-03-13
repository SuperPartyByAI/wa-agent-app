/**
 * The Action Registry defines all permitted tool actions the AI Agent can emit.
 * Each action includes its strict JSON Schema, execution policy rules, and risk level.
 */

export const ActionRiskLevel = {
    SAFE: 'safe',                 // E.g. reply, add notes. Can happen anytime.
    MODERATE: 'moderate',         // E.g. update event plan. Needs basic context sync.
    HIGH: 'high',                 // E.g. confirm booking, archive. Needs rigorous Goal State checks.
    CRITICAL: 'critical'          // E.g. override, delete. Needs Human confirmation.
};

export const ACTION_REGISTRY = {
    reply_only: {
        description: 'Used when the agent only needs to converse, answer questions, or ask for clarifications without modifying any database records.',
        riskLevel: ActionRiskLevel.SAFE,
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief internal reason why no action is taken (e.g. "answering question", "asking for date")' }
            },
            required: ['reason']
        },
        allowedGoalStates: ['*'] // Allowed anywhere
    },

    update_event_plan: {
        description: 'Used to safely update the current Event Plan draft with newly extracted entities (date, location, packages, children count, payment details).',
        riskLevel: ActionRiskLevel.MODERATE,
        schema: {
            type: 'object',
            properties: {
                event_date: { type: 'string', description: 'Date of the event (e.g., 20 aprilie)' },
                event_time: { type: 'string', description: 'Time of the event (e.g., 17:00)' },
                location: { type: 'string', description: 'Location/City' },
                children_count_estimate: { type: 'number', description: 'Estimated number of children' },
                child_name: { type: 'string', description: 'Name of the celebrated child' },
                duration_hours: { type: 'number', description: 'Duration of the event in hours' },
                animator_count: { type: 'number', description: 'Number of animators requested' },
                selected_package: { type: 'string', description: 'The specific package requested (e.g. super_3_confetti)' },
                payment_method_preference: { type: 'string', enum: ['transfer', 'cash', 'card', 'necunoscut'] },
                invoice_requested: { type: 'string', enum: ['true', 'false', 'necunoscut'] },
                advance_status: { type: 'string', enum: ['requested', 'confirmed', 'necunoscut'] }
            }
            // All properties are optional (it's a partial update)
        },
        allowedGoalStates: [
            'new_lead',
            'greeting',
            'discovery',
            'service_selection',
            'event_qualification',
            'package_recommendation',
            'booking_pending',
            'reschedule_pending'
        ]
    },

    generate_quote_draft: {
        description: 'Used to actively trigger the generation of a pricing quote draft based on the current Event Plan.',
        riskLevel: ActionRiskLevel.MODERATE,
        schema: {
            type: 'object',
            properties: {
                target_package: { type: 'string', description: 'The exact package code to quote (e.g. super_3_confetti)' }
            },
            required: ['target_package']
        },
        allowedGoalStates: [
            'package_recommendation',
            'quotation_draft',
            'objection_handling'
        ]
    },

    confirm_booking_from_ai_plan: {
        description: 'Used to finalize the event and dispatch it to the Core API for official booking creation. High risk.',
        riskLevel: ActionRiskLevel.HIGH,
        schema: {
            type: 'object',
            properties: {
                ai_event_plan_id: { type: 'string', description: 'Optional. The ID of the plan to confirm. If omitted, the system will infer it from the active context.' }
            }
        },
        allowedGoalStates: [
            'booking_ready',
            'booking_confirmed'       // Explicitly requires the goal state to be mature
        ]
    },

    archive_plan: {
        description: 'Used to softly discard an event plan because the client explicitly canceled, rejected the offer, or the conversation resulted in a dead-end.',
        riskLevel: ActionRiskLevel.HIGH,
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why is the plan being archived?' }
            },
            required: ['reason']
        },
        allowedGoalStates: [
            'discovery',
            'service_selection',
            'event_qualification',
            'package_recommendation',
            'quotation_draft',
            'quotation_sent',
            'objection_handling',
            'booking_pending',
            'cancelled'
        ]
    },

    handoff_to_operator: {
        description: 'Used when the AI cannot satisfy the client request, encounters an aggressive objection, or the user explicitly asks for a human.',
        riskLevel: ActionRiskLevel.SAFE, // Safe because it delegates control
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why is human intervention needed?' }
            },
            required: ['reason']
        },
        allowedGoalStates: ['*']
    }
};

/**
 * Validates a tool action payload against the registry schema.
 */
export function validateToolActionSchema(actionName, args) {
    const registryEntry = ACTION_REGISTRY[actionName];
    if (!registryEntry) {
        return { valid: false, error: `Action '${actionName}' is not recognized in the registry.` };
    }

    const schema = registryEntry.schema;
    if (schema.required) {
        for (const req of schema.required) {
            if (args[req] === undefined || args[req] === null) {
                return { valid: false, error: `Missing required argument: '${req}' for action '${actionName}'` };
            }
        }
    }

    // Basic enum validation + type coercion
    if (schema.properties) {
        for (const [key, rules] of Object.entries(schema.properties)) {
            const val = args[key];
            if (val !== undefined && rules.enum && !rules.enum.includes(val)) {
                return { valid: false, error: `Invalid enum value for '${key}'. Allowed: ${rules.enum.join(', ')}` };
            }
            // Type coercion: if schema expects number but LLM sent string, try to coerce
            if (val !== undefined && rules.type === 'number' && typeof val !== 'number') {
                const parsed = Number(val);
                if (!isNaN(parsed)) {
                    args[key] = parsed; // Coerce in place
                } else {
                    return { valid: false, error: `Type mismatch for '${key}'. Expected number, got '${val}'.` };
                }
            }
        }
    }

    return { valid: true };
}
