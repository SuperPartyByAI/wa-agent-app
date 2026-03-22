/**
 * Export Approved Corrections → JSONL Training Dataset
 *
 * Run: node --env-file=.env scripts/export-approved-corrections.mjs
 * Output: training_dataset.jsonl + validation_dataset.jsonl (90/10 split)
 *
 * Ticket: stabilizare/antigravity - Training Pipeline
 */

import fs from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

async function main() {
    console.log('=== Exporting approved corrections ===');

    const { data, error } = await supabase
        .from('corrections')
        .select('*')
        .eq('approved', true)
        .order('created_at', { ascending: true });

    if (error) throw error;
    if (!data?.length) {
        console.log('No approved corrections found.');
        return;
    }

    console.log(`Found ${data.length} approved corrections`);

    const seen = new Set();
    const lines = [];

    for (const r of data) {
        // Build instruction/response format
        const input = typeof r.request_redacted === 'string'
            ? r.request_redacted
            : JSON.stringify(r.request_redacted);

        const output = typeof r.corrected_decision === 'string'
            ? r.corrected_decision
            : JSON.stringify(r.corrected_decision);

        // Dedup by content hash
        const key = hash(input + '||' + output);
        if (seen.has(key)) continue;
        seen.add(key);

        lines.push(JSON.stringify({
            input,
            output,
            trace_id: r.trace_id,
            policy_version: r.policy_version,
            model_version: r.model_version,
            tags: r.tags
        }));
    }

    if (!lines.length) {
        console.log('No unique entries after dedup.');
        return;
    }

    // 90/10 train/validation split
    const splitIdx = Math.floor(lines.length * 0.9);
    const trainLines = lines.slice(0, Math.max(splitIdx, 1));
    const valLines = lines.slice(splitIdx);

    fs.writeFileSync('training_dataset.jsonl', trainLines.join('\n') + '\n');
    console.log(`✅ training_dataset.jsonl: ${trainLines.length} entries`);

    if (valLines.length > 0) {
        fs.writeFileSync('validation_dataset.jsonl', valLines.join('\n') + '\n');
        console.log(`✅ validation_dataset.jsonl: ${valLines.length} entries`);
    }

    console.log(`\n=== Export complete: ${lines.length} total, ${trainLines.length} train, ${valLines.length} val ===`);
}

main().catch(e => { console.error('Export failed:', e.message); process.exit(1); });
