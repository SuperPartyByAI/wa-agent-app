import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Transport pricing (from KB) ──
const TRANSPORT_ZONES = {
    bucuresti: 0,
    ilfov: 50,
    near: 100,     // <= 50km
    medium: 200,   // 50-100km
    far: 350        // > 100km
};

const EXTRA_HOUR_PRICE = 170; // Still hardcoded or can be moved to KB later

/**
 * Fetch dynamic package catalog from KB.
 */
async function fetchPackagesCatalog() {
    const { data } = await supabase
        .from('ai_knowledge_base')
        .select('metadata')
        .eq('knowledge_key', 'animator_packages')
        .single();
    
    if (data && data.metadata && data.metadata.packages) {
        return data.metadata.packages;
    }
    return [];
}

/**
 * Build a quote draft from an event plan.
 *
 * @param {object} eventPlan - ai_event_plans row
 * @param {object} options
 * @param {string} options.packageCode - selected package code (e.g., 'super_3_confetti')
 * @param {number} options.durationHours - requested duration
 * @param {object[]} options.additionalItems - extra services
 * @returns {object} quote object ready to insert
 */
export async function buildQuoteDraft(eventPlan, options = {}) {
    const lineItems = [];
    const assumptions = [];
    const missingInfoNotes = [];

    if (!eventPlan) {
        return { error: 'No event plan provided' };
    }

    // ── Animator package line item ──
    const pkgCode = options.packageCode || eventPlan.selected_package?.package;
    const duration = options.durationHours || eventPlan.selected_package?.duration;

    if (pkgCode) {
        const catalog = await fetchPackagesCatalog();
        const pkg = catalog.find(p => p.package_code === pkgCode || p.title.toLowerCase().includes(String(pkgCode).toLowerCase()));

        if (pkg) {
            const includedHours = parseInt(pkg.duration_text) || 2; // fallback to 2
            const requestedHours = duration || includedHours;
            const extraHours = Math.max(0, requestedHours - includedHours);
            const extraCost = extraHours * EXTRA_HOUR_PRICE;

            lineItems.push({
                item_type: 'package',
                service_key: 'animator',
                package_key: pkg.package_code,
                title: pkg.title + (pkg.subtitle ? ` (${pkg.subtitle})` : ''),
                quantity: 1,
                duration_hours: requestedHours,
                unit_price: pkg.price,
                total_price: pkg.price + extraCost,
                notes: extraHours > 0
                    ? `Include ${includedHours}h + ${extraHours}h extra × ${EXTRA_HOUR_PRICE} lei`
                    : `Include ${includedHours}h`
            });

            if (extraHours > 0) {
                lineItems.push({
                    item_type: 'extra_hours',
                    service_key: 'animator',
                    title: `Ore extra animator (${extraHours}h × ${EXTRA_HOUR_PRICE} lei)`,
                    quantity: extraHours,
                    unit_price: EXTRA_HOUR_PRICE,
                    total_price: extraCost,
                    notes: ''
                });
            }
        } else {
            missingInfoNotes.push(`Pachetul cerut ("${pkgCode}") nu a fost găsit în catalog.`);
        }
    } else if ((eventPlan.requested_services || []).includes('animator')) {
        missingInfoNotes.push('Pachetul animator nu a fost selectat încă.');
    }

    // ── Additional service items ──
    for (const svc of (eventPlan.requested_services || [])) {
        if (svc === 'animator') continue; // handled above

        // Service pricing loaded from KB catalog when available
        lineItems.push({
            item_type: 'service',
            service_key: svc,
            title: svc.replaceAll('_', ' '),
            quantity: 1,
            unit_price: null, // to be filled
            total_price: null,
            notes: 'Preț pe baza detaliilor finale'
        });
        assumptions.push(`Prețul pentru ${svc} va fi stabilit pe baza detaliilor finale.`);
    }

    // ── Extra items from options ──
    for (const item of (options.additionalItems || [])) {
        lineItems.push({
            item_type: 'extra',
            service_key: item.service_key || 'extra',
            title: item.title,
            quantity: item.quantity || 1,
            unit_price: item.unit_price || 0,
            total_price: (item.quantity || 1) * (item.unit_price || 0),
            notes: item.notes || ''
        });
    }

    // ── Transport ──
    const transportZone = eventPlan.transport_zone || 'bucuresti';
    const transportCost = TRANSPORT_ZONES[transportZone] || 0;

    // ── Calculate totals ──
    const subtotal = lineItems.reduce((sum, item) => sum + (item.total_price || 0), 0);
    const grandTotal = subtotal + transportCost;

    // ── Assumptions ──
    if (!eventPlan.event_date) missingInfoNotes.push('Data evenimentului nu a fost specificată.');
    if (!eventPlan.children_count_estimate && !eventPlan.guest_count) missingInfoNotes.push('Numărul de copii nu a fost specificat.');
    assumptions.push(`Transport: zona ${transportZone} — ${transportCost > 0 ? transportCost + ' lei' : 'inclus'}.`);

    // ── Build quote ──
    const quote = {
        event_plan_id: eventPlan.id,
        conversation_id: eventPlan.conversation_id,
        client_id: eventPlan.client_id,
        version_no: 1,
        status: 'draft',
        currency: 'RON',
        line_items: lineItems,
        subtotal,
        transport_cost: transportCost,
        discount_total: 0,
        grand_total: grandTotal,
        assumptions,
        included_items: ['Jocuri & concursuri', 'Baloane modelate', 'Pictură pe față', 'Diplome magnetice'],
        excluded_items: [],
        missing_info_notes: missingInfoNotes,
        valid_until: getValidUntilDate(),
        generated_by: 'ai',
        approved_by_operator: false
    };

    return quote;
}

/**
 * Save a quote draft to DB.
 */
export async function saveQuoteDraft(quote) {
    // Check for existing draft on the same event plan
    const { data: existing } = await supabase
        .from('ai_quotes')
        .select('id, version_no')
        .eq('event_plan_id', quote.event_plan_id)
        .in('status', ['draft', 'ready'])
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existing) {
        // Create new version
        quote.version_no = existing.version_no + 1;

        // Archive old one
        await supabase
            .from('ai_quotes')
            .update({ status: 'revised', updated_at: new Date().toISOString() })
            .eq('id', existing.id);

        // Snapshot old version
        await supabase.from('ai_quote_versions').insert({
            quote_id: existing.id,
            version_no: existing.version_no,
            snapshot_json: existing,
            change_reason: 'Revised — new version created',
            changed_by: 'ai'
        });
    }

    const { data: saved, error } = await supabase
        .from('ai_quotes')
        .insert(quote)
        .select('id, version_no')
        .single();

    if (error) {
        console.error('[Quote] Save error:', error.message);
        return null;
    }

    // Log action
    await supabase.from('ai_quote_actions').insert({
        quote_id: saved.id,
        action: 'created',
        actor: 'ai',
        details: `Draft v${saved.version_no} created`,
        metadata_json: { line_items_count: quote.line_items.length, grand_total: quote.grand_total }
    });

    console.log(`[Quote] Draft v${saved.version_no} saved: ${saved.id}, total=${quote.grand_total} RON`);
    return saved;
}

/**
 * Load latest quote for an event plan.
 */
export async function loadLatestQuote(eventPlanId) {
    if (!eventPlanId) return null;

    const { data } = await supabase
        .from('ai_quotes')
        .select('*')
        .eq('event_plan_id', eventPlanId)
        .order('version_no', { ascending: false })
        .limit(1)
        .maybeSingle();

    return data;
}

function getValidUntilDate() {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
}
