/**
 * Quote Formatter
 *
 * Formats a quote object for WhatsApp message and for Brain Tab.
 */

/**
 * Format quote for WhatsApp — human-readable, emoji-rich.
 *
 * @param {object} quote - ai_quotes row
 * @param {object} eventPlan - ai_event_plans row
 * @returns {string} formatted message
 */
export function formatQuoteForWhatsApp(quote, eventPlan) {
    if (!quote || !quote.line_items?.length) {
        return 'Nu am suficiente date pentru a genera o ofertă.';
    }

    const lines = [];

    // ── Header ──
    lines.push('📋 *Propunere eveniment*\n');

    if (eventPlan) {
        const details = [];
        if (eventPlan.event_date) details.push(`📅 ${eventPlan.event_date}`);
        if (eventPlan.location) details.push(`📍 ${eventPlan.location}`);
        const childrenCount = eventPlan.children_count_estimate || eventPlan.guest_count;
        if (childrenCount) details.push(`👧 ${childrenCount} copii`);
        if (details.length > 0) lines.push(details.join('  '));
        lines.push('');
    }

    // ── Line items ──
    let itemNo = 0;
    for (const item of quote.line_items) {
        if (item.item_type === 'extra_hours') continue; // already shown in package
        itemNo++;
        const price = item.total_price ? `*${item.total_price} lei*` : '_preț la cerere_';
        lines.push(`${itemNo}. ${item.title} — ${price}`);
        if (item.notes) lines.push(`   _${item.notes}_`);
    }

    lines.push('');

    // ── Totals ──
    if (quote.subtotal > 0) {
        lines.push(`Subtotal: ${quote.subtotal} lei`);
    }
    if (quote.transport_cost > 0) {
        lines.push(`Transport: ${quote.transport_cost} lei`);
    }
    if (quote.discount_total > 0) {
        lines.push(`Discount: -${quote.discount_total} lei`);
    }
    lines.push(`\n💰 *Total: ${quote.grand_total} lei*`);

    // ── Included ──
    if (quote.included_items?.length > 0) {
        lines.push('\nInclude:');
        for (const item of quote.included_items) {
            lines.push(`  ✓ ${item}`);
        }
    }

    // ── Assumptions / missing info ──
    if (quote.missing_info_notes?.length > 0) {
        lines.push('\n⚠️ De clarificat:');
        for (const note of quote.missing_info_notes) {
            lines.push(`  • ${note}`);
        }
    }

    // ── Validity ──
    if (quote.valid_until) {
        lines.push(`\nOfertă valabilă până la: ${quote.valid_until}`);
    }

    // ── CTA ──
    lines.push('\nDacă te pot ajuta cu altceva, sunt aici! Iar când vrei să confirmi, am nevoie de câteva detalii 😊');

    return lines.join('\n');
}

/**
 * Format quote for Brain Tab — structured schema.
 *
 * @param {object} quote - ai_quotes row
 * @returns {object} schema section for buildBrainSchema
 */
export function formatQuoteForBrainTab(quote) {
    if (!quote) return null;

    const statusLabels = {
        draft: '📝 Draft',
        ready: '✅ Gata de trimis',
        sent: '📤 Trimisă',
        revised: '🔄 Revizuită',
        accepted: '✅ Acceptată',
        rejected: '❌ Respinsă',
        expired: '⏰ Expirată',
        cancelled: '🚫 Anulată'
    };

    const items = [
        { label: 'Status', value: statusLabels[quote.status] || quote.status },
        { label: 'Versiune', value: `v${quote.version_no}` },
        { label: 'Total', value: `${quote.grand_total} ${quote.currency}` }
    ];

    // Add line items summary
    const serviceItems = (quote.line_items || [])
        .filter(li => li.item_type !== 'extra_hours')
        .map(li => `${li.title}: ${li.total_price || '?'} lei`);

    if (serviceItems.length > 0) {
        items.push({ label: 'Servicii', value: serviceItems.join(', ') });
    }

    if (quote.transport_cost > 0) {
        items.push({ label: 'Transport', value: `${quote.transport_cost} lei` });
    }

    if (quote.valid_until) {
        items.push({ label: 'Valabilă până', value: quote.valid_until });
    }

    return {
        type: 'quote_card',
        title: '💼 Ofertă',
        items
    };
}
