/**
 * Transforms an array of strictly validated active role JSON configurations
 * into a single deterministic prompt block for the LLM.
 * 
 * Never dump raw JSON. Always map to readable instructions.
 */
export function buildActiveCommercialPoliciesBlock(activeRoles) {
    if (!activeRoles || activeRoles.length === 0) {
        return "";
    }

    let block = "\n=== ACTIVE COMMERCIAL POLICIES ===\n";
    block += "Follow these strict commercial rules and pricing structures based on the detected client intent.\n\n";

    for (const role of activeRoles) {
        block += `SERVICE: ${role.service_key || 'unknown'}\n`;
        block += `ROLE: ${role.role_key}\n`;
        block += `LABEL: ${role.label || 'Service'}\n\n`;

        if (role.pricing_rules) {
            block += `APPROVED PRICING:\n`;
            block += `- Base price: ${role.pricing_rules.base_price} ${role.pricing_rules.currency}\n`;
            block += `- Included duration: ${role.pricing_rules.included_duration_hours} hours\n`;
            block += `- Extra hour: ${role.pricing_rules.extra_hour_price} ${role.pricing_rules.currency}\n`;
            
            const tr = role.pricing_rules.transport_rules;
            if (tr) {
                block += `- Transport Bucharest: ${tr.bucharest === 0 ? 'Free' : tr.bucharest + ' ' + role.pricing_rules.currency}\n`;
                block += `- Transport IF: ${tr.if} ${role.pricing_rules.currency}\n`;
                block += `- Outside IF: ${tr.outside_if === 'manual_quote' ? 'require manual quote' : tr.outside_if + ' ' + role.pricing_rules.currency}\n`;
            }
            block += `\n`;
        }

        if (role.constraints) {
            block += `CONSTRAINTS:\n`;
            block += `- Discounts are ${role.constraints.allow_discounts ? 'ALLOWED' : 'NOT ALLOWED'}\n`;
            block += `- Do ${role.constraints.must_not_confirm_availability ? 'NOT ' : ''}confirm availability without operator.\n`;
            block += `- Do ${role.constraints.must_not_override_approved_prices ? 'NOT ' : ''}invent or override approved prices.\n`;
            if (role.constraints.must_collect_fields && role.constraints.must_collect_fields.length > 0) {
                block += `- Required fields to collect: ${role.constraints.must_collect_fields.join(', ')}\n`;
            }
            block += `\n`;
        }

        if (role.copy_blocks) {
            block += `APPROVED SALES COPY GUIDELINES:\n`;
            if (role.copy_blocks.intro) block += `- Intro: "${role.copy_blocks.intro}"\n`;
            if (role.copy_blocks.upsell) block += `- Upsell: "${role.copy_blocks.upsell}"\n`;
            if (role.copy_blocks.closing_question) block += `- Closing question: "${role.copy_blocks.closing_question}"\n`;
            if (role.copy_blocks.raw_legacy_logic) {
                block += `- LEGACY INSTRUCTIONS (Fallback): "${role.copy_blocks.raw_legacy_logic}"\n`;
            }
            block += `\n`;
        }

        block += `-----------------------------------\n`;
    }

    block += "=== END ACTIVE COMMERCIAL POLICIES ===\n";
    return block;
}
