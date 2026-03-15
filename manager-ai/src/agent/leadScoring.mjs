/**
 * LEAD SCORING ENGINE
 * 
 * Calculates a 'temperature' score (0-100) for a lead based on:
 * - Current State (Closer to booking = higher score)
 * - Quote Readiness
 * - Relationship factors (Recurring clients = higher baseline)
 * - Missing fields density
 */

export function calculateLeadScore(context) {
    const { runtimeState, missingMetrics, relationshipData, hasActiveBooking } = context;
    
    let score = 0;

    // 1. Base Score by State
    switch (runtimeState?.lead_state) {
        case 'lead_nou':
        case 'salut_initial':
            score += 10;
            break;
        case 'identificare_serviciu':
            score += 30;
            break;
        case 'colectare_date':
            score += 50;
            break;
        case 'gata_de_oferta':
            score += 80;
            break;
        case 'oferta_trimisa':
        case 'asteapta_raspuns_client':
            score += 90;
            break;
        case 'obiectie_client':
            score += 70; // High value, but needs work
            break;
        case 'inchis_castigat':
            score = 100;
            break;
        case 'inchis_pierdut':
        case 'escaladare_operator':
            score = 0; // Handled or lost
            break;
        default:
            score += 10;
    }

    // 2. Adjust by missing fields proximity
    if (missingMetrics) {
        if (missingMetrics.readyForQuote && score < 80) {
            score = 80; // Force score up if ready for quote regardless of slow state transition
        } else if (missingMetrics.totalRequired > 0) {
            // Deduct points based on how much is missing
            const completionRatio = missingMetrics.known.length / missingMetrics.totalRequired;
            // E.g., if total 5, known 1 -> 20% complete
            // Add up to 15 points for completion
            score += Math.floor(completionRatio * 15);
        }
    }

    // 3. Relationship Boosts
    if (relationshipData) {
        if (relationshipData.conversationCount > 1) {
            score += 10; // Recurring leads are hotter
        }
        if (hasActiveBooking) {
            score += 15; // Active clients are very valuable (upsell probability)
        }
        if (relationshipData.hasPastCancellations) {
            score -= 20; // Risk modifier
        }
    }

    // Bounds check
    if (score > 100) score = 100;
    if (score < 0) score = 0;

    // Additional label for easy UI sorting
    let temperature = 'cold';
    if (score >= 80) temperature = 'hot';
    else if (score >= 40) temperature = 'warm';

    return {
        score,
        temperature
    };
}
