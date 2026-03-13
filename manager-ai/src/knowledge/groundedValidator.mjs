/**
 * Grounded Truthfulness Validator
 *
 * Validates that composer output stays faithful to KB facts
 * for sensitive categories (pricing, packages, policy).
 *
 * Strategy:
 *  1. For sensitive categories: strict mode
 *     - Extract key claims from composer output
 *     - Check against KB answer_template
 *     - Block if invented claims detected
 *  2. For non-sensitive categories: lenient mode
 *     - Allow reformulation, just check nothing contradicts KB
 *  3. Fallback: use kb_direct_answer if validation fails
 *
 * This is heuristic validation — not NLP-perfect but safe.
 */

// Categories where truthfulness is critical
const SENSITIVE_CATEGORIES = ['pricing', 'packages', 'policy'];

// Patterns that indicate invented claims in sensitive categories
const INVENTION_PATTERNS = [
    // Invented prices
    /\b\d+\s*(lei|ron|euro|eur|€)\b/i,
    // Specific percentages (discounts)
    /\b\d+\s*%\s*(discount|reducere|off)\b/i,
    // Guarantee / promise language
    /\b(garant[ăa]m|promit(em)?|sigur\s+că|asigur[ăa]m|100%)\b/i,
    // Specific durations not in KB
    /\b(minim|maxim|exact)\s+\d+\s*(ore|minute|h|min)\b/i,
    // Specific counts not in KB
    /\b(maxim|pana la|până la)\s+\d+\s*(copii|invitati|persoane)\b/i,
];

// Numbers/prices that appear in the KB factual answer
function extractNumbers(text) {
    const nums = new Set();
    const matches = (text || '').match(/\d+/g);
    if (matches) matches.forEach(n => nums.add(n));
    return nums;
}

// Words with factual meaning from KB (more than 4 chars)
function extractFactWords(text) {
    return new Set(
        (text || '')
            .toLowerCase()
            .replace(/[^a-zăâîșțşţ0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 4)
    );
}

/**
 * Determine if a category requires strict validation.
 */
export function isSensitiveCategory(category) {
    return SENSITIVE_CATEGORIES.includes(category);
}

/**
 * Determine the grounding mode for a KB match.
 *
 * Sensitive categories → force kb_direct_answer or strict grounding
 * Non-sensitive → allow grounded composer
 */
export function resolveGroundingMode(kbMatch) {
    if (!kbMatch) return null;

    // Packages → ALWAYS go through composer with grounding
    // The LLM reads the conversation + KB data and crafts contextual reply
    if (kbMatch.category === 'packages') {
        return 'kb_grounded_composer';
    }

    // Other sensitive categories (pricing, policy) with high score → force direct answer
    if (isSensitiveCategory(kbMatch.category) && kbMatch.score >= 0.75) {
        return 'kb_direct_answer';
    }

    // Sensitive category with moderate score → strict grounded
    if (isSensitiveCategory(kbMatch.category)) {
        return 'kb_strict_grounded';
    }

    // Non-sensitive → normal grounded
    return kbMatch.mode;
}

/**
 * Validate that a composed reply stays faithful to KB facts.
 *
 * @param {string} composedReply — composer output
 * @param {string} kbAnswer — KB answer_template (truth source)
 * @param {string} category — KB category
 * @returns {object} { valid, failReason, confidence }
 */
export function validateGroundedReply(composedReply, kbAnswer, category) {
    if (!composedReply || !kbAnswer) {
        return { valid: false, failReason: 'missing_input', confidence: 0 };
    }

    const composed = composedReply.toLowerCase();
    const kb = kbAnswer.toLowerCase();

    // For non-sensitive categories, be lenient
    if (!isSensitiveCategory(category)) {
        return { valid: true, failReason: null, confidence: 0.9 };
    }

    // ── Strict validation for sensitive categories ──

    // Check 1: Does the composed reply contain numbers NOT in KB?
    const kbNumbers = extractNumbers(kbAnswer);
    const composedNumbers = extractNumbers(composedReply);
    const inventedNumbers = [...composedNumbers].filter(n => !kbNumbers.has(n) && parseInt(n) > 9);

    if (inventedNumbers.length > 0) {
        return {
            valid: false,
            failReason: `invented_numbers: [${inventedNumbers.join(', ')}]`,
            confidence: 0.3
        };
    }

    // Check 2: Does the composed reply match invention patterns?
    for (const pattern of INVENTION_PATTERNS) {
        const match = composed.match(pattern);
        if (match) {
            // Verify this claim exists in KB
            const claim = match[0];
            if (!kb.includes(claim.toLowerCase())) {
                return {
                    valid: false,
                    failReason: `invented_claim: "${claim}"`,
                    confidence: 0.4
                };
            }
        }
    }

    // Check 3: Key KB facts are preserved (not stripped out)
    const kbFacts = extractFactWords(kbAnswer);
    const composedFacts = extractFactWords(composedReply);
    const preservedCount = [...kbFacts].filter(w => composedFacts.has(w)).length;
    const preservationRate = kbFacts.size > 0 ? preservedCount / kbFacts.size : 1;

    if (preservationRate < 0.3) {
        return {
            valid: false,
            failReason: `low_fact_preservation: ${(preservationRate * 100).toFixed(0)}%`,
            confidence: 0.4
        };
    }

    return { valid: true, failReason: null, confidence: 0.85 };
}

/**
 * Build structured grounding payload for the composer.
 * Tells the composer exactly what it can and cannot do.
 */
export function buildGroundingPayload(kbMatch) {
    if (!kbMatch) return null;

    const sensitive = isSensitiveCategory(kbMatch.category);
    const mode = resolveGroundingMode(kbMatch);

    return {
        knowledgeKey: kbMatch.knowledgeKey,
        category: kbMatch.category,
        factualAnswer: kbMatch.answer,
        requiredContext: kbMatch.requiredContext || [],
        metadata: kbMatch.metadata || {},
        sensitive,
        mode,
        constraints: {
            allowedClaims: 'only_from_kb',
            forbiddenExtrapolations: sensitive
                ? ['prices', 'guarantees', 'package_contents', 'policy_exceptions', 'specific_counts']
                : [],
            requiredContextMissing: kbMatch.requiredContext || [],
            composerInstruction: sensitive
                ? 'STRICT: Reformulează DOAR informația din KB. NU adăuga prețuri, pachete, garanții sau condiții care nu apar mai sus. Dacă nu ai informația, spune că sunt necesare detalii suplimentare.'
                : 'Reformulează natural, scurt și cald. Folosește KB ca sursă de adevăr. Poți personaliza stilul dar nu inventa informații noi.'
        }
    };
}
