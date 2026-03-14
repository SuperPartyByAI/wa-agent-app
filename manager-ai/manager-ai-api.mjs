import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();

// ── Debounce state: per-conversation timer to coalesce rapid messages ──
const DEBOUNCE_MS = parseInt(process.env.AI_DEBOUNCE_MS || '15000', 10);
const debounceTimers = new Map(); // conversation_id → { timer, latestMessageId, count }
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// whts-up transport config for operator-approved send
const WHTSUP_API_URL = process.env.WHTSUP_API_URL || 'http://5.161.179.132:3000';
const WHTSUP_API_KEY = process.env.WHTSUP_API_KEY || process.env.API_KEY;

// Webhook inside from whts-up (WhatsApp transport)
app.post('/webhook/whts-up', async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature'];
        const webhookSecret = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';
        
        if (!signature) {
            console.warn('[Webhook security] Missing signature');
            return res.status(401).json({ error: 'Missing signature' });
        }
        
        const bodyStr = req.rawBody || JSON.stringify(req.body);
        const hash = `sha256=${crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex')}`;
        
        if (hash !== signature) {
            console.warn('[Webhook security] Invalid signature');
            return res.status(403).json({ error: 'Invalid signature' });
        }
        
        const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { message_id, conversation_id, content, sender_type } = payload;
        console.log(`[Webhook MSG] Received verified msg ${message_id} for conv ${conversation_id} from ${sender_type}`);
        
        // Idempotency check: see if we already have this message processed
        const { data: stateData } = await supabase
            .from('ai_conversation_state')
            .select('last_processed_message_id')
            .eq('conversation_id', conversation_id)
            .maybeSingle();
            
        if (stateData && stateData.last_processed_message_id === message_id) {
             console.log(`[Webhook MSG] Idempotency catch: Msg ${message_id} already processed. Skipping.`);
             return res.status(200).json({ status: 'already_processed' });
        }
        
        // Return 200 immediately to not block WhatsApp
        res.status(200).json({ status: 'queued' });
        
        // ── Debounce: coalesce rapid messages into one pipeline run ──
        const existing = debounceTimers.get(conversation_id);
        if (existing) {
            clearTimeout(existing.timer);
            existing.latestMessageId = message_id;
            existing.count += 1;
            console.log(`[Debounce] Reset timer for ${conversation_id} (${existing.count} msgs coalesced)`);
        }
        
        const entry = existing || { latestMessageId: message_id, count: 1 };
        entry.timer = setTimeout(() => {
            debounceTimers.delete(conversation_id);
            console.log(`[Debounce] Firing pipeline for ${conversation_id} (coalesced ${entry.count} msgs)`);
            processConversation(conversation_id, entry.latestMessageId).catch(console.error);
        }, DEBOUNCE_MS);
        
        if (!existing) debounceTimers.set(conversation_id, entry);
    } catch (e) {
        console.error('[Webhook error]', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint for Android app to fetch dynamic UI schema (Brain AI tab)
app.get('/api/ai/conversation/:conversation_id/schema', async (req, res) => {
    const { conversation_id } = req.params;
    
    // Fetch the latest generated schema for this conversation
    const { data: schemaRow, error } = await supabase
        .from('ai_ui_schemas')
        .select('*')
        .eq('conversation_id', conversation_id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
        
    if (error) {
        console.error("Error fetching schema:", error);
        return res.status(500).json({ error: error.message });
    }
    
    if (!schemaRow || !schemaRow.layout_json) {
        // Fallback generic layout if AI hasn't processed it yet
        return res.json({
            layout: [
                {
                    type: "card",
                    title: "Status AI",
                    items: [
                        { label: "Analiză", value: "În desfășurare..." }
                    ]
                }
            ]
        });
    }

    // Android app blindly renders this array
    res.json({ layout: schemaRow.layout_json });
});

// Endpoint for Android app to send an operator note/prompt
// This triggers re-processing with the operator's instruction
app.post('/api/ai/prompt', async (req, res) => {
    const { conversation_id, prompt_text, created_by } = req.body;
    
    if (!conversation_id || !prompt_text) {
        return res.status(400).json({ error: 'conversation_id and prompt_text are required' });
    }

    // Save operator prompt
    const { error } = await supabase.from('ai_operator_prompts').insert({
        conversation_id,
        prompt_text,
        prompt_type: 'instruction',
        created_by: created_by || 'operator'
    });
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(200).json({ status: 'regenerating' });
    
    // Trigger re-processing WITH the operator's prompt
    processConversation(conversation_id, null, prompt_text).catch(console.error);
});

// Endpoint for operator to approve and send a suggested reply
app.post('/api/ai/reply/approve', async (req, res) => {
    const { conversation_id, reply_text, decision_id } = req.body;

    if (!conversation_id || !reply_text) {
        return res.status(400).json({ error: 'conversation_id and reply_text are required' });
    }

    // Get session_id for sending
    const { data: conv } = await supabase.from('conversations').select('session_id').eq('id', conversation_id).single();
    if (!conv?.session_id) {
        return res.status(400).json({ error: 'No session found for this conversation' });
    }

    try {
        // Send via whts-up transport
        const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WHTSUP_API_KEY
            },
            body: JSON.stringify({
                sessionId: conv.session_id,
                conversationId: conversation_id,
                text: reply_text,
                message_type: 'text'
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[Reply Approve] Send failed:', err);
            return res.status(500).json({ error: 'Failed to send message', details: err });
        }

        // Update audit trail if decision_id provided
        if (decision_id) {
            await supabase.from('ai_reply_decisions').update({
                reply_status: 'sent',
                sent_by: 'operator',
                sent_at: new Date().toISOString(),
                operator_edit: reply_text
            }).eq('id', decision_id);
        }

        console.log(`[Reply Approve] ✅ Operator-approved reply sent for ${conversation_id}`);
        res.status(200).json({ status: 'sent' });
    } catch (err) {
        console.error('[Reply Approve] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

import { processConversation } from './src/orchestration/processConversation.mjs';
import { getAuditSummary, getRecentDecisions, getConversationDiagnostic } from './src/repositories/auditRepository.mjs';
import { saveOperatorFeedback, getOperatorFeedbackStats } from './src/feedback/operatorFeedback.mjs';
import { computeShadowAnalytics } from './src/analytics/shadowAnalytics.mjs';
import { evaluateFullGate, checkSchemaReady } from './src/rollout/rolloutGate.mjs';
import { getCurrentRolloutState, transitionRolloutState, autoEvaluateRollout, getRolloutHistory } from './src/rollout/rolloutStateMachine.mjs';
import { getOperatorReviewData } from './src/feedback/operatorReviewData.mjs';
import { computeScorecard } from './src/analytics/operatorScorecard.mjs';
import { executeAutoRollback, evaluateRollback } from './src/rollout/rollbackEvaluator.mjs';
import { detectMemoryConflicts } from './src/rollout/memoryConflictDetector.mjs';
import { isWave2Eligible } from './src/rollout/wave2Eligibility.mjs';

// ─── Phase 6: Operational Endpoints ───

app.get('/api/ai/health', async (req, res) => {
    try {
        // Supabase check
        const { data: sbCheck, error: sbErr } = await supabase.from('ai_runtime_context')
            .select('id').limit(1);
        const supabaseOk = !sbErr;

        // Schema check
        const schemaResult = await checkSchemaReady(supabase);

        // LLM check (quick test)
        let llmOk = false;
        try {
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`,
                { signal: AbortSignal.timeout(5000) }
            );
            llmOk = resp.ok;
        } catch { llmOk = false; }

        // Operational mode
        const mode = process.env.AI_SHADOW_MODE_ENABLED === 'true' ? 'shadow_mode'
            : process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true' ? 'safe_autoreply_mode'
            : 'legacy';

        const healthy = supabaseOk && schemaResult.ready && llmOk;

        res.json({
            healthy,
            operational_mode: mode,
            supabase_reachable: supabaseOk,
            schema_ok: schemaResult.ready,
            schema_missing: schemaResult.missing || [],
            llm_reachable: llmOk,
            wave1_enabled: process.env.AI_WAVE1_ENABLED === 'true',
            wave2_enabled: process.env.AI_WAVE2_ENABLED === 'true',
            auto_rollback: process.env.AI_WAVE1_AUTO_ROLLBACK_ENABLED !== 'false',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ healthy: false, error: err.message });
    }
});

app.get('/api/ai/readiness', async (req, res) => {
    try {
        // Context pack
        const { data: ctx } = await supabase.from('ai_runtime_context')
            .select('version, deployed_commit_sha, is_active, published_at')
            .eq('is_active', true).order('published_at', { ascending: false }).limit(1).maybeSingle();

        // Rollout state
        const state = await getCurrentRolloutState();

        // Gate evaluation
        const hours = parseInt(req.query.hours || '72', 10);
        const kpis = await computeShadowAnalytics(hours);
        const gate = await evaluateFullGate(kpis, state.current_state);

        // Schema
        const schema = await checkSchemaReady(supabase);

        // Feature flags
        const flags = {
            shadow_mode: process.env.AI_SHADOW_MODE_ENABLED === 'true',
            safe_autoreply: process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true',
            wave1_enabled: process.env.AI_WAVE1_ENABLED === 'true',
            wave1_traffic: process.env.AI_WAVE1_TRAFFIC_PERCENT || '5',
            wave2_enabled: process.env.AI_WAVE2_ENABLED === 'true',
            wave2_traffic: process.env.AI_WAVE2_TRAFFIC_PERCENT || '1',
            auto_rollback: process.env.AI_WAVE1_AUTO_ROLLBACK_ENABLED !== 'false'
        };

        // Verdicts
        const verdicts = {
            production_ready_for_shadow: schema.ready && !!ctx,
            production_ready_for_wave1: schema.ready && !!ctx && gate.wave1?.eligible,
            production_ready_for_wave2_candidate: schema.ready && !!ctx && gate.wave2?.eligible
        };

        res.json({
            context_pack: ctx ? { version: ctx.version, sha: ctx.deployed_commit_sha, active: ctx.is_active } : null,
            rollout_state: state.current_state,
            schema: { ready: schema.ready, missing: schema.missing },
            gate,
            flags,
            verdicts,
            kpi_summary: {
                total_decisions: kpis.total_decisions,
                total_with_feedback: kpis.total_with_feedback,
                approval_rate: kpis.approval_rate,
                dangerous_rate: kpis.verdict_breakdown?.dangerous || 0,
                duplicates: kpis.duplicate_outbound
            },
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Audit Endpoints for Controlled Activation Pilot ───

// Summary: eligibility breakdown, reply status, stages, confidence buckets
app.get('/api/ai/audit/summary', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '24', 10);
        const summary = await getAuditSummary(hours);
        res.json(summary);
    } catch (err) {
        console.error('[Audit] Summary error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Recent decisions with key fields
app.get('/api/ai/audit/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '20', 10);
        const recent = await getRecentDecisions(limit);
        res.json(recent);
    } catch (err) {
        console.error('[Audit] Recent error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Full diagnostic for a single conversation
app.get('/api/ai/audit/conversation/:conversation_id', async (req, res) => {
    try {
        const { conversation_id } = req.params;
        const diagnostic = await getConversationDiagnostic(conversation_id);
        res.json(diagnostic);
    } catch (err) {
        console.error('[Audit] Diagnostic error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── Phase 2: Operator Feedback Endpoint ───
app.post('/api/ai/feedback', async (req, res) => {
    try {
        const { reply_decision_id, verdict, edited_reply, reason } = req.body;
        if (!reply_decision_id || !verdict) {
            return res.status(400).json({ error: 'reply_decision_id and verdict are required' });
        }
        const result = await saveOperatorFeedback(reply_decision_id, verdict, edited_reply, reason);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json({ status: 'saved', verdict });
    } catch (err) {
        console.error('[Feedback API] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Feedback KPI stats
app.get('/api/ai/feedback/stats', async (req, res) => {
    try {
        const stats = await getOperatorFeedbackStats(req.query.start, req.query.end);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Shadow mode queue — pending review items
app.get('/api/ai/shadow/queue', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '20', 10);
        const { data, error } = await supabase
            .from('ai_reply_decisions')
            .select('id, conversation_id, suggested_reply, confidence_score, safety_class, safety_class_reasons, tool_action_suggested, memory_context_used, operational_mode, created_at')
            .in('reply_status', ['shadow', 'pending_review'])
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ queue: data, count: data?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Phase 3: Shadow Analytics + Rollout Gate ───
app.get('/api/ai/analytics/shadow', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '24', 10);
        const kpis = await computeShadowAnalytics(hours);
        res.json(kpis);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/rollout/status', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '72', 10);
        const kpis = await computeShadowAnalytics(hours);
        const state = await getCurrentRolloutState();
        const gate = evaluateFullGate(kpis, state.current_state);
        const schema = await checkSchemaReady(supabase);
        res.json({
            rollout_state: state,
            gate_evaluation: gate,
            schema_ready: schema,
            kpi_summary: {
                total: kpis.total_decisions,
                with_feedback: kpis.total_with_feedback,
                approval_rate: kpis.approval_rate,
                avg_confidence: kpis.avg_confidence,
                duplicates: kpis.duplicate_outbound,
                safe_pct: kpis.safety_breakdown.safe_pct
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollout/transition', async (req, res) => {
    try {
        const { target_state, reason, changed_by } = req.body;
        if (!target_state || !reason) {
            return res.status(400).json({ error: 'target_state and reason are required' });
        }
        const result = await transitionRolloutState(target_state, reason, changed_by || 'operator');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/rollout/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '20', 10);
        const history = await getRolloutHistory(limit);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollout/evaluate', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '72', 10);
        const kpis = await computeShadowAnalytics(hours);
        const state = await getCurrentRolloutState();
        const gate = evaluateFullGate(kpis, state.current_state);
        const result = await autoEvaluateRollout(gate);
        res.json({ evaluation: gate, transition: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/review/:decision_id', async (req, res) => {
    try {
        const data = await getOperatorReviewData(req.params.decision_id);
        if (data.error) return res.status(404).json({ error: data.error });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─── Phase 4: Scorecard + Intervention + Rollback ───
app.get('/api/ai/scorecard', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '24', 10);
        const stage = req.query.stage || null;
        const groupBy = req.query.group_by || 'overall';
        const scorecard = await computeScorecard({ hours, stage, groupBy });
        res.json(scorecard);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollout/pause', async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await transitionRolloutState('shadow_only', reason || 'operator_pause', 'operator');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollout/resume', async (req, res) => {
    try {
        const state = await getCurrentRolloutState();
        if (state.current_state === 'rollout_blocked') {
            return res.status(400).json({ error: 'Cannot resume from rollout_blocked. Use /rollout/force to reset to shadow_only first.' });
        }
        const { target, reason } = req.body;
        const result = await transitionRolloutState(target || 'wave1_candidate', reason || 'operator_resume', 'operator');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollout/force', async (req, res) => {
    try {
        const { target_state, reason } = req.body;
        if (!target_state || !reason) {
            return res.status(400).json({ error: 'target_state and reason required' });
        }
        if (target_state === 'wave2_candidate' || target_state === 'wave2_enabled') {
            return res.status(403).json({ error: 'Cannot force Wave 2 states' });
        }
        const result = await transitionRolloutState(target_state, reason, 'admin');
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/rollout/incidents', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('ai_rollout_state')
            .select('*')
            .eq('changed_by', 'system_rollback')
            .order('created_at', { ascending: false })
            .limit(20);
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/rollback/trigger', async (req, res) => {
    try {
        const result = await executeAutoRollback();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/rollback/check', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '4', 10);
        const result = await evaluateRollback(hours);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ─── Phase 5: Wave 2 Endpoints ───
app.get('/api/ai/wave2/status', async (req, res) => {
    try {
        const state = await getCurrentRolloutState();
        const hours = parseInt(req.query.hours || '72', 10);
        const kpis = await computeShadowAnalytics(hours);
        const { evaluateWave2Gate } = await import('./src/rollout/rolloutGate.mjs');
        const gate = evaluateWave2Gate(kpis, state.current_state);
        res.json({
            rollout_state: state.current_state,
            wave2_enabled: process.env.AI_WAVE2_ENABLED === 'true',
            wave2_traffic: process.env.AI_WAVE2_TRAFFIC_PERCENT || '1',
            gate: gate,
            kpi_summary: {
                total: kpis.total_decisions,
                approval_rate: kpis.approval_rate,
                edit_rate: kpis.edit_rate,
                duplicates: kpis.duplicate_outbound
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/wave2/conflicts', async (req, res) => {
    try {
        const { data } = await supabase
            .from('ai_reply_decisions')
            .select('id, conversation_id, safety_class, tool_action_suggested, memory_context_used, created_at')
            .eq('tool_action_suggested', 'update_event_plan')
            .order('created_at', { ascending: false })
            .limit(20);
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Auth Middleware ───
import { simpleTokenAuth } from './src/middleware/adminAuth.mjs';
const authMiddleware = simpleTokenAuth();

// ─── Brain Console ───
import brainConsoleRoutes from './src/api/brainConsoleRoutes.mjs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/api/ai/brain', authMiddleware, brainConsoleRoutes);
app.use('/brain', express.static(path.join(__dirname, 'public')));

// ─── Admin Suite ───
import adminSuiteRoutes from './src/api/adminSuiteRoutes.mjs';
app.use('/api/admin', authMiddleware, adminSuiteRoutes);
app.use('/admin', express.static(path.join(__dirname, 'public')));

// ─── Operator Desk (primary link + API) ───
import operatorDeskRoutes from './src/api/operatorDeskRoutes.mjs';
app.use('/api/operator', authMiddleware, operatorDeskRoutes);
app.get('/operator', (req, res) => res.redirect('/admin/operator-desk.html'));

// ─── Corrections Pipeline ───
import correctionsRoutes from './src/api/correctionsRoutes.mjs';
app.use('/api/admin/corrections', authMiddleware, correctionsRoutes);

// ─── Rule Loader ───
import { startAutoReload, getCurrentPolicy } from './src/lib/ruleLoader.mjs';
startAutoReload(60000); // reload rules from DB every 60s

// ─── Health Endpoint ───
app.get('/health', async (req, res) => {
    try {
        const policy = getCurrentPolicy();
        const checks = {
            status: 'ok',
            uptime: process.uptime(),
            memory_mb: Math.round(process.memoryUsage().rss / 1048576),
            policy_version: policy?.version || 'not_loaded',
            policy_rules: policy?.rules?.length || 0,
            shadow_mode: process.env.AI_SHADOW_MODE_ENABLED === 'true',
            timestamp: new Date().toISOString()
        };
        res.json(checks);
    } catch (err) {
        res.status(503).json({ status: 'degraded', error: err.message });
    }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
    const mode = process.env.AI_SHADOW_MODE_ENABLED === 'true' ? 'SHADOW'
        : process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true' ? 'SAFE_AUTOREPLY'
        : process.env.AI_FULL_AUTOREPLY_ENABLED === 'true' ? 'FULL_AUTOREPLY'
        : 'LEGACY';
    console.log(`🚀 ManagerAi API is running on port ${PORT}`);
    console.log(`   Operational Mode: ${mode}`);
    console.log(`   Wave1: ${process.env.AI_WAVE1_ENABLED === 'true' ? '🟢 ON' : '❌ OFF'} (${process.env.AI_WAVE1_TRAFFIC_PERCENT || 5}% traffic)`);
    console.log(`   Wave2: ${process.env.AI_WAVE2_ENABLED === 'true' ? '🟡 ON' : '❌ OFF'} (${process.env.AI_WAVE2_TRAFFIC_PERCENT || 1}% traffic)`);
    console.log(`   Auto-Rollback: ${process.env.AI_WAVE1_AUTO_ROLLBACK_ENABLED !== 'false' ? '✅ ON' : '❌ OFF'}`);
});
