/**
 * REPLY SELF CHECK (Safety Audit Layer)
 * 
 * Runs algorithmically over the generated `assistant_reply` BEFORE transmission 
 * to detect hallucinations (e.g., unauthorized prices, premature confirmations).
 */

export const AUDIT_RESULTS = {
    PASS: 'pass',
    BLOCK_HALLUCINATED_PRICE: 'block_hallucinated_price',
    BLOCK_PREMATURE_CONFIRMATION: 'block_premature_confirmation',
    BLOCK_UNAUTHORIZED_DISCOUNT: 'block_unauthorized_discount'
};

/**
 * Perform a deterministic safety scan on the AI's intended response.
 * 
 * @param {string} replyText The raw text the AI wants to send
 * @param {object} context Context including eventPlan and missingMetrics
 * @returns {object} { passed: boolean, reason: string | null }
 */
export function runSelfCheckAudit(replyText, context) {
    if (!replyText || typeof replyText !== 'string') {
        return { passed: false, reason: 'invalid_type' };
    }

    const { eventPlan, missingMetrics } = context;
    const lowerReply = replyText.toLowerCase();

    // RULE 1: Premature Confirmations
    // If the AI says "Booking confirmed" but we don't have all data or payment
    const confirmationKeywords = [
        'rezervarea este confirmata', 'rezervarea este confirmată',
        'evenimentul este confirmat', 'am confirmat rezervarea'
    ];
    
    const isConfirming = confirmationKeywords.some(kw => lowerReply.includes(kw));
    
    if (isConfirming) {
        // Can't confirm if plan is incomplete
        if (missingMetrics && !missingMetrics.readyForQuote) {
            return { passed: false, reason: AUDIT_RESULTS.BLOCK_PREMATURE_CONFIRMATION };
        }
        // In theory, can't confirm without an advance, but keeping it simple for phase 2.
    }

    // RULE 2: Unauthorized Discounts or "Free" items
    const discountKeywords = ['gratuit', 'gratis', 'fara cost', 'fără cost', 'discount', 'reducere'];
    const offersDiscount = discountKeywords.some(kw => lowerReply.includes(kw));
    
    // We only allow discounts if they are officially logged in the plan
    if (offersDiscount) {
        const approvedDiscount = eventPlan?.active_discount || false; 
        if (!approvedDiscount && !lowerReply.includes('transport gratuit')) {
            // Transport gratuit is sometimes a valid policy exception, but general "gratis" is dangerous
            return { passed: false, reason: AUDIT_RESULTS.BLOCK_UNAUTHORIZED_DISCOUNT };
        }
    }

    // RULE 3: Hallucinated Pricing (Simple Heuristic for now)
    // If the reply mentions a specific price (e.g. "1200 Lei", "500 ron")
    // but the quote hasn't been generated yet (state != gata_de_oferta).
    const priceRegex = /\d+\s*(lei|ron|euro)/i;
    const mentionsPrice = priceRegex.test(lowerReply);

    if (mentionsPrice) {
        // Are we in a state where quoting is allowed?
        if (missingMetrics && !missingMetrics.readyForQuote) {
            // Mentioning pricing before we have all constraints is a hallucination risk
            // "Sure, it costs 500 lei" -> but wait, what location? Transport isn't factored in.
            return { passed: false, reason: AUDIT_RESULTS.BLOCK_HALLUCINATED_PRICE };
        }
    }

    return { passed: true, reason: AUDIT_RESULTS.PASS };
}
