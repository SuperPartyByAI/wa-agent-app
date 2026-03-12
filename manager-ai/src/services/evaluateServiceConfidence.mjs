/**
 * Service Detection Confidence Guard
 * 
 * Evaluates whether detected services can be confirmed in the reply,
 * or whether the reply should use a service discovery question instead.
 * 
 * Rules:
 *  - If the LLM explicitly detected services AND the client explicitly mentioned them → clear
 *  - If services were inferred/assumed but not explicitly requested → ambiguous
 *  - If no services detected → unknown (discovery mode)
 * 
 * @module evaluateServiceConfidence
 */

/**
 * @param {object} params
 * @param {object} params.analysis          - The LLM analysis output
 * @param {string[]} params.selectedServices - Validated service keys from postProcessServices
 * @param {string} params.lastClientMessage - The raw last message from the client
 * @returns {object} serviceConfidence evaluation
 */
export function evaluateServiceConfidence({ analysis, selectedServices, lastClientMessage }) {
    const msg = (lastClientMessage || '').toLowerCase().trim();

    // No services detected at all → discovery mode
    if (!selectedServices || selectedServices.length === 0) {
        return {
            service_detection_status: 'unknown',
            service_confirmation_allowed: false,
            confirmed_services: [],
            ambiguous_services: [],
            reason: 'No services detected in conversation'
        };
    }

    // Check LLM's own confidence signal
    const llmConfidence = analysis?.decision?.confidence_score || 0;
    const serviceDetectionConfidence = analysis?.service_detection_confidence || null;

    // If LLM explicitly said service detection is low confidence
    if (serviceDetectionConfidence !== null && serviceDetectionConfidence < 60) {
        return {
            service_detection_status: 'ambiguous',
            service_confirmation_allowed: false,
            confirmed_services: [],
            ambiguous_services: selectedServices,
            reason: `LLM service_detection_confidence=${serviceDetectionConfidence} < 60`
        };
    }

    // Heuristic: check if the client message actually mentions service-related keywords
    const serviceKeywords = {
        animator: ['animator', 'animatori', 'animatoare', 'animatie'],
        ursitoare: ['ursitoare', 'ursitori', 'botez'],
        vata_zahar: ['vata', 'vată', 'vata de zahar', 'vată de zahăr'],
        popcorn: ['popcorn', 'floricele'],
        arcada_baloane: ['arcada', 'arcadă', 'baloane', 'balon'],
        cifre_baloane: ['cifra', 'cifre', 'numar', 'număr', 'cifră'],
        personaje: ['personaj', 'personaje', 'mascota', 'mascotă', 'costum', 'elsa', 'spiderman', 'frozen', 'mickey'],
        candy_bar: ['candy', 'bar', 'candy bar'],
        face_painting: ['pictura', 'pictură', 'face painting', 'fata', 'față'],
        decoratiuni: ['decor', 'decoratiuni', 'decorațiuni', 'decorare']
    };

    const confirmedServices = [];
    const ambiguousServices = [];

    for (const svcKey of selectedServices) {
        const keywords = serviceKeywords[svcKey] || [];
        const clientMentioned = keywords.some(kw => msg.includes(kw));

        if (clientMentioned) {
            confirmedServices.push(svcKey);
        } else {
            ambiguousServices.push(svcKey);
        }
    }

    // If ALL services are ambiguous → ambiguous mode
    if (confirmedServices.length === 0 && ambiguousServices.length > 0) {
        return {
            service_detection_status: 'ambiguous',
            service_confirmation_allowed: false,
            confirmed_services: [],
            ambiguous_services: ambiguousServices,
            reason: `Client message does not explicitly mention any of the ${ambiguousServices.length} detected services`
        };
    }

    // If SOME are confirmed, SOME are ambiguous → partial mode
    if (confirmedServices.length > 0 && ambiguousServices.length > 0) {
        return {
            service_detection_status: 'partial',
            service_confirmation_allowed: true,
            confirmed_services: confirmedServices,
            ambiguous_services: ambiguousServices,
            reason: `${confirmedServices.length} confirmed, ${ambiguousServices.length} ambiguous`
        };
    }

    // ALL explicitly confirmed
    return {
        service_detection_status: 'clear',
        service_confirmation_allowed: true,
        confirmed_services: confirmedServices,
        ambiguous_services: [],
        reason: 'All services explicitly mentioned by client'
    };
}
