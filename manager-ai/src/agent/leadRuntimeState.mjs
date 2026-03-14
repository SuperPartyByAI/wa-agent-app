export const VALID_LEAD_STATES = [
    'lead_nou',
    'salut_initial',
    'identificare_serviciu',
    'colectare_date',
    'gata_de_oferta',
    'oferta_trimisa',
    'asteapta_raspuns_client',
    'follow_up_necesar',
    'obiectie_client',
    'escaladare_operator',
    'inchis_castigat',
    'inchis_pierdut'
];

/**
 * Creates a generic empty state object for reference.
 */
export function createEmptyLeadState(conversationId) {
    return {
        conversation_id: conversationId,
        lead_state: 'lead_nou',
        last_agent_goal: null,
        next_best_action: null,
        primary_service: null,
        active_roles: [],
        known_fields: {},
        missing_fields: [],
        human_takeover: false,
        lead_score: 0.00,
        follow_up_due_at: null
    };
}

/**
 * Helper to check if a state is a valid enum value.
 */
export function isValidLeadState(stateName) {
    return VALID_LEAD_STATES.includes(stateName);
}
