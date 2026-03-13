import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';

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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    const mode = process.env.AI_SHADOW_MODE_ENABLED === 'true' ? 'SHADOW'
        : process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true' ? 'SAFE_AUTOREPLY'
        : process.env.AI_FULL_AUTOREPLY_ENABLED === 'true' ? 'FULL_AUTOREPLY'
        : 'LEGACY';
    console.log(`🚀 ManagerAi API is running on port ${PORT}`);
    console.log(`   Operational Mode: ${mode}`);
    console.log(`   AI_AUTOREPLY_ENABLED: ${process.env.AI_AUTOREPLY_ENABLED === 'true' ? '✅ ON' : '❌ OFF (safe mode)'}`);
    console.log(`   AI_SHADOW_MODE: ${process.env.AI_SHADOW_MODE_ENABLED === 'true' ? '👁️ ON' : '❌ OFF'}`);
    console.log(`   AI_SAFE_AUTOREPLY: ${process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true' ? '🟢 ON' : '❌ OFF'}`);
});
