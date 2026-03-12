import { CATALOG_MAP } from '../services/postProcessServices.mjs';

/**
 * Builds a concrete reply context from analysis data.
 * Extracts: confirmed services (with display names), missing fields,
 * known info from memory, and prioritized next question.
 *
 * @param {object} params
 * @param {object} params.analysis      - LLM analysis output
 * @param {object} params.entityMemory  - entity memory
 * @returns {object} replyContext
 */
export function buildReplyContext({ analysis, entityMemory }) {
    const services = analysis.selected_services || [];
    const missingPerService = analysis.missing_fields_per_service || {};

    // ── Confirmed services with display names ──
    const confirmedServices = services.map(key => {
        const entry = CATALOG_MAP[key];
        return entry?.display_name || key;
    });

    // ── All missing fields, flattened + deduplicated ──
    const allMissing = [];
    const seen = new Set();
    for (const svc of services) {
        for (const field of (missingPerService[svc] || [])) {
            const normalized = field.toLowerCase().trim();
            if (!seen.has(normalized)) {
                seen.add(normalized);
                allMissing.push(field);
            }
        }
    }

    // ── Known info from memory (don't re-ask) ──
    const knownFromMemory = [];
    if (entityMemory && entityMemory.entity_type !== 'unknown') {
        if (entityMemory.usual_locations?.length > 0) {
            knownFromMemory.push({
                field: 'locatie',
                value: entityMemory.usual_locations.map(l => l.name).join(', '),
                type: 'location'
            });
        }
        if (entityMemory.usual_services?.length > 0) {
            knownFromMemory.push({
                field: 'servicii preferate',
                value: entityMemory.usual_services.map(s => {
                    const entry = CATALOG_MAP[s.service_key];
                    return entry?.display_name || s.service_key;
                }).join(', '),
                type: 'services'
            });
        }
    }

    // Filter out missing fields that we already know from memory
    const knownFields = new Set(knownFromMemory.map(k => k.field));
    const trulyMissing = allMissing.filter(f => !knownFields.has(f.toLowerCase()));

    // ── Prioritized next question ──
    // Priority order: data > locatie > numar_copii > ora > rest
    const fieldPriority = [
        'data', 'data_eveniment', 'date',
        'locatie', 'locatia', 'location',
        'numar_copii', 'nr_copii', 'numar_invitati',
        'interval_orar', 'ora', 'ora_start',
        'tip_eveniment', 'varsta_copil'
    ];

    let nextQuestion = null;
    let nextQuestionField = null;

    for (const priority of fieldPriority) {
        const match = trulyMissing.find(f =>
            f.toLowerCase().includes(priority) ||
            priority.includes(f.toLowerCase())
        );
        if (match) {
            nextQuestion = match;
            nextQuestionField = match;
            break;
        }
    }

    // Fallback: first truly missing field
    if (!nextQuestion && trulyMissing.length > 0) {
        nextQuestion = trulyMissing[0];
        nextQuestionField = trulyMissing[0];
    }

    // ── Question phrasing suggestions ──
    const questionPhrases = {
        data: 'Pentru ce dată aveți petrecerea?',
        data_eveniment: 'Pentru ce dată aveți petrecerea?',
        locatie: 'Unde va fi petrecerea?',
        locatia: 'Unde va fi petrecerea?',
        numar_copii: 'Câți copii vor fi?',
        nr_copii: 'Câți copii vor fi?',
        numar_invitati: 'Câți invitați vor fi?',
        interval_orar: 'La ce oră ar începe?',
        ora: 'La ce oră ar începe?',
        ora_start: 'La ce oră ar începe?',
        tip_eveniment: 'Despre ce tip de eveniment este vorba?',
        varsta_copil: 'Ce vârstă are copilul?'
    };

    let suggestedQuestionPhrase = null;
    if (nextQuestionField) {
        const key = nextQuestionField.toLowerCase();
        suggestedQuestionPhrase = questionPhrases[key] || `Care este ${nextQuestionField}?`;
    }

    // ── Memory-aware question (for returning clients) ──
    let memoryAwareQuestion = null;
    if (nextQuestionField?.toLowerCase().includes('locat') && knownFromMemory.some(k => k.type === 'location')) {
        const knownLocation = knownFromMemory.find(k => k.type === 'location');
        memoryAwareQuestion = `Petrecerea este tot la ${knownLocation.value} sau de data asta în altă parte?`;
    }

    // ── Specificity level ──
    let specificity = 'generic';
    if (confirmedServices.length > 0 && nextQuestion) {
        specificity = 'specific';
    } else if (confirmedServices.length > 0 || nextQuestion) {
        specificity = 'semi_specific';
    }

    return {
        confirmedServices,
        confirmedServicesText: confirmedServices.join(' și '),
        trulyMissing,
        nextQuestion,
        suggestedQuestionPhrase,
        memoryAwareQuestion,
        knownFromMemory,
        specificity,
        hasServices: confirmedServices.length > 0,
        hasMissing: trulyMissing.length > 0
    };
}
