/**
 * GOAL ENGINE
 * 
 * Maps determinisic Lead States to higher-level, strategic commercial goals.
 * Instructs the LLM not just on *what* to do (NBA), but *how* to act (Tone & Strategy).
 */

export const GOALS = {
    QUALIFY_LEAD: 'qualify_lead',
    COLLECT_REQUIREMENTS: 'collect_requirements',
    PRESENT_OFFER: 'present_offer',
    HANDLE_OBJECTIONS: 'handle_objections',
    CLOSE_DEAL: 'close_deal',
    MAINTAIN_RELATIONSHIP: 'maintain_relationship',
    HOLD_FOR_HUMAN: 'hold_for_human'
};

export const GOAL_STRATEGIES = {
    [GOALS.QUALIFY_LEAD]: 'Fii primitor și cald. Află ce servicii dorește clientul fără să îl grăbești.',
    [GOALS.COLLECT_REQUIREMENTS]: 'Fii profesionist și orientat spre detalii. Cere DOAR informațiile esențiale care lipsesc pentru a putea face o ofertă.',
    [GOALS.PRESENT_OFFER]: 'Fii entuziast și persuasiv. Prezintă prețurile clar, evidențiază beneficiile serviciilor și întreabă direct dacă dorește să rezerve.',
    [GOALS.HANDLE_OBJECTIONS]: 'Fii empatic, răbdător și consultativ. Răspunde la întrebări clar, rezolvă nelămuririle și reasigură clientul de calitatea serviciilor.',
    [GOALS.CLOSE_DEAL]: 'Fii precis și orientat spre acțiune. Comunică pașii următori pentru plată/avans și rezervare fermă.',
    [GOALS.MAINTAIN_RELATIONSHIP]: 'Fii politicos și disponibil. Răspunde scurt și prietenos, lăsând clientul să preia inițiativa.',
    [GOALS.HOLD_FOR_HUMAN]: 'Clientul are nevoie de un operator uman. Oprește discursul de vânzare.'
};

/**
 * Derives the strategic commercial goal based on the current lead state.
 * 
 * @param {string} leadState The current state from ai_lead_runtime_states
 * @returns {object} { goal: string, strategy: string }
 */
export function deriveGoalFromState(leadState) {
    let goal;

    switch (leadState) {
        case 'lead_nou':
        case 'salut_initial':
        case 'identificare_serviciu':
            goal = GOALS.QUALIFY_LEAD;
            break;
            
        case 'colectare_date':
            goal = GOALS.COLLECT_REQUIREMENTS;
            break;
            
        case 'gata_de_oferta':
            goal = GOALS.PRESENT_OFFER;
            break;
            
        case 'oferta_trimisa':
        case 'asteapta_raspuns_client':
        case 'obiectie_client':
            goal = GOALS.HANDLE_OBJECTIONS;
            break;
            
        case 'inchis_castigat':
            goal = GOALS.CLOSE_DEAL;
            break;
            
        case 'inchis_pierdut':
            goal = GOALS.MAINTAIN_RELATIONSHIP;
            break;
            
        case 'escaladare_operator':
        default:
            goal = GOALS.HOLD_FOR_HUMAN;
            break;
    }

    return {
        goal,
        strategy: GOAL_STRATEGIES[goal]
    };
}
