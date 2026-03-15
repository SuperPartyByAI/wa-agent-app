/**
 * BUSINESS PLAYBOOK & SALES LOGIC
 * 
 * Maps commercial scenarios to defined strategic actions and tonal directives.
 * Replaces pure logic pathways with sales-oriented logic: 
 * Handles objections, vague requests ("how much?"), and cross-selling.
 */

export const PlaybookStrategies = {
    // ── 1. VAGUE / GENERIC INQUIRIES ──
    vague_inquiry: {
        condition: (context) => {
            if (context.isGreeting || !context.runtimeState?.primary_service) return true;
            const msg = (context.clientMessageText || '').toLowerCase();
            const hasSpecifics = msg.includes('animator') || msg.includes('ursitoar') || msg.includes('vata') || msg.includes('popcorn') || msg.includes('mascota') || msg.includes('magic') || msg.includes('arcada') || msg.includes('baloan');
            return context.runtimeState?.lead_state === 'lead_nou' && !hasSpecifics;
        },
        strategy: "Salută prietenos și cere detalii despre ce tip de eveniment organizează (ex. aniversare, botez, corporate) pentru a-i putea recomanda cele mai potrivite servicii. Fii concis, cald și invită la dialog.",
        tone: "calm_discovery"
    },

    // ── 2. IMPATIENT / DIRECT TO PRICE ──
    impatient_price: {
        // e.g. NLP detected a request for price but we lack location/dates
        condition: (context) => {
            const isEarlyStage = ['identificare_serviciu', 'colectare_date', 'salut_initial', 'lead_nou'].includes(context.runtimeState?.lead_state);
            const asksPrice = context.clientMessageText?.toLowerCase().includes('pret') || context.clientMessageText?.toLowerCase().includes('costa');
            return isEarlyStage && asksPrice;
        },
        strategy: "Acknowledge the request for pricing. Mention that prices vary by location, duration, and package. Briefly provide a STARTING PRICE range if possible, then IMMEDIATELY ask for the missing parameters (Date, Location, Kids count) to give an exact calculation.",
        tone: "professional_helpful"
    },

    // ── 3. STANDARD DATA COLLECTION ──
    standard_collection: {
        condition: (context) => context.missingMetrics && !context.missingMetrics.readyForQuote,
        strategy: "Condu discuția pas cu pas. Cere STRICT informația care lipsește, conform indicației primite. Nu oferi prețul final încă. Confirmă scurt ce ai înțeles (dacă au dat date noi) și adresează întrebarea.",
        tone: "organized_helpful"
    },

    // ── 4. QUOTATION PITCH ──
    quotation: {
        condition: (context) => context.missingMetrics && context.missingMetrics.readyForQuote && context.runtimeState.lead_state !== 'oferta_trimisa',
        strategy: "Generează oferta clară și structurată. Prezintă serviciul ca fiind soluția ideală. Fii entuziast! La final, invită-i să confirme dacă sunt de acord cu detaliile sau dacă doresc să adăugăm și altceva (ex. baloane, mașină de bule). Nu cere avansul direct, cere acordul pe ofertă.",
        tone: "enthusiastic_sales"
    },

    // ── 5. OBJECTION HANDLING ──
    objection_too_expensive: {
        condition: (context) => {
            const txt = (context.clientMessageText || '').toLowerCase();
            return txt.includes('scump') || txt.includes('buget') || txt.includes('reducere');
        },
        strategy: "Arată empatie. Nu te contra cu clientul, ci evidențiază valoarea (recuzită premium, animatori profesioniști, fără costuri ascunse). Dacă e cazul, propune un pachet inferior ca preț sau o durată mai scurtă (ex. 1.5 ore în loc de 2 ore). Rămâi politicos și deschis.",
        tone: "empathetic_advisor"
    },

    objection_thinking: {
        condition: (context) => {
            const txt = (context.clientMessageText || '').toLowerCase();
            return txt.includes('ma gandesc') || txt.includes('vorbesc cu') || txt.includes('revin');
        },
        strategy: "Lasă ușa deschisă fără a presa. 'Perfect, vă înțeleg! Vă las oferta aici. Dacă aveți întrebări, sunt la dispoziție.' Setează așteptarea că disponibilitatea se poate schimba repede.",
        tone: "no_pressure"
    },

    // ── 6. UPSELL / CROSS-SELL (HOT LEADS) ──
    upsell_ready: {
        condition: (context) => context.runtimeState?.lead_score >= 80 && context.runtimeState.lead_state === 'oferta_trimisa',
        strategy: "Dacă oferta a fost acceptată sau sunt foarte interesați (Hot Lead), propune scurt 1 serviciu adițional (ex. Dacă iau Animatori, propune Mașină de Bule sau Vată de Zahăr). Fă-o natural: 'Ca idee, la petrecerile de acest gen merge excelent și...'",
        tone: "friendly_suggestive"
    }
};

/**
 * Evaluates the current conversation context against the Playbook rules.
 * Returns the matched strategy. Ordering matters (Top to Bottom evaluation priority).
 * 
 * @param {object} context 
 * @returns {object|null} The matched playbook strategy object.
 */
export function evaluatePlaybook(context) {
    // Ordered evaluation: Objections trump Standard Collection. Impatient trumps Vague.
    const priorityChecks = [
        'objection_too_expensive',
        'objection_thinking',
        'impatient_price',
        'upsell_ready',
        'quotation',
        'vague_inquiry',
        'standard_collection'
    ];

    for (const key of priorityChecks) {
        const rule = PlaybookStrategies[key];
        if (rule && rule.condition(context)) {
            console.log(`[Playbook] Matched strategy: ${key}`);
            return {
                playbook_key: key,
                strategy: rule.strategy,
                tone: rule.tone
            };
        }
    }

    return null; // Fallback to generic system prompt if nothing matches
}
