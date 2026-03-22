/**
 * Policy Validator — Schema + Integrity Checks
 *
 * Run: node scripts/validate-policies.mjs [path_to_policy.json]
 * Ticket: stabilizare/antigravity - Policy Validation
 */

import fs from 'fs';
import crypto from 'crypto';

const policyPath = process.argv[2] || 'runtime_rules/policy.json';

function validate(policy) {
    const errors = [];

    // Structure checks
    if (!policy.version) errors.push('Missing version');
    if (!policy.rules || !Array.isArray(policy.rules)) errors.push('Missing or invalid rules array');
    if (!policy.coverage || !Array.isArray(policy.coverage)) errors.push('Missing or invalid coverage array');

    // Rule validation
    const ruleNames = new Set();
    for (const [i, rule] of (policy.rules || []).entries()) {
        if (!rule.name) errors.push(`rules[${i}]: missing name`);
        if (!rule.trigger) errors.push(`rules[${i}]: missing trigger`);
        if (!rule.behavior) errors.push(`rules[${i}]: missing behavior`);
        if (!['USE_KB', 'CLARIFY_FIRST', 'HANDOFF', 'BLOCK', 'AUTO_REPLY'].includes(rule.behavior)) {
            errors.push(`rules[${i}]: invalid behavior '${rule.behavior}'`);
        }
        if (ruleNames.has(rule.name)) errors.push(`rules[${i}]: duplicate name '${rule.name}'`);
        ruleNames.add(rule.name);
        if (rule.priority !== undefined && (rule.priority < 0 || rule.priority > 100)) {
            errors.push(`rules[${i}]: priority must be 0-100, got ${rule.priority}`);
        }
    }

    // Coverage validation
    const validModes = ['allow_autoreply', 'shadow_only', 'operator_review', 'blocked'];
    for (const [i, zone] of (policy.coverage || []).entries()) {
        if (!zone.zone) errors.push(`coverage[${i}]: missing zone name`);
        if (!zone.allowed_mode) errors.push(`coverage[${i}]: missing allowed_mode`);
        if (zone.allowed_mode && !validModes.includes(zone.allowed_mode)) {
            errors.push(`coverage[${i}]: invalid allowed_mode '${zone.allowed_mode}'`);
        }
    }

    // Checksum verification if present
    if (policy.checksum) {
        const content = JSON.stringify({ rules: policy.rules, coverage: policy.coverage, policies: policy.policies || [] });
        const computed = crypto.createHash('sha256').update(content).digest('hex');
        if (policy.checksum !== computed) {
            errors.push(`Checksum mismatch: expected=${policy.checksum.substring(0, 12)}... computed=${computed.substring(0, 12)}...`);
        }
    }

    return errors;
}

// Main
try {
    console.log(`Validating: ${policyPath}`);
    const content = fs.readFileSync(policyPath, 'utf8');
    const policy = JSON.parse(content);

    const errors = validate(policy);

    if (errors.length > 0) {
        console.error('\n❌ VALIDATION FAILED:');
        errors.forEach(e => console.error(`  - ${e}`));
        process.exit(2);
    }

    console.log(`\n✅ Policy valid`);
    console.log(`  Version: ${policy.version}`);
    console.log(`  Rules: ${policy.rules?.length || 0}`);
    console.log(`  Coverage: ${policy.coverage?.length || 0}`);
    console.log(`  Policies: ${policy.policies?.length || 0}`);
    process.exit(0);
} catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
}
