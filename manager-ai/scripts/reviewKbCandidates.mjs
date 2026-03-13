#!/usr/bin/env node
/**
 * KB Candidate Review CLI
 *
 * Usage:
 *   node scripts/reviewKbCandidates.mjs --list
 *   node scripts/reviewKbCandidates.mjs --approve <id> [--by <name>] [--notes "reason"]
 *   node scripts/reviewKbCandidates.mjs --reject <id> [--by <name>] [--reason "why"]
 *   node scripts/reviewKbCandidates.mjs --report
 */

import dotenv from 'dotenv';
dotenv.config();

import { listCandidates, approveCandidate, rejectCandidate } from '../src/knowledge/kbReviewWorkflow.mjs';
import { pathDistribution, topKbHits, topNoMatchQueries, topCandidates, decisionDistribution, followUpStats } from '../src/analytics/kbAnalytics.mjs';

const args = process.argv.slice(2);

function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

async function main() {
    if (args.includes('--list')) {
        console.log('\n📋 KB Candidate Review Queue\n');
        const result = await listCandidates({ limit: 30 });
        if (!result.success) { console.error('Error:', result.error); return; }
        if (result.count === 0) { console.log('  No candidates pending review.'); return; }

        for (const c of result.candidates) {
            console.log(`─── ID: ${c.id} ───`);
            console.log(`  Scope:    ${c.correction_scope}`);
            console.log(`  Times:    ${c.times_seen}`);
            console.log(`  Services: [${(c.service_tags || []).join(', ')}]`);
            console.log(`  Question: "${(c.question_context || '').substring(0, 80)}"`);
            console.log(`  Original: "${(c.original_ai_reply || '').substring(0, 80)}"`);
            console.log(`  Correct:  "${c.corrected_reply.substring(0, 80)}"`);
            console.log(`  Created:  ${c.created_at}`);
            console.log();
        }
        console.log(`Total: ${result.count} candidates`);

    } else if (args.includes('--approve')) {
        const id = getArg('--approve');
        if (!id) { console.error('Usage: --approve <id>'); return; }
        const by = getArg('--by') || 'admin';
        const notes = getArg('--notes');
        console.log(`\n✅ Approving candidate ${id}...`);
        const result = await approveCandidate(id, { reviewedBy: by, reviewNotes: notes });
        console.log('Result:', JSON.stringify(result, null, 2));

    } else if (args.includes('--reject')) {
        const id = getArg('--reject');
        if (!id) { console.error('Usage: --reject <id>'); return; }
        const by = getArg('--by') || 'admin';
        const reason = getArg('--reason');
        console.log(`\n❌ Rejecting candidate ${id}...`);
        const result = await rejectCandidate(id, { reviewedBy: by, rejectionReason: reason });
        console.log('Result:', JSON.stringify(result, null, 2));

    } else if (args.includes('--report')) {
        const hours = parseInt(getArg('--hours') || '24');
        console.log(`\n📊 AI Analytics Report (last ${hours}h)\n`);

        console.log('─── Path Distribution ───');
        const paths = await pathDistribution(hours);
        console.log(`  KB Direct:    ${paths.kb_direct_answer}`);
        console.log(`  KB Grounded:  ${paths.kb_grounded_composer}`);
        console.log(`  LLM Fallback: ${paths.llm_fallback}`);
        console.log(`  KB Rate:      ${paths.kb_rate}`);
        console.log(`  Total:        ${paths.total}`);

        console.log('\n─── Decision Distribution ───');
        const decisions = await decisionDistribution(hours);
        for (const [k, v] of Object.entries(decisions)) {
            if (k !== 'period') console.log(`  ${k}: ${v}`);
        }

        console.log('\n─── Top KB Hits ───');
        const hits = await topKbHits(10);
        for (const h of (hits || [])) {
            console.log(`  ${h.knowledge_key} (${h.times_used}x) [${(h.service_tags || []).join(',')}]`);
        }

        console.log('\n─── Top No-Match Queries ───');
        const misses = await topNoMatchQueries(10, hours);
        for (const m of (misses || [])) {
            console.log(`  "${(m.client_message || '').substring(0, 60)}" (score=${m.best_score?.toFixed(2) || '0'})`);
        }

        console.log('\n─── KB Candidate Backlog ───');
        const candidates = await topCandidates(10);
        for (const c of (candidates || [])) {
            console.log(`  [${c.id.substring(0, 8)}] "${(c.question_context || '').substring(0, 50)}" (${c.times_seen}x, scope=${c.correction_scope})`);
        }

        console.log('\n─── Follow-Up Stats ───');
        const fu = await followUpStats(hours);
        for (const [k, v] of Object.entries(fu)) {
            if (k !== 'period') console.log(`  ${k}: ${v}`);
        }

    } else {
        console.log(`
KB Candidate Review & Analytics CLI

Usage:
  --list                  List pending KB candidates
  --approve <id>          Approve a candidate (creates KB entry)
    --by <name>           Reviewer name (default: admin)
    --notes "reason"      Review notes
  --reject <id>           Reject a candidate
    --by <name>           Reviewer name
    --reason "why"        Rejection reason
  --report                Full analytics report
    --hours <N>           Time window (default: 24)
`);
    }

    // Give async fire-and-forget events time to flush
    await new Promise(r => setTimeout(r, 500));
}

main().catch(console.error);
