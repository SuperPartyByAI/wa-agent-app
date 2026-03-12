import { CATALOG_MAP } from '../services/postProcessServices.mjs';

/**
 * Fast Path Reply Builder
 *
 * Generates deterministic, natural replies for simple cases
 * that don't need the full LLM composer.
 *
 * Respects service detection guard: never assumes services not detected.
 * Varies openers to avoid robotic repetition.
 *
 * @param {object} params
 * @param {string} params.fastPathType     - 'greeting' | 'generic_discovery' | 'clear_services'
 * @param {string[]} params.detectedServices - services detected in message
 * @param {string} params.nextStep         - from progression engine
 * @param {object} params.entityMemory     - entity memory (for returning clients)
 * @returns {object} { reply, replyStyle, specificity }
 */
export function buildFastPathReply({ fastPathType, detectedServices, nextStep, entityMemory }) {

    // Vary openers to avoid repetition
    const openers = ['Bună!', 'Salut!', 'Hey!', 'Bună ziua!'];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    const warmEmojis = ['😊', '🎉', '✨'];
    const emoji = warmEmojis[Math.floor(Math.random() * warmEmojis.length)];

    // Returning client detection
    const isReturning = entityMemory?.entity_type === 'client' && (entityMemory?.usual_services?.length > 0);

    // ── Greeting ──
    if (fastPathType === 'greeting') {
        if (isReturning) {
            return {
                reply: `${opener} Ne bucurăm că reveniți ${emoji} Cu ce vă putem ajuta de data asta?`,
                replyStyle: 'returning_client',
                specificity: 'discovery'
            };
        }
        return {
            reply: `${opener} Cu ce vă putem ajuta ${emoji} Avem animator, ursitoare, vată de zahăr, popcorn, arcadă baloane și multe altele!`,
            replyStyle: 'warm_sales',
            specificity: 'discovery'
        };
    }

    // ── Generic discovery ──
    if (fastPathType === 'generic_discovery') {
        const variants = [
            `${opener} Sigur, vă ajutăm cu drag ${emoji} Ce servicii vă interesează? Avem animator, ursitoare, vată de zahăr, popcorn, arcadă baloane și multe altele!`,
            `${opener} Cu plăcere ${emoji} Spuneți-ne ce vă interesează — animator, ursitoare, vată de zahăr, popcorn, arcadă baloane?`,
            `${opener} Ne ocupăm cu drag ${emoji} Ce anume căutați pentru petrecere?`
        ];
        return {
            reply: variants[Math.floor(Math.random() * variants.length)],
            replyStyle: 'warm_sales',
            specificity: 'discovery'
        };
    }

    // ── Clear services detected ──
    if (fastPathType === 'clear_services' && detectedServices.length > 0) {
        const serviceNames = detectedServices.map(key => {
            const entry = CATALOG_MAP[key];
            return entry?.display_name || key;
        });
        const servicesText = serviceNames.join(' și ');

        // Determine the next question based on what's missing
        let nextQuestion = 'Pentru ce dată aveți petrecerea?';
        if (nextStep === 'ask_location') nextQuestion = 'Unde va fi petrecerea?';
        if (nextStep === 'ask_time') nextQuestion = 'La ce oră ar începe?';
        if (nextStep === 'ask_guest_count') nextQuestion = 'Câți copii vor fi?';

        const variants = [
            `${opener} Sigur, vă putem ajuta cu ${servicesText} ${emoji} ${nextQuestion}`,
            `${opener} Da, avem ${servicesText} ${emoji} ${nextQuestion}`,
            `${opener} Cu plăcere, ne ocupăm de ${servicesText} ${emoji} ${nextQuestion}`
        ];
        return {
            reply: variants[Math.floor(Math.random() * variants.length)],
            replyStyle: 'warm_sales',
            specificity: 'specific'
        };
    }

    // Fallback (should not reach here)
    return {
        reply: `${opener} Cu ce vă putem ajuta ${emoji}`,
        replyStyle: 'warm_sales',
        specificity: 'generic'
    };
}
