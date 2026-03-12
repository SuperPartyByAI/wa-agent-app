import { CATALOG_MAP } from '../services/postProcessServices.mjs';

/**
 * Evaluates the quality of a composed reply using heuristics.
 * No LLM call — pure rule-based for speed + transparency.
 *
 * @param {object} params
 * @param {string} params.reply             - final composed reply
 * @param {object} params.analysis          - LLM analysis output
 * @param {object} params.replyContext      - from buildReplyContext()
 * @param {object} params.entityMemory      - entity memory
 * @param {string} params.replyStyle        - detected style mode
 * @param {boolean} params.composerUsed     - whether composer ran successfully
 * @returns {object} quality evaluation
 */
export function evaluateReplyQuality({
    reply,
    analysis,
    replyContext,
    entityMemory,
    replyStyle,
    composerUsed
}) {
    const flags = [];
    let score = 100; // start perfect, deduct for issues

    const replyLower = (reply || '').toLowerCase();
    const replyLen = (reply || '').length;
    const services = analysis.selected_services || [];

    // ── 1. Specificity checks ──

    // If services detected but reply doesn't mention ANY of them → too generic
    if (services.length > 0) {
        const anyServiceMentioned = services.some(svc => {
            const entry = CATALOG_MAP[svc];
            const displayName = (entry?.display_name || svc).toLowerCase();
            const key = svc.toLowerCase().replace(/_/g, ' ');
            return replyLower.includes(displayName) || replyLower.includes(key);
        });
        if (anyServiceMentioned) {
            flags.push('good_service_specificity');
        } else {
            flags.push('not_service_specific');
            score -= 20;
        }
    }

    // ── 2. Question count check ──
    const questionMarks = (reply || '').split('?').length - 1;
    if (questionMarks === 1) {
        flags.push('good_next_question');
    } else if (questionMarks === 0) {
        flags.push('no_question_asked');
        score -= 10;
    } else if (questionMarks > 2) {
        flags.push('too_many_questions');
        score -= 15;
    }

    // ── 3. Length checks ──
    if (replyLen > 300) {
        flags.push('too_long');
        score -= 15;
    } else if (replyLen < 15) {
        flags.push('too_short');
        score -= 20;
    } else if (replyLen <= 200) {
        flags.push('good_length');
    }

    // ── 4. Robotic/corporate patterns ──
    const roboticPatterns = [
        'avem nevoie de urmatoarele',
        'va rugam sa ne comunicati',
        'procesarii cererii',
        'informatii necesare',
        'va stam la dispozitie',
        'cu profesionalism',
        'multumim pentru incredere',
        'va asiguram',
        'pentru a putea procesa',
        'in vederea'
    ];
    const roboticFound = roboticPatterns.filter(p => replyLower.includes(p));
    if (roboticFound.length > 0) {
        flags.push('too_robotic');
        score -= 10 * roboticFound.length;
    }

    // ── 5. Generic vagueness patterns ──
    const vaguePatterns = [
        'cu ce aveti in minte',
        'spuneti-ne mai multe',
        'suntem la dispozitie',
        'mai multe detalii',
        'orice aveti nevoie',
        'ce va putem ajuta'
    ];
    const vagueFound = vaguePatterns.filter(p => replyLower.includes(p));
    if (vagueFound.length > 0) {
        flags.push('too_generic');
        score -= 15 * vagueFound.length;
    }

    // ── 6. Memory reuse check ──
    if (entityMemory && entityMemory.entity_type !== 'unknown') {
        // If we have memory but the reply asks for something we already know
        const knownLocations = entityMemory.usual_locations?.map(l => l.name.toLowerCase()) || [];
        if (knownLocations.length > 0) {
            const asksLocationDirectly = replyLower.includes('unde va fi') ||
                replyLower.includes('care este locatia') ||
                replyLower.includes('unde este');
            const usesMemory = knownLocations.some(loc => replyLower.includes(loc));
            if (usesMemory) {
                flags.push('memory_used_well');
            } else if (asksLocationDirectly) {
                flags.push('poor_memory_use');
                score -= 10;
            }
        }
    }

    // ── 7. Checklist-like detection (multiple commas listing requirements) ──
    const commaCount = (reply || '').split(',').length - 1;
    if (commaCount >= 4 && questionMarks <= 1) {
        flags.push('checklist_like');
        score -= 10;
    }

    // ── 8. Composer fallback penalty ──
    if (!composerUsed) {
        flags.push('composer_fallback');
        score -= 20;
    }

    // ── 9. Emoji check ──
    const emojiCount = ((reply || '').match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    if (emojiCount > 3) {
        flags.push('too_many_emoji');
        score -= 5;
    } else if (emojiCount >= 1 && emojiCount <= 2) {
        flags.push('good_emoji_use');
    }

    // ── Clamp score ──
    score = Math.max(0, Math.min(100, score));

    // ── Label ──
    let label;
    if (score >= 80) label = 'good';
    else if (score >= 50) label = 'okay';
    else label = 'weak';

    // ── Primary weakness ──
    const weaknessMap = {
        not_service_specific: 'Nu menționează serviciile detectate',
        too_generic: 'Reply prea generic/vag',
        too_robotic: 'Formulare robotică/corporate',
        too_many_questions: 'Prea multe întrebări deodată',
        too_long: 'Reply prea lung',
        too_short: 'Reply prea scurt',
        poor_memory_use: 'Nu folosește memoria clientului',
        checklist_like: 'Sună ca un checklist',
        no_question_asked: 'Nu pune nicio întrebare',
        composer_fallback: 'Composer-ul a căzut pe fallback'
    };

    const negativeFlags = flags.filter(f => weaknessMap[f]);
    const primaryWeakness = negativeFlags.length > 0 ? weaknessMap[negativeFlags[0]] : null;

    return {
        reply_quality_score: score,
        reply_quality_label: label,
        reply_quality_flags: flags,
        primary_weakness: primaryWeakness,
        question_count: questionMarks,
        reply_length: replyLen,
        composer_used: composerUsed,
        reply_style: replyStyle
    };
}
