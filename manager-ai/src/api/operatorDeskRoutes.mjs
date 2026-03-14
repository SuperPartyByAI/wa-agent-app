/**
 * Operator Desk API Routes
 *
 * Consolidated API for the simplified Operator Desk:
 * - Inbox with AI decisions + client messages
 * - Service requirements per category
 * - Event plan create/update via SRE
 * - Field analysis and readiness
 *
 * Reuses: brainConsoleRoutes (inbox), adminSuiteRoutes (CRM/memory),
 *         correctionsRoutes (corrections), serviceRequirementsEngine
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import SRE from '../lib/serviceRequirementsEngine.mjs';

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Audit helper ───
async function logAudit(action, entityType, entityId, details, userId = 'operator') {
  try {
    await supabase.from('admin_audit_log').insert({
      module: 'operator_desk', action, entity_type: entityType,
      entity_id: entityId, details, user_id: userId, reason: action
    });
  } catch (e) { console.error('[OpDesk] audit error:', e.message); }
}

// ═══════════════════════════════════════════
// 1. INBOX — Enriched conversations for operator
// ═══════════════════════════════════════════

router.get('/inbox', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const filter = req.query.filter;

    // Get recent conversations with client info
    let query = supabase
      .from('conversations')
      .select(`
        id, client_id, channel, status, updated_at,
        clients!inner(id, display_name, alias, mapped_alias, source)
      `, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filter === 'open') query = query.eq('status', 'open');

    const { data: convs, count, error } = await query;
    if (error) {
      // Fallback: fetch without join if FK fails
      const { data: convsFb, count: countFb } = await supabase
        .from('conversations')
        .select('*', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Enrich manually
      const clientIds = [...new Set((convsFb||[]).map(c => c.client_id).filter(Boolean))];
      const { data: clientsList } = clientIds.length > 0
        ? await supabase.from('clients').select('id, display_name, alias, mapped_alias, source').in('id', clientIds.slice(0, 50))
        : { data: [] };
      const clientMap = Object.fromEntries((clientsList||[]).map(c => [c.id, c]));

      const enriched = await enrichConversations(convsFb || [], clientMap);
      return res.json({ inbox: enriched, total: countFb || 0, limit, offset });
    }

    // Build client map and enrich
    const clientMap = {};
    for (const c of convs || []) {
      if (c.clients) clientMap[c.client_id] = c.clients;
    }
    const enriched = await enrichConversations(convs || [], clientMap);
    res.json({ inbox: enriched, total: count || 0, limit, offset });
  } catch (err) {
    console.error('[OpDesk] inbox error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function enrichConversations(convs, clientMap) {
  if (!convs.length) return [];

  const convIds = convs.map(c => c.id);

  // Get latest message per conversation (batch)
  const { data: msgs } = await supabase
    .from('messages')
    .select('conversation_id, content, sender_type, created_at, direction')
    .in('conversation_id', convIds.slice(0, 50))
    .order('created_at', { ascending: false })
    .limit(200);

  // Group: latest client msg + latest agent msg per conv
  const msgMap = {};
  for (const m of msgs || []) {
    if (!msgMap[m.conversation_id]) msgMap[m.conversation_id] = {};
    const bucket = m.sender_type === 'client' || m.direction === 'inbound' ? 'client' : 'agent';
    if (!msgMap[m.conversation_id][bucket]) msgMap[m.conversation_id][bucket] = m;
  }

  // Get AI decisions for these conversations
  const { data: decisions } = await supabase
    .from('ai_reply_decisions')
    .select('conversation_id, ai_reply, tool_action, safety_class, reply_status, operator_verdict, confidence, created_at')
    .in('conversation_id', convIds.slice(0, 50))
    .order('created_at', { ascending: false })
    .limit(100);

  const decisionMap = {};
  for (const d of decisions || []) {
    if (!decisionMap[d.conversation_id]) decisionMap[d.conversation_id] = d;
  }

  // Get event plans for these conversations
  const { data: plans } = await supabase
    .from('ai_event_plans')
    .select('id, conversation_id, status, event_type, event_date, event_time, location, missing_fields, readiness_for_quote, requested_services')
    .in('conversation_id', convIds.slice(0, 50))
    .order('created_at', { ascending: false })
    .limit(100);

  const planMap = {};
  for (const p of plans || []) {
    if (!planMap[p.conversation_id]) planMap[p.conversation_id] = p;
  }

  return convs.map(c => {
    const client = clientMap[c.client_id] || {};
    const clientMsg = msgMap[c.id]?.client;
    const agentMsg = msgMap[c.id]?.agent;
    const decision = decisionMap[c.id];
    const plan = planMap[c.id];

    return {
      id: c.id,
      client_id: c.client_id,
      client_name: client.display_name || client.alias || client.mapped_alias || `Client ${(c.client_id||'').substring(0, 6)}`,
      channel: c.channel || client.source || 'whatsapp',
      status: decision?.reply_status || c.status || 'open',
      updated_at: c.updated_at,
      // Messages
      client_message: clientMsg?.content || null,
      client_message_at: clientMsg?.created_at || null,
      agent_reply: agentMsg?.content || null,
      // AI Decision
      ai_reply: decision?.ai_reply || null,
      tool_action: decision?.tool_action || null,
      safety_class: decision?.safety_class || null,
      confidence: decision?.confidence || null,
      operator_verdict: decision?.operator_verdict || null,
      // Event Plan
      has_event_plan: !!plan,
      event_plan_status: plan?.status || null,
      event_type: plan?.event_type || null,
      event_date: plan?.event_date || null,
      missing_fields: plan?.missing_fields || [],
      readiness_for_quote: plan?.readiness_for_quote || false
    };
  });
}

// ═══════════════════════════════════════════
// 2. SERVICE REQUIREMENTS
// ═══════════════════════════════════════════

router.get('/services', (req, res) => {
  const services = SRE.getAllServices();
  res.json({
    services: services.map(s => ({
      service_key: s.service_key,
      display_name: s.display_name,
      description: s.description,
      required_fields: s.required_fields,
      optional_fields: s.optional_fields,
      standard_questions: s.standard_questions,
      human_review_triggers: s.human_review_triggers,
      autonomy_allowed: s.autonomy_allowed,
      tags: s.tags
    })),
    total: services.length
  });
});

router.get('/services/:key/analyze', async (req, res) => {
  try {
    const { key } = req.params;
    const planId = req.query.plan_id;

    let eventData = {};
    if (planId) {
      const { data } = await supabase.from('ai_event_plans').select('*').eq('id', planId).single();
      eventData = data || {};
    }

    const analysis = SRE.analyzeFields(key, eventData);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 3. EVENT ACTIONS — Create, Update, Analyze
// ═══════════════════════════════════════════

router.post('/events/create', async (req, res) => {
  try {
    const { client_id, conversation_id, service_key, fields } = req.body;
    if (!client_id || !conversation_id || !service_key) {
      return res.status(400).json({ error: 'Required: client_id, conversation_id, service_key' });
    }

    const result = await SRE.createEventPlan(client_id, conversation_id, service_key, fields || {});
    await logAudit('create_event', 'event_plan', result.plan.id, { service_key, fields, readiness: result.analysis.readiness });

    res.status(201).json({
      ok: true,
      action: 'created',
      plan_id: result.plan.id,
      readiness: result.analysis.readiness,
      missing_required: result.analysis.missing_required,
      next_question: result.analysis.next_question
    });
  } catch (err) {
    console.error('[OpDesk] create event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/events/:id/update', async (req, res) => {
  try {
    const { fields, reason } = req.body;
    if (!fields || Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result = await SRE.updateEventPlanFields(req.params.id, fields, reason || 'operator_update');

    if (!result.updated) {
      return res.status(403).json({
        ok: false,
        blocked: true,
        reason: result.reason,
        safety: result.safety
      });
    }

    await logAudit('update_event', 'event_plan', req.params.id, { fields, before: result.before, after: result.after });

    res.json({
      ok: true,
      action: 'updated',
      plan_id: req.params.id,
      before: result.before,
      after: result.after,
      safety: result.safety
    });
  } catch (err) {
    console.error('[OpDesk] update event error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Detect intent from a message
router.post('/events/detect-intent', async (req, res) => {
  try {
    const { message, client_id } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    // Get existing plans for this client
    let plans = [];
    if (client_id) {
      const { data } = await supabase.from('ai_event_plans')
        .select('id, event_type, event_date, status, requested_services')
        .eq('client_id', client_id)
        .in('status', ['draft', 'active', 'confirmed'])
        .order('created_at', { ascending: false })
        .limit(5);
      plans = data || [];
    }

    const intent = SRE.detectIntent(message, plans);
    const extracted = SRE.extractFieldsFromMessage(message);

    res.json({ intent, extracted_fields: extracted, existing_plans: plans.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 4. EVENT PLAN DETAIL
// ═══════════════════════════════════════════

router.get('/events/:id', async (req, res) => {
  try {
    const { data: plan, error } = await supabase.from('ai_event_plans')
      .select('*').eq('id', req.params.id).single();
    if (error || !plan) return res.status(404).json({ error: 'Not found' });

    const serviceKey = (plan.requested_services || [])[0];
    const analysis = serviceKey ? SRE.analyzeFields(serviceKey, plan) : null;

    // Get mutations
    const { data: mutations } = await supabase.from('ai_event_mutations')
      .select('*').eq('event_draft_id', req.params.id)
      .order('created_at', { ascending: false }).limit(20);

    res.json({ plan, analysis, mutations: mutations || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
