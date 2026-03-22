import { SERVICE_CATALOG, CATALOG_MAP } from '../services/postProcessServices.mjs';

/**
 * Fast Path Router
 *
 * Classifies inbound messages to determine if they can skip the full LLM pipeline.
 *
 * Categories:
 *   - greeting:          "Buna", "Salut" → instant template reply
 *   - generic_discovery: "Vreau ceva pentru petrecere" → instant discovery reply
 *   - clear_services:    Message contains catalog service names → instant confirm + ask date
 *   - needs_full:        Mutations, dates, complaints, complex → full pipeline
 *
 * @param {object} params
 * @param {string} params.messageText       - latest client message
 * @param {object} params.existingDraft     - current draft row (or null)
 * @param {string} params.conversationStage - current stage
 * @param {number} params.messageCount      - total messages in conversation
 * @returns {object} { use_fast_path, fast_path_type, fast_path_reason, detected_services }
 */
export function evaluateFastPath({ messageText, existingDraft, conversationStage, messageCount }) {
    const msg = (messageText || '').trim();
    const msgLower = msg.toLowerCase()
        .replace(/[îâ]/g, m => m === 'î' ? 'i' : 'a')
        .replace(/[șş]/g, 's')
        .replace(/[țţ]/g, 't')
        .replace(/[ă]/g, 'a');

    // ── Never fast-path on sensitive stages ──
    const SENSITIVE_STAGES = ['booking', 'payment', 'coordination', 'completed'];
    if (SENSITIVE_STAGES.includes(conversationStage)) {
        return { use_fast_path: false, fast_path_type: 'none', fast_path_reason: 'sensitive_stage', detected_services: [] };
    }

    // ── Complex indicators → full pipeline ──
    const complexPatterns = [
        /\d{1,2}[\s./-]\w+/,                  // date patterns: "20 aprilie", "5.05"
        /mu[tț]/i,                              // mutam/mutati
        /anul/i,                                // anulam
        /nu mai vr/i,                           // nu mai vrem
        /in loc de/i,                           // in loc de
        /schimb/i,                              // schimbam
        /plat[aă]/i, /achit/i, /factur/i,      // payment
        /confirm[aă]m/i,                        // confirmam
        /nemul[tț]umit/i, /reclamati/i,        // complaint
        /ramburs/i, /banii inapoi/i,           // refund
    ];

    if (complexPatterns.some(p => p.test(msg))) {
        return { use_fast_path: false, fast_path_type: 'none', fast_path_reason: 'complex_message', detected_services: [] };
    }

    // ── If draft already exists and has services, complex mutations likely ──
    if (existingDraft && existingDraft.services?.length > 0 && existingDraft.draft_status === 'active') {
        // Existing active draft with services — could be a follow-up, allow fast path only for very short messages
        if (msg.length > 30) {
            return { use_fast_path: false, fast_path_type: 'none', fast_path_reason: 'active_draft_complex', detected_services: [] };
        }
    }

    // ── 1. Pure greeting ──
    const greetingPatterns = [
        /^(bun[aă]|salut|hey|hello|hi|sal|buna\s*ziua|noroc|servus|hei)\s*[!.?]*$/i,
        /^(bun[aă]|salut)\s*[!.,]?\s*$/i,
    ];
    if (msg.length < 25 && greetingPatterns.some(p => p.test(msg))) {
        return { use_fast_path: true, fast_path_type: 'greeting', fast_path_reason: 'Simple greeting detected', detected_services: [] };
    }

    // ── 2. Generic discovery ──
    const discoveryPatterns = [
        /vreau.*petrecere/i,
        /as vrea.*petrecere/i,
        /ma intereseaza/i,
        /vreau.*detalii/i,
        /vreau.*ofert/i,
        /ce servicii/i,
        /ce aveti/i,
        /as dori.*informat/i,
        /as vrea.*informatii/i,
        /vreau.*ceva/i,
    ];
    if (msg.length < 80 && discoveryPatterns.some(p => p.test(msgLower))) {
        // Check if any explicit service is mentioned
        const detectedServices = detectServicesInMessage(msg);
        if (detectedServices.length === 0) {
            return { use_fast_path: true, fast_path_type: 'generic_discovery', fast_path_reason: 'Generic inquiry without specific services', detected_services: [] };
        }
    }

    // ── 3. Clear service mention ──
    const detectedServices = detectServicesInMessage(msg);
    if (detectedServices.length > 0 && msg.length < 100 && !complexPatterns.some(p => p.test(msg))) {
        // Disabled fast path for `clear_services` to allow the LLM to apply Custom Roles and Pricing logic over them.
        // return { use_fast_path: true, fast_path_type: 'clear_services', fast_path_reason: `Services detected: ${detectedServices.join(', ')}`, detected_services: detectedServices };
    }

    // ── Default: full pipeline ──
    return { use_fast_path: false, fast_path_type: 'none', fast_path_reason: 'no_fast_path_match', detected_services: [] };
}

/**
 * Detect catalog services mentioned in a message.
 */
function detectServicesInMessage(text) {
    const textLower = text.toLowerCase();
    const found = [];

    // Direct catalog key matches and display name matches
    for (const svc of (SERVICE_CATALOG?.services || [])) {
        const key = svc.service_key;
        const display = (svc.display_name || '').toLowerCase();
        const aliases = (svc.aliases || []).map(a => a.toLowerCase());

        if (textLower.includes(key.replace(/_/g, ' ')) || textLower.includes(key)) {
            if (!found.includes(key)) found.push(key);
        } else if (display && textLower.includes(display)) {
            if (!found.includes(key)) found.push(key);
        } else {
            for (const alias of aliases) {
                if (textLower.includes(alias)) {
                    if (!found.includes(key)) found.push(key);
                    break;
                }
            }
        }
    }

    return found;
}
