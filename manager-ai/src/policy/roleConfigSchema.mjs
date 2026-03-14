import { APPROVED_ROLE_KEYS, ROLE_DEFINITIONS } from './approvedRoleRegistry.mjs';

/**
 * Validates and normalizes a role configuration payload.
 * Trims strings, parses numbers, drops unapproved keys.
 * Throws errors if required invariants fail.
 */
export function validateRoleConfigPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new Error("Payload must be a valid object.");
    }

    const { role_key } = payload;
    if (!APPROVED_ROLE_KEYS.includes(role_key)) {
        throw new Error(`Unauthorized role_key: ${role_key}. Must be one of the approved roles.`);
    }

    const definition = ROLE_DEFINITIONS[role_key];
    
    // Normalize Triggers
    const triggers = payload.triggers || {};
    const normalizedTriggers = {
        keywords: Array.isArray(triggers.keywords) ? triggers.keywords.map(k => String(k).trim()).filter(Boolean) : [],
        service_tags: Array.isArray(triggers.service_tags) ? triggers.service_tags.map(t => String(t).trim()).filter(Boolean) : [definition.service_key],
        min_confidence: typeof triggers.min_confidence === 'number' ? triggers.min_confidence : 0.35
    };

    // Normalize Pricing
    const pricing = payload.pricing_rules || {};
    const normalizedPricing = {
        pricing_model: String(pricing.pricing_model || 'hourly').trim().toLowerCase(),
        base_price: Math.max(0, parseInt(pricing.base_price || 0, 10)),
        currency: String(pricing.currency || 'RON').trim().toUpperCase(),
        included_duration_hours: Math.max(0, parseFloat(pricing.included_duration_hours || 1)),
        extra_hour_price: Math.max(0, parseInt(pricing.extra_hour_price || 0, 10)),
        fixed_price: Math.max(0, parseInt(pricing.fixed_price || 0, 10)),
        price_per_linear_meter: Math.max(0, parseInt(pricing.price_per_linear_meter || 0, 10)),
        allow_model_choice: !!pricing.allow_model_choice,
        allowed_models: Array.isArray(pricing.allowed_models) ? pricing.allowed_models.map(m => String(m).trim()).filter(Boolean) : [],
        transport_rules: {
            bucharest: parseInt(pricing.transport_rules?.bucharest || 0, 10),
            if: parseInt(pricing.transport_rules?.if || 0, 10),
            outside_if: pricing.transport_rules?.outside_if === 'manual_quote' ? 'manual_quote' : parseInt(pricing.transport_rules?.outside_if || 0, 10)
        }
    };

    // Normalize Constraints
    const constraints = payload.constraints || {};
    const normalizedConstraints = {
        allow_discounts: !!constraints.allow_discounts,
        must_collect_fields: Array.isArray(constraints.must_collect_fields) ? constraints.must_collect_fields.map(f => String(f).trim()).filter(Boolean) : ["date", "location"],
        must_not_confirm_availability: constraints.must_not_confirm_availability !== false, // default true to be safe
        must_not_override_approved_prices: constraints.must_not_override_approved_prices !== false // default true
    };

    // Normalize Copy Blocks
    const copy = payload.copy_blocks || {};
    const normalizedCopy = {
        intro: String(copy.intro || '').trim(),
        upsell: String(copy.upsell || '').trim(),
        closing_question: String(copy.closing_question || '').trim()
    };

    return {
        role_key,
        service_key: definition.service_key,
        label: definition.label,
        active: payload.active !== false,
        priority: parseInt(payload.priority || 100, 10),
        triggers: normalizedTriggers,
        pricing_rules: normalizedPricing,
        constraints: normalizedConstraints,
        copy_blocks: normalizedCopy,
        approval_status: 'approved' // Enforce server-side
    };
}

/**
 * Adapter pattern: Converts a legacy Knowledge Base entry (with raw text answer_template)
 * into the new structured JSON format dynamically at runtime so the rest of the pipeline
 * doesn't need branching logic natives.
 */
export function legacyRoleEntryToConfig(entry) {
    if (!entry) return null;
    
    // If it already has the new jsonb schema
    if (entry.policy_config && typeof entry.policy_config === 'object') {
        try {
            return validateRoleConfigPayload(entry.policy_config);
        } catch (e) {
            console.warn(`[RoleConfigSchema] Invalid policy_config for ${entry.knowledge_key}: ${e.message}. Falling back to legacy parsing.`);
        }
    }

    const role_key = entry.knowledge_key;
    const definition = ROLE_DEFINITIONS[role_key];

    // Safe parsing for Whitelisted legacy texts
    if (definition) {
        return {
            role_key,
            service_key: definition.service_key,
            label: definition.label,
            active: true,
            priority: 100,
            triggers: {
                keywords: Array.isArray(entry.question_patterns) ? entry.question_patterns : [],
                service_tags: Array.isArray(entry.service_tags) ? entry.service_tags : [definition.service_key],
                min_confidence: 0.15
            },
            pricing_rules: null, // No exact struct in legacy
            constraints: {
                allow_discounts: false,
                must_collect_fields: ["date", "location"],
                must_not_confirm_availability: true,
                must_not_override_approved_prices: true
            },
            copy_blocks: {
                intro: "",
                upsell: "",
                closing_question: "",
                raw_legacy_logic: entry.answer_template || "" // Raw string preservation
            },
            approval_status: entry.approval_status || 'approved'
        };
    }

    // Un-whitelisted custom role fallback
    return {
        role_key: role_key.startsWith('role_') ? role_key : `role_${role_key}`,
        service_key: "unknown",
        label: "Legacy Custom Role",
        active: true,
        priority: 50,
        triggers: {
            keywords: Array.isArray(entry.question_patterns) ? entry.question_patterns : [],
            service_tags: Array.isArray(entry.service_tags) ? entry.service_tags : [],
            min_confidence: 0.15
        },
        pricing_rules: null,
        constraints: {
            allow_discounts: false, 
            must_collect_fields: ["date", "location"],
            must_not_confirm_availability: true,
            must_not_override_approved_prices: true
        },
        copy_blocks: {
            intro: "",
            upsell: "",
            closing_question: "",
            raw_legacy_logic: entry.answer_template || "" 
        },
        approval_status: entry.approval_status || 'approved'
    };
}
