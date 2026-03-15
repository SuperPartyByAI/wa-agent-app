/**
 * Knowledge Matcher — service-aware, score-based KB retrieval
 *
 * Matching strategy:
 *  1. Filter: active=true, approval_status=approved, valid dates
 *  2. If services detected → boost entries with matching service_tags
 *  3. Score: pattern match (60%) + service match (25%) + category match (15%)
 *  4. Return best match with score, reason, mode (direct/grounded)
 *
 * Two modes:
 *  - kb_direct_answer:     high score, simple factual question → use answer_template directly
 *  - kb_grounded_composer: moderate score or complex context → pass to composer as grounding truth
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { legacyRoleEntryToConfig } from '../policy/roleConfigSchema.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Cache ──
let kbCache = null;
let kbCacheAt = 0;
const KB_CACHE_TTL = 5 * 60 * 1000;

// ── Thresholds ──
const DIRECT_ANSWER_THRESHOLD = 0.75;   // score >= this → kb_direct_answer
const GROUNDED_THRESHOLD = 0.50;         // score >= this → kb_grounded_composer
const MIN_MSG_LENGTH = 8;               // skip very short messages (acks)

// ── Text normalization ──
export function normalize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
        .replace(/ș/g, 's').replace(/ş/g, 's')
        .replace(/ț/g, 't').replace(/ţ/g, 't')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Load active, approved KB entries (cached 5 min)
 */
async function loadApprovedKB() {
    if (kbCache && (Date.now() - kbCacheAt) < KB_CACHE_TTL) {
        return kbCache;
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('active', true)
        .eq('approval_status', 'approved')
        .order('times_used', { ascending: false });

    if (error) {
        console.error('[KBMatcher] Load error:', error.message);
        return kbCache || [];
    }

    // Filter by valid dates client-side (Supabase doesn't support OR-NULL in .lte easily)
    const valid = (data || []).filter(e => {
        if (e.valid_until && new Date(e.valid_until) < new Date(now)) return false;
        if (e.valid_from && new Date(e.valid_from) > new Date(now)) return false;
        return true;
    });

    kbCache = valid;
    kbCacheAt = Date.now();
    console.log(`[KBMatcher] Loaded ${valid.length} active approved entries`);
    return valid;
}

/**
 * Score pattern match between message and KB entry's question_patterns.
 * Returns 0-1.
 */
function scorePatternMatch(normMsg, patterns) {
    let best = 0;
    for (const pattern of (patterns || [])) {
        const normP = normalize(pattern);
        const words = normP.split(' ').filter(w => w.length > 2);
        if (words.length === 0) continue;

        // Full pattern contained in message → 1.0
        if (normMsg.includes(normP)) { best = 1.0; continue; }

        // Word overlap
        let hits = 0;
        for (const w of words) {
            // Check boundaries so 'vata' doesn't match 'cravata'
            const regex = new RegExp(`\\b${w}\\b`, 'i');
            if (regex.test(normMsg)) hits++;
        }
        let overlap = hits / words.length;
        
        // Penalize partial matches for very short patterns (e.g., 'aveti cu vata')
        if (overlap === 1.0 && words.length < 3) {
            overlap = 0.85; // Capped to prevent false 100% on 2 words
        }
        
        best = Math.max(best, overlap);
    }
    return best;
}

/**
 * Score service tag match.
 * If pipeline detected services, boost entries with matching service_tags.
 * Returns 0-1.
 */
function scoreServiceMatch(entryTags, detectedServices) {
    if (!detectedServices || detectedServices.length === 0) return 0.5; // neutral
    if (!entryTags || entryTags.length === 0) return 0.3; // entry has no service tags

    const det = new Set(detectedServices.map(s => s.toLowerCase()));
    let matchCount = 0;
    for (const tag of entryTags) {
        if (det.has(tag.toLowerCase())) matchCount++;
    }
    return matchCount > 0 ? 1.0 : 0.0;
}

/**
 * Score if the entry's category matches the likely question category.
 * Heuristic based on keywords.
 */
function scoreCategoryMatch(normMsg, entryCategory) {
    const catKeywords = {
        pricing: ['pret', 'preturi', 'costa', 'tarif', 'oferta', 'cat costa'],
        services: ['animatie', 'animator', 'baloane', 'vata', 'popcorn', 'ursitoare'],
        packages: ['pachete', 'pachet', 'variante', 'include', 'contine', 'confetti', 'tort', 'banner'],
        faq: ['zone', 'acoperiti', 'veniti', 'cum', 'unde', 'cand', 'rezerv'],
        policy: ['politica', 'reguli', 'conditii', 'anulare', 'rambursare']
    };

    const keywords = catKeywords[entryCategory] || [];
    let hits = 0;
    for (const kw of keywords) {
        if (normMsg.includes(kw)) hits++;
    }
    return keywords.length > 0 ? Math.min(hits / 2, 1.0) : 0.3;
}

/**
 * Check applicability rules.
 * Returns true if entry is applicable, false if it should be skipped.
 */
function checkApplicability(entry, detectedServices) {
    const rules = entry.applicability_rules || {};
    if (rules.only_if_service_detected) {
        if (!detectedServices || !detectedServices.includes(rules.only_if_service_detected)) {
            return false;
        }
    }
    return true;
}

/**
 * Main KB search function.
 *
 * @param {string} clientMessage     - client's message text
 * @param {object} [context]
 * @param {string[]} [context.detectedServices] - services detected in conversation
 * @param {string}   [context.conversationStage]
 * @param {string}   [context.category]         - filter by specific category
 * @returns {object|null}
 *   {
 *     answer: string,
 *     knowledgeKey: string,
 *     category: string,
 *     serviceTags: string[],
 *     score: number,
 *     matchReason: string,
 *     mode: 'kb_direct_answer' | 'kb_grounded_composer',
 *     kbId: string,
 *     metadata: object,
 *     requiredContext: string[]
 *   }
 */
export async function matchKnowledge(clientMessage, context = {}) {
    const normMsg = normalize(clientMessage);
    if (normMsg.length < MIN_MSG_LENGTH) {
        console.log('[KBMatcher] Skip: message too short');
        return null;
    }

    const entries = await loadApprovedKB();
    if (entries.length === 0) return null;

    const detectedServices = context.detectedServices || [];

    let bestMatch = null;
    let bestScore = 0;
    let bestReason = '';

    for (const entry of entries) {
        // Exclude role entries from being matched as a generic KB answer!
        if (entry.category === 'roles' || (entry.knowledge_key && entry.knowledge_key.startsWith('role_'))) {
            continue;
        }

        // Category filter
        if (context.category && entry.category !== context.category) continue;

        // Applicability check
        if (!checkApplicability(entry, detectedServices)) continue;

        // Composite score: pattern(60%) + service(25%) + category(15%)
        const patternScore = scorePatternMatch(normMsg, entry.question_patterns);
        const serviceScore = scoreServiceMatch(entry.service_tags, detectedServices);
        const categoryScore = scoreCategoryMatch(normMsg, entry.category);

        const composite = (patternScore * 0.60) + (serviceScore * 0.25) + (categoryScore * 0.15);

        if (composite > bestScore) {
            bestScore = composite;
            bestMatch = entry;
            bestReason = `pattern=${patternScore.toFixed(2)} service=${serviceScore.toFixed(2)} category=${categoryScore.toFixed(2)}`;
        }
    }

    if (!bestMatch || bestScore < GROUNDED_THRESHOLD) {
        console.log(`[KBMatcher] No match (best=${bestScore.toFixed(2)})`);
        return null;
    }

    // Determine mode
    const mode = bestScore >= DIRECT_ANSWER_THRESHOLD ? 'kb_direct_answer' : 'kb_grounded_composer';

    // Update usage counter (fire-and-forget)
    supabase.from('ai_knowledge_base')
        .update({ times_used: (bestMatch.times_used || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', bestMatch.id)
        .then(() => {}).catch(() => {});

    console.log(`[KBMatcher] MATCH: key=${bestMatch.knowledge_key}, score=${bestScore.toFixed(2)}, mode=${mode}, reason=[${bestReason}]`);

    return {
        answer: bestMatch.answer_template,
        knowledgeKey: bestMatch.knowledge_key,
        category: bestMatch.category,
        serviceTags: bestMatch.service_tags || [],
        score: bestScore,
        matchReason: bestReason,
        mode,
        kbId: bestMatch.id,
        metadata: bestMatch.metadata || {},
        requiredContext: bestMatch.required_context || []
    };
}

/**
 * Invalidate KB cache
 */
export function invalidateKBCache() {
    kbCache = null;
    kbCacheAt = 0;
}

/**
 * Extracts Answer Templates for AI roles that match the user's message or the current event plan.
 * Used to dynamically inject role logic into the System Prompt.
 * 
 * @param {string} clientMessage 
 * @param {object} eventPlan 
 * @returns {Promise<string>} Combined role instructions text.
 */
export async function extractActiveRoles(clientMessage, eventPlan = {}) {
    const entries = await loadApprovedKB();
    if (!entries || entries.length === 0) return [];

    // Filter only roles
    const roles = entries.filter(e => e.knowledge_key && e.knowledge_key.startsWith('role_'));
    if (roles.length === 0) return [];

    const normMsg = normalize(clientMessage);
    const requestedServices = new Set((eventPlan?.requested_services || []).map(s => normalize(s)));
    
    const matchedRoles = []; // Array of structural policy_config objects

    for (const role of roles) {
        let isMatch = false;

        // Upgrade legacy roles on the fly to structural format
        const structuredRole = role.policy_config ? role.policy_config : legacyRoleEntryToConfig(role);

        if (!structuredRole.active) {
            continue; // Ignore inactive roles entirely
        }

        // 1. Check if the role's service key / sub-tags are requested in the plan or directly present in text
        const roleTags = (structuredRole.triggers.service_tags || []).map(s => normalize(s));
        for (const tag of roleTags) {
            if (requestedServices.has(tag) || (normMsg.length >= MIN_MSG_LENGTH && normMsg.includes(tag))) {
                isMatch = true;
                break; // Service tag match has highest activation priority
            }
        }

        // 2. If not matched by plan, check chat text against keywords
        if (!isMatch && normMsg.length >= MIN_MSG_LENGTH) {
            const minConf = structuredRole.triggers.min_confidence || 0.35;
            const score = scorePatternMatch(normMsg, structuredRole.triggers.keywords || []);
            if (score >= minConf) { // Use dynamic confidence threshold
                isMatch = true;
            }
        }

        if (isMatch) {
            structuredRole.role_id = role.knowledge_key;
            matchedRoles.push(structuredRole);
        }
    }

    // Sort by priority (higher priority wins/comes first)
    matchedRoles.sort((a, b) => (b.priority || 100) - (a.priority || 100));

    return matchedRoles;
}
