/**
 * Package Presenter — Summary / Detail / Compare / Pricing modes
 *
 * Detects what the client is asking about packages and produces
 * the correct presentation mode:
 *
 *  - SUMMARY:  general package question → 3-4 representative options
 *  - DETAIL:   specific package question → full details for 1-2 packages
 *  - COMPARE:  comparative question → side-by-side relevant differences
 *  - PRICING:  price question → price range + factors
 *
 * Uses structured metadata from ai_knowledge_base.metadata.packages[]
 * Never dumps all packages with all includes in one reply.
 */

import { normalize } from './knowledgeMatcher.mjs';
import { recordEvent } from '../analytics/recordAiEvent.mjs';

// ── Intent detection patterns ──

const DETAIL_PATTERNS = [
    /ce include/i, /ce contine/i, /ce are/i,
    /include pachet/i, /detalii pachet/i,
    /spune.*mai mult/i, /mai multe detalii/i,
    /ce (e|este) in pachet/i,
    /aveti.*cu (popcorn|vata|ursitoare|confetti|tort|banner)/i,
    /pachet.*cu (popcorn|vata|ursitoare|confetti|tort|banner)/i,
    /\b(super\s*[35])\b/i
];

const COMPARE_PATTERNS = [
    /diferent[aă]/i, /compara/i, /versus/i,
    /care.*mai (bun|potrivit|ieftin|scump)/i,
    /ce.*diferit/i, /intre.*si/i,
    /care.*recomandat/i, /ce.*alegi/i,
    /diferent.*intre/i, /compari/i
];

const PRICING_PATTERNS = [
    /cat costa/i, /ce pret/i, /preturi/i, /tarif/i,
    /oferta de pret/i, /cat e/i, /pret animat/i,
    /ce preturi/i, /tarife anim/i, /cat costa anim/i,
    /de la cat/i, /pornesc de la/i
];

const FEATURE_PATTERNS = [
    /aveti.*cu\s+(popcorn|vata|ursitoare|confetti|tort|banner)/i,
    /pachet.*cu\s+(popcorn|vata|ursitoare|confetti|tort|banner)/i,
    /exista.*cu\s+(popcorn|vata|ursitoare|confetti|tort|banner)/i,
    /vreau.*cu\s+(popcorn|vata|ursitoare|confetti|tort|banner)/i
];

const PRICE_VALUE_PATTERN = /(\d{3,4})\s*(lei|ron)/i;

/**
 * Detect the presentation intent from a client message.
 *
 * @param {string} message — raw client message
 * @returns {object} { mode, feature, priceFilter }
 *   mode: 'summary' | 'detail' | 'compare' | 'pricing'
 *   feature: null | 'popcorn' | 'vata' | 'ursitoare' | 'confetti' | 'tort' | 'banner' | 'super_3' | 'super_5'
 *   priceFilter: null | number
 */
export function detectPackageIntent(message) {
    const msg = (message || '').trim();
    const normMsg = normalize(msg);

    // Feature-specific (detail mode with feature filter)
    for (const pattern of FEATURE_PATTERNS) {
        const m = msg.match(pattern);
        if (m) {
            return { mode: 'detail', feature: m[1].toLowerCase(), priceFilter: null };
        }
    }

    // Named package (Super 3, Super 5)
    if (/super\s*3/i.test(msg)) return { mode: 'detail', feature: 'super_3', priceFilter: null };
    if (/super\s*5/i.test(msg)) return { mode: 'detail', feature: 'super_5', priceFilter: null };

    // Price-specific detail (e.g. "Ce include pachetul de 490 lei?")
    const priceMatch = msg.match(PRICE_VALUE_PATTERN);
    if (priceMatch && DETAIL_PATTERNS.some(p => p.test(msg))) {
        return { mode: 'detail', feature: null, priceFilter: parseInt(priceMatch[1]) };
    }

    // Compare
    if (COMPARE_PATTERNS.some(p => p.test(msg))) {
        return { mode: 'compare', feature: null, priceFilter: null };
    }

    // Detail (generic)
    if (DETAIL_PATTERNS.some(p => p.test(msg))) {
        return { mode: 'detail', feature: null, priceFilter: null };
    }

    // Pricing
    if (PRICING_PATTERNS.some(p => p.test(msg))) {
        return { mode: 'pricing', feature: null, priceFilter: null };
    }

    // Default: summary
    return { mode: 'summary', feature: null, priceFilter: null };
}

/**
 * Format packages for a specific presentation mode.
 *
 * @param {object} kbMatch — full KB match result
 * @param {object} intent — result from detectPackageIntent
 * @param {string} conversationId — for analytics
 * @returns {string} formatted WhatsApp reply
 */
export function formatPackageReply(kbMatch, intent, conversationId) {
    const metadata = kbMatch.metadata || {};
    const packages = metadata.packages || [];
    const transportNote = metadata.transport_notes || 'Transport gratuit în București';

    if (packages.length === 0) {
        // No structured data — fall back to answer_template
        return kbMatch.answer;
    }

    let reply;
    switch (intent.mode) {
        case 'summary':
            reply = formatSummary(packages, transportNote);
            recordEvent('kb_animator_summary_used', conversationId, { knowledgeKey: kbMatch.knowledgeKey });
            break;
        case 'detail':
            reply = formatDetail(packages, intent, transportNote);
            recordEvent('kb_animator_detail_used', conversationId, { knowledgeKey: kbMatch.knowledgeKey, feature: intent.feature, priceFilter: intent.priceFilter });
            break;
        case 'compare':
            reply = formatCompare(packages, transportNote);
            recordEvent('kb_animator_compare_used', conversationId, { knowledgeKey: kbMatch.knowledgeKey });
            break;
        case 'pricing':
            reply = formatPricing(packages, transportNote);
            recordEvent('kb_animator_pricing_used', conversationId, { knowledgeKey: kbMatch.knowledgeKey });
            break;
        default:
            reply = formatSummary(packages, transportNote);
    }

    return reply;
}

// ── SUMMARY MODE ──
function formatSummary(packages, transportNote) {
    // Pick 4 representative packages across price range
    const representatives = selectRepresentatives(packages);

    const lines = ['Avem mai multe variante de animație 🎉\n'];

    const prices = packages.map(p => p.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    lines.push(`Prețuri de la ${minPrice} lei până la ${maxPrice} lei.\n`);

    for (const pkg of representatives) {
        const title = pkg.subtitle ? `${pkg.title}: ${pkg.subtitle}` : pkg.title;
        let line = `• ${title} — ${pkg.price} lei`;
        if (pkg.weekday_only) line += ' (L–V)';
        lines.push(line);
    }

    lines.push(`\n${transportNote}.`);
    lines.push('\nDacă vrei, îți recomand imediat varianta potrivită în funcție de vârsta copilului, numărul de invitați și data evenimentului! 😊');

    return lines.join('\n');
}

// ── DETAIL MODE ──
function formatDetail(packages, intent, transportNote) {
    let matched = [];

    if (intent.feature) {
        // Named package
        if (intent.feature === 'super_3') {
            matched = packages.filter(p => p.package_code === 'super_3_confetti');
        } else if (intent.feature === 'super_5') {
            matched = packages.filter(p => p.package_code === 'super_5_banner_confetti');
        } else {
            // Feature search
            matched = packages.filter(p =>
                (p.tags || []).includes(intent.feature) ||
                (p.includes || []).some(inc => normalize(inc).includes(intent.feature))
            );
        }
    } else if (intent.priceFilter) {
        matched = packages.filter(p => p.price === intent.priceFilter);
    }

    if (matched.length === 0) {
        // Fallback to summary
        return formatSummary(packages, transportNote);
    }

    const lines = [];

    if (matched.length > 1 && intent.priceFilter) {
        lines.push(`La ${intent.priceFilter} lei avem ${matched.length} variante:\n`);
    }

    for (const pkg of matched) {
        const title = pkg.subtitle ? `${pkg.title}: ${pkg.subtitle}` : pkg.title;
        lines.push(`📦 ${title} — ${pkg.price} lei`);
        if (pkg.weekday_only) lines.push('⚠️ Disponibil doar L–V');
        lines.push('');
        lines.push('Include:');
        for (const inc of (pkg.includes || [])) {
            lines.push(`  ✓ ${inc}`);
        }
        lines.push('');
    }

    lines.push(transportNote + '.');
    lines.push('\nVrei să rezervi sau ai nevoie de alte detalii? 😊');

    return lines.join('\n');
}

// ── COMPARE MODE ──
function formatCompare(packages, transportNote) {
    // Group by price, show key differences
    const sorted = [...packages].sort((a, b) => a.price - b.price);

    const lines = ['Diferențele principale între pachetele noastre:\n'];

    // Group by price tier
    const tiers = {};
    for (const pkg of sorted) {
        if (!tiers[pkg.price]) tiers[pkg.price] = [];
        tiers[pkg.price].push(pkg);
    }

    for (const [price, pkgs] of Object.entries(tiers)) {
        if (pkgs.length === 1) {
            const pkg = pkgs[0];
            const title = pkg.subtitle ? `${pkg.title}: ${pkg.subtitle}` : pkg.title;
            let extras = getExtraFeatures(pkg);
            lines.push(`📦 ${price} lei — ${title}`);
            if (extras) lines.push(`   → ${extras}`);
            if (pkg.weekday_only) lines.push('   ⚠️ Doar L–V');
        } else {
            lines.push(`📦 ${price} lei — ${pkgs.length} variante:`);
            for (const pkg of pkgs) {
                const title = pkg.subtitle ? `${pkg.title}: ${pkg.subtitle}` : pkg.title;
                let extras = getExtraFeatures(pkg);
                let line = `   • ${title}`;
                if (extras) line += ` → ${extras}`;
                if (pkg.weekday_only) line += ' (L–V)';
                lines.push(line);
            }
        }
    }

    lines.push(`\n${transportNote}.`);
    lines.push('\nCare variantă te-ar interesa mai mult? 😊');

    return lines.join('\n');
}

// ── PRICING MODE ──
function formatPricing(packages, transportNote) {
    const prices = [...new Set(packages.map(p => p.price))].sort((a, b) => a - b);
    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];

    const lines = [
        `Pachetele noastre de animație pornesc de la ${minPrice} lei 🎉\n`,
        `Avem variante la: ${prices.join(' / ')} lei\n`,
        'Prețul depinde de:',
        '• Numărul de personaje (1 sau 2)',
        '• Durata (1–3 ore)',
        '• Extra-uri incluse (confetti, vată de zahăr, popcorn, tort, ursitoare)',
        '',
        `${transportNote}.`,
        '',
        'Spune-mi ce tip de eveniment ai și câți copii vor fi, și îți recomand varianta potrivită! 😊'
    ];

    return lines.join('\n');
}

// ── Helpers ──

function selectRepresentatives(packages) {
    // Pick 4 across the spectrum: basic, mid, combo, premium
    const byCode = {};
    for (const p of packages) byCode[p.package_code] = p;

    const picks = [];

    // Basic (490 lei, first one)
    const basic = packages.find(p => p.price === 490 && !p.weekday_only);
    if (basic) picks.push(basic);

    // Mid/combo — Super 3 or confetti
    const mid = byCode['super_3_confetti'];
    if (mid) picks.push(mid);

    // Combo with popcorn/vata
    const combo = byCode['animator_vata_popcorn'];
    if (combo) picks.push(combo);

    // Premium — ursitoare
    const premium = byCode['animator_3h_4_ursitoare'];
    if (premium) picks.push(premium);

    // If we didn't get 4, fill from remaining
    if (picks.length < 4) {
        for (const p of packages) {
            if (picks.length >= 4) break;
            if (!picks.includes(p)) picks.push(p);
        }
    }

    return picks.slice(0, 4);
}

function getExtraFeatures(pkg) {
    const extras = [];
    const includes = (pkg.includes || []).map(i => i.toLowerCase());
    if (includes.some(i => i.includes('confetti'))) extras.push('confetti');
    if (includes.some(i => i.includes('vată') || i.includes('vata'))) extras.push('vată de zahăr');
    if (includes.some(i => i.includes('popcorn'))) extras.push('popcorn');
    if (includes.some(i => i.includes('tort'))) extras.push('tort dulciuri');
    if (includes.some(i => i.includes('ursitoare'))) extras.push('ursitoare');
    if (includes.some(i => i.includes('banner'))) extras.push('banner personalizat');
    return extras.length > 0 ? extras.join(', ') : null;
}

/**
 * Check if a KB match has structured package data that can be presented.
 */
export function hasStructuredPackages(kbMatch) {
    return kbMatch &&
        kbMatch.metadata &&
        Array.isArray(kbMatch.metadata.packages) &&
        kbMatch.metadata.packages.length > 0;
}
