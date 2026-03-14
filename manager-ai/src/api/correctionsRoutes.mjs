/**
 * Corrections API Routes — Capture & Approve Human Corrections
 *
 * POST   /                  Create a correction entry
 * GET    /                  List corrections (paginated, filterable)
 * GET    /:id               Get single correction
 * PUT    /:id/approve       Approve a correction (admin/manager only)
 * GET    /stats             Correction statistics
 *
 * Ticket: stabilizare/antigravity - Corrections Pipeline
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── PII Redaction ───
const PII_PATTERNS = [
    { regex: /\+?\d{10,15}/g, replacement: '[PHONE]' },
    { regex: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[EMAIL]' },
    { regex: /\b\d{6,8}\b/g, replacement: '[ID]' }
];

function redactPII(obj) {
    if (!obj) return obj;
    const str = JSON.stringify(obj);
    let redacted = str;
    for (const { regex, replacement } of PII_PATTERNS) {
        redacted = redacted.replace(regex, replacement);
    }
    try { return JSON.parse(redacted); } catch { return { redacted: true }; }
}

// ─── Audit helper ───
async function logAudit(module, action, entity, details, userId) {
    try {
        await supabase.from('admin_audit_log').insert({
            module, action, entity_type: 'correction', entity_id: entity,
            details, user_id: userId || 'system', reason: action
        });
    } catch (e) { console.error('[corrections] audit error:', e.message); }
}

// ─── POST / — Create correction ───
router.post('/', async (req, res) => {
    try {
        const {
            trace_id, request, original_decision, corrected_decision,
            tags, policy_version, model_version, annotator_id
        } = req.body;

        if (!trace_id || !request || !corrected_decision) {
            return res.status(400).json({ error: 'Missing required fields: trace_id, request, corrected_decision' });
        }

        const request_redacted = redactPII(request);
        const original = original_decision || {};

        const { data, error } = await supabase.from('corrections').insert({
            trace_id,
            request,
            request_redacted,
            original_decision: original,
            corrected_decision,
            annotator_id: annotator_id || req.user?.id || 'anonymous',
            tags: tags || [],
            policy_version: policy_version || 'unknown',
            model_version: model_version || null
        }).select().single();

        if (error) throw error;

        await logAudit('corrections', 'create', data.id,
            { trace_id, tags, has_original: !!original_decision },
            req.user?.id);

        res.status(201).json({ ok: true, id: data.id, trace_id });
    } catch (err) {
        console.error('[corrections] create error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET / — List corrections ───
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const approved = req.query.approved; // 'true', 'false', or omit for all

        let query = supabase
            .from('corrections')
            .select('id, trace_id, request_redacted, corrected_decision, approved, tags, policy_version, model_version, annotator_id, created_at', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (approved === 'true') query = query.eq('approved', true);
        if (approved === 'false') query = query.eq('approved', false);

        const { data, count, error } = await query;
        if (error) throw error;

        res.json({ corrections: data || [], total: count || 0, limit, offset });
    } catch (err) {
        console.error('[corrections] list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /stats — Correction statistics ───
router.get('/stats', async (req, res) => {
    try {
        const { count: total } = await supabase.from('corrections').select('*', { count: 'exact', head: true });
        const { count: approved } = await supabase.from('corrections').select('*', { count: 'exact', head: true }).eq('approved', true);
        const { count: pending } = await supabase.from('corrections').select('*', { count: 'exact', head: true }).eq('approved', false);

        const since24h = new Date(Date.now() - 86400000).toISOString();
        const { count: last24h } = await supabase.from('corrections').select('*', { count: 'exact', head: true }).gte('created_at', since24h);

        res.json({
            total: total || 0,
            approved: approved || 0,
            pending: pending || 0,
            last_24h: last24h || 0,
            approval_rate: total > 0 ? Math.round((approved / total) * 100) : 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GET /:id — Get single correction ───
router.get('/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('corrections')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !data) return res.status(404).json({ error: 'Not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── PUT /:id/approve — Approve a correction ───
router.put('/:id/approve', async (req, res) => {
    try {
        const approver = req.user?.id || 'admin';
        const { data, error } = await supabase.from('corrections')
            .update({
                approved: true,
                approved_by: approver,
                approved_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Not found' });

        await logAudit('corrections', 'approve', data.id,
            { trace_id: data.trace_id, approved_by: approver },
            approver);

        res.json({ ok: true, id: data.id, approved: true });
    } catch (err) {
        console.error('[corrections] approve error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;
