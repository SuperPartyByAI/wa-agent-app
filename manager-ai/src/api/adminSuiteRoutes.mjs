/**
 * Admin Suite API Routes
 *
 * Modular routes for the internal admin dashboard:
 * A. CRM / Clients
 * B. Memory Inspector
 * C. AI Brain → delegated to brainConsoleRoutes
 * D. Pricing & Commercial Rules
 * E. Employees / Roles
 * F. Rollout / Safety → uses existing endpoints
 * G. Audit / Incidents
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Audit helper ──
async function logAudit(module, action, entityType, entityId, changes = {}, reason = '', changedBy = 'operator') {
    await supabase.from('admin_audit_log').insert({ module, action, entity_type: entityType, entity_id: entityId, changes, reason, changed_by: changedBy }).catch(() => {});
}

// ═══════════════════════════════════════════════════
// A. CRM / CLIENTS
// ═══════════════════════════════════════════════════

router.get('/crm/clients', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const offset = parseInt(req.query.offset || '0', 10);
        const search = req.query.search;
        const source = req.query.source;

        let query = supabase.from('clients')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (search) query = query.or(`full_name.ilike.%${search}%,real_phone_e164.ilike.%${search}%,email.ilike.%${search}%`);
        if (source) query = query.eq('source', source);

        const { data, error, count } = await query;
        if (error) throw error;
        res.json({ clients: data, total: count, limit, offset });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/crm/clients/:id', async (req, res) => {
    try {
        const id = req.params.id;

        const [clientR, memoryR, convsR, plansR, quotesR] = await Promise.all([
            supabase.from('clients').select('*').eq('id', id).single(),
            supabase.from('ai_client_memory').select('*').eq('client_id', id).maybeSingle(),
            supabase.from('conversations').select('id, session_id, status, created_at, updated_at').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
            supabase.from('ai_event_plans').select('id, status, event_type, occasion, event_date, location, requested_services, confirmed_services, confidence, readiness_for_quote, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
            supabase.from('ai_quotes').select('id, status, grand_total, line_items, valid_until, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10)
        ]);

        if (clientR.error) throw clientR.error;

        // Latest messages across conversations
        const convIds = convsR.data?.map(c => c.id) || [];
        let latestMessages = [];
        if (convIds.length > 0) {
            const { data: msgs } = await supabase.from('messages')
                .select('id, conversation_id, content, sender_type, created_at')
                .in('conversation_id', convIds.slice(0, 5))
                .order('created_at', { ascending: false })
                .limit(30);
            latestMessages = msgs || [];
        }

        // Decision history
        const { data: decisions } = await supabase.from('ai_reply_decisions')
            .select('suggested_reply, operator_edited_reply, tool_action_suggested, safety_class, reply_status, operator_verdict, confidence_score, created_at, id, conversation_id')
            .in('conversation_id', convIds.slice(0, 5))
            .order('created_at', { ascending: false })
            .limit(20);

        // Map decisions to messages
        const decisionsMap = new Map();
        (decisions || []).forEach(d => {
            if (!decisionsMap.has(d.conversation_id)) {
                decisionsMap.set(d.conversation_id, []);
            }
            decisionsMap.get(d.conversation_id).push(d);
        });

        const messagesWithDecisions = latestMessages.map(m => {
            const conversationDecisions = decisionsMap.get(m.conversation_id) || [];
            // Find the decision that is closest in time and created AFTER the message
            const decision = conversationDecisions
                .filter(d => new Date(d.created_at) >= new Date(m.created_at))
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

            return {
                ...m,
                ai_reply: decision?.operator_edited_reply || decision?.suggested_reply || null,
                tool_action: decision?.tool_action_suggested || null,
                safety_class: decision?.safety_class || null,
                reply_status: decision?.reply_status || null,
                operator_verdict: decision?.operator_verdict || null,
                confidence: decision?.confidence_score || null,
                ai_decision_id: decision?.id || null
            };
        });

        res.json({
            client: clientR.data,
            memory: memoryR.data,
            conversations: convsR.data || [],
            event_plans: plansR.data || [],
            quotes: quotesR.data || [],
            latest_messages: messagesWithDecisions,
            ai_decisions: decisions || []
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/crm/clients/:id', async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        const { data: before } = await supabase.from('clients').select('*').eq('id', req.params.id).single();
        const { data, error } = await supabase.from('clients').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        await logAudit('crm', 'update', 'client', req.params.id, { before: updates, after: data }, req.body._reason || '');
        res.json({ status: 'updated', client: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// B. MEMORY INSPECTOR
// ═══════════════════════════════════════════════════

router.get('/memory/:client_id', async (req, res) => {
    try {
        const cid = req.params.client_id;

        const [memR, plansR, goalsR, goalHistR, evtHistR] = await Promise.all([
            supabase.from('ai_client_memory').select('*').eq('client_id', cid).maybeSingle(),
            supabase.from('ai_event_plans').select('*').eq('client_id', cid).order('created_at', { ascending: false }).limit(5),
            supabase.from('ai_goal_states').select('*').eq('client_id', cid).order('created_at', { ascending: false }).limit(5),
            supabase.from('ai_goal_state_history').select('*').eq('client_id', cid).order('created_at', { ascending: false }).limit(20),
            supabase.from('ai_event_plan_history').select('*').eq('client_id', cid).order('created_at', { ascending: false }).limit(20)
        ]);

        // Quotes for this client
        const { data: quotes } = await supabase.from('ai_quotes')
            .select('id, status, grand_total, line_items, assumptions, missing_info_notes, created_at')
            .eq('client_id', cid).order('created_at', { ascending: false }).limit(5);

        // Mutations
        const planIds = plansR.data?.map(p => p.id) || [];
        let mutations = [];
        if (planIds.length > 0) {
            const { data: muts } = await supabase.from('ai_event_mutations')
                .select('*')
                .in('event_plan_id', planIds.slice(0, 3))
                .order('created_at', { ascending: false })
                .limit(20);
            mutations = muts || [];
        }

        // Audit trail for memory edits
        const { data: auditTrail } = await supabase.from('admin_audit_log')
            .select('*')
            .eq('entity_type', 'memory')
            .eq('entity_id', cid)
            .order('created_at', { ascending: false })
            .limit(20);

        res.json({
            memory: memR.data,
            event_plans: plansR.data || [],
            goal_states: goalsR.data || [],
            goal_history: goalHistR.data || [],
            event_plan_history: evtHistR.data || [],
            quotes: quotes || [],
            mutations,
            audit_trail: auditTrail || []
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/memory/:client_id', async (req, res) => {
    try {
        const cid = req.params.client_id;
        const { field, value, reason, changed_by } = req.body;

        if (!field || value === undefined) return res.status(400).json({ error: 'field and value required' });

        // Get current value
        const { data: current } = await supabase.from('ai_client_memory').select('*').eq('client_id', cid).maybeSingle();
        const before = current?.[field];

        // Update
        const { data, error } = await supabase.from('ai_client_memory')
            .update({ [field]: value, updated_at: new Date().toISOString() })
            .eq('client_id', cid)
            .select()
            .single();
        if (error) throw error;

        await logAudit('memory', 'correction', 'memory', cid, { field, before, after: value }, reason || '', changed_by || 'operator');
        res.json({ status: 'updated', memory: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/memory/:client_id/note', async (req, res) => {
    try {
        const cid = req.params.client_id;
        const { note, changed_by } = req.body;
        await logAudit('memory', 'note', 'memory', cid, { note }, note, changed_by || 'operator');
        res.json({ status: 'saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// D. PRICING & COMMERCIAL RULES
// ═══════════════════════════════════════════════════

router.get('/pricing/catalog', async (req, res) => {
    try {
        const catalogPath = path.resolve(__dirname, '../../service-catalog.json');
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

        // Get KB pricing entries
        const { data: kbPricing } = await supabase.from('ai_knowledge_base')
            .select('*')
            .or('category.eq.pricing,category.eq.services,knowledge_key.ilike.%pret%,knowledge_key.ilike.%pachet%,knowledge_key.ilike.%tarif%');

        res.json({
            catalog: catalog.services || [],
            version: catalog.version,
            last_updated: catalog.last_updated,
            kb_pricing_entries: kbPricing || [],
            total_services: catalog.services?.length || 0
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pricing/catalog/:service_key', async (req, res) => {
    try {
        const catalogPath = path.resolve(__dirname, '../../service-catalog.json');
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        const idx = catalog.services.findIndex(s => s.service_key === req.params.service_key);
        if (idx === -1) return res.status(404).json({ error: 'Service not found' });

        const before = { ...catalog.services[idx] };
        Object.assign(catalog.services[idx], req.body);
        catalog.last_updated = new Date().toISOString().split('T')[0];
        fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

        await logAudit('pricing', 'update', 'service', req.params.service_key, { before, after: catalog.services[idx] }, req.body._reason || '');
        res.json({ status: 'updated', service: catalog.services[idx] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pricing/kb', async (req, res) => {
    try {
        const { data } = await supabase.from('ai_knowledge_base').select('*').order('created_at', { ascending: false });
        res.json({ entries: data || [], total: data?.length || 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/pricing/kb/:id', async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        const { data, error } = await supabase.from('ai_knowledge_base').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        await logAudit('pricing', 'update', 'kb_entry', req.params.id, updates, req.body._reason || '');
        res.json({ status: 'updated', entry: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// E. EMPLOYEES / ROLES
// ═══════════════════════════════════════════════════

router.get('/employees', async (req, res) => {
    try {
        const { data, error, count } = await supabase.from('employees')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ employees: data || [], total: count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/employees', async (req, res) => {
    try {
        const { data, error } = await supabase.from('employees').insert(req.body).select().single();
        if (error) throw error;
        await logAudit('employees', 'create', 'employee', data.id, data);
        res.json({ status: 'created', employee: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/employees/:id', async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        const { data, error } = await supabase.from('employees').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        await logAudit('employees', 'update', 'employee', req.params.id, updates, req.body._reason || '');
        res.json({ status: 'updated', employee: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// F. ROLLOUT / SAFETY (aggregation of existing endpoints)
// ═══════════════════════════════════════════════════

router.get('/rollout/overview', async (req, res) => {
    try {
        const [stateR, decR, analyticsR] = await Promise.all([
            supabase.from('ai_rollout_state').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('ai_reply_decisions').select('safety_class, operator_verdict, reply_status, confidence_score, operational_mode', { count: 'exact' }).gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString()),
            supabase.from('ai_analytics_events').select('event_type', { count: 'exact' }).gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
        ]);

        const decisions = decR.data || [];
        const safeCount = decisions.filter(d => d.safety_class === 'safe_autoreply_allowed').length;
        const reviewCount = decisions.filter(d => d.safety_class === 'needs_operator_review').length;
        const blockedCount = decisions.filter(d => d.safety_class === 'blocked_autoreply').length;

        res.json({
            rollout_state: stateR.data,
            decisions_24h: {
                total: decisions.length,
                safe: safeCount, review: reviewCount, blocked: blockedCount,
                with_verdict: decisions.filter(d => d.operator_verdict).length,
                avg_confidence: decisions.length > 0 ? Math.round(decisions.reduce((s, d) => s + (d.confidence_score || 0), 0) / decisions.length) : 0
            },
            analytics_events_24h: analyticsR.count || 0,
            feature_flags: {
                shadow_mode: process.env.AI_SHADOW_MODE_ENABLED === 'true',
                safe_autoreply: process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true',
                wave1: process.env.AI_WAVE1_ENABLED === 'true',
                wave2: process.env.AI_WAVE2_ENABLED === 'true',
                auto_rollback: process.env.AI_WAVE1_AUTO_ROLLBACK_ENABLED !== 'false'
            }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rollout/incidents', async (req, res) => {
    try {
        const { data } = await supabase.from('ai_rollout_state')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
        res.json({ incidents: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rollout/kb-misses', async (req, res) => {
    try {
        const { data, count } = await supabase.from('ai_kb_misses')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .limit(50);
        res.json({ misses: data || [], total: count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// G. AUDIT / INCIDENTS
// ═══════════════════════════════════════════════════

router.get('/audit', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const module = req.query.module;
        const entity_type = req.query.entity_type;

        let query = supabase.from('admin_audit_log')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .limit(limit);

        if (module) query = query.eq('module', module);
        if (entity_type) query = query.eq('entity_type', entity_type);

        const { data, error, count } = await query;
        if (error) throw error;
        res.json({ logs: data || [], total: count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/audit/stats', async (req, res) => {
    try {
        const { data } = await supabase.from('admin_audit_log')
            .select('module, action, entity_type')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 3600000).toISOString());

        const byModule = {};
        (data || []).forEach(d => { byModule[d.module] = (byModule[d.module] || 0) + 1; });

        res.json({ total_7d: data?.length || 0, by_module: byModule });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════
// H. DASHBOARD STATS (overview for all modules)
// ═══════════════════════════════════════════════════

router.get('/dashboard', async (req, res) => {
    try {
        const [clientsR, convsR, memR, plansR, quotesR, rulesR, coverR, decisionsR, analyticsR, misses, empR] = await Promise.all([
            supabase.from('clients').select('*', { count: 'exact', head: true }),
            supabase.from('conversations').select('*', { count: 'exact', head: true }),
            supabase.from('ai_client_memory').select('*', { count: 'exact', head: true }),
            supabase.from('ai_event_plans').select('*', { count: 'exact', head: true }),
            supabase.from('ai_quotes').select('*', { count: 'exact', head: true }),
            supabase.from('ai_brain_rules').select('*', { count: 'exact', head: true }).eq('status', 'active'),
            supabase.from('ai_coverage_config').select('*', { count: 'exact', head: true }),
            supabase.from('ai_reply_decisions').select('*', { count: 'exact', head: true }),
            supabase.from('ai_analytics_events').select('*', { count: 'exact', head: true }),
            supabase.from('ai_kb_misses').select('*', { count: 'exact', head: true }),
            supabase.from('employees').select('*', { count: 'exact', head: true })
        ]);

        res.json({
            crm: { clients: clientsR.count, conversations: convsR.count },
            memory: { entries: memR.count },
            brain: { active_rules: rulesR.count, coverage_zones: coverR.count, decisions: decisionsR.count },
            pricing: { event_plans: plansR.count, quotes: quotesR.count },
            employees: { total: empR.count },
            analytics: { events: analyticsR.count, kb_misses: misses.count }
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
