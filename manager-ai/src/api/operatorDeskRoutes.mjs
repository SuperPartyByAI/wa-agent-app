/**
 * Operator Desk API Routes v3
 *
 * Real production wiring:
 * - Enriched inbox (conversations + AI decisions + event plans)
 * - REAL operator actions (approve, edit, clarify, handoff)
 * - Field Registry CRUD
 * - Event create/update via dynamic field binding
 * - Service requirements from registry
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import FR from '../lib/fieldRegistry.mjs';
import SRE from '../lib/serviceRequirementsEngine.mjs';

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Audit ───
async function audit(action, entityType, entityId, details, userId = 'operator') {
  try {
    await supabase.from('admin_audit_log').insert({
      module: 'operator_desk', action, entity_type: entityType,
      entity_id: entityId, details, user_id: userId, reason: action
    });
  } catch (e) { console.error('[OpDesk] audit err:', e.message); }
}

// ═══════════════════════════════════════════
// 1. INBOX — Enriched
// ═══════════════════════════════════════════

router.get('/inbox', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const filter = req.query.filter;

    const { data: convs, count } = await supabase
      .from('conversations')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Enrich
    const clientIds = [...new Set((convs||[]).map(c => c.client_id).filter(Boolean))];
    const { data: clients } = clientIds.length > 0
      ? await supabase.from('clients').select('id, display_name, alias, mapped_alias, source').in('id', clientIds.slice(0, 80))
      : { data: [] };
    const clientMap = Object.fromEntries((clients||[]).map(c => [c.id, c]));

    const convIds = (convs||[]).map(c => c.id);

    // Latest messages
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, content, sender_type, created_at, direction')
      .in('conversation_id', convIds.slice(0, 80))
      .order('created_at', { ascending: false })
      .limit(300);

    const msgMap = {};
    for (const m of msgs || []) {
      if (!msgMap[m.conversation_id]) msgMap[m.conversation_id] = {};
      const bucket = m.sender_type === 'client' || m.direction === 'inbound' ? 'client' : 'agent';
      if (!msgMap[m.conversation_id][bucket]) msgMap[m.conversation_id][bucket] = m;
    }

    // AI decisions
    const { data: decisions } = await supabase
      .from('ai_reply_decisions')
      .select('conversation_id, ai_reply, tool_action, safety_class, reply_status, operator_verdict, confidence, created_at, id')
      .in('conversation_id', convIds.slice(0, 80))
      .order('created_at', { ascending: false })
      .limit(200);

    const decMap = {};
    for (const d of decisions || []) {
      if (!decMap[d.conversation_id]) decMap[d.conversation_id] = d;
    }

    // Event plans  
    const { data: plans } = await supabase
      .from('ai_event_plans')
      .select('id, conversation_id, status, event_type, event_date, event_time, location, missing_fields, readiness_for_quote, requested_services')
      .in('conversation_id', convIds.slice(0, 80))
      .order('created_at', { ascending: false })
      .limit(200);

    const planMap = {};
    for (const p of plans || []) {
      if (!planMap[p.conversation_id]) planMap[p.conversation_id] = p;
    }

    const inbox = (convs || []).map(c => {
      const cl = clientMap[c.client_id] || {};
      const cm = msgMap[c.id]?.client;
      const am = msgMap[c.id]?.agent;
      const dec = decMap[c.id];
      const plan = planMap[c.id];
      return {
        id: c.id, client_id: c.client_id,
        client_name: cl.display_name || cl.alias || cl.mapped_alias || `Client ${(c.client_id||'').substring(0,6)}`,
        channel: c.channel || cl.source || 'whatsapp',
        status: dec?.reply_status || c.status || 'open',
        updated_at: c.updated_at,
        client_message: cm?.content || null,
        client_message_at: cm?.created_at || null,
        agent_reply: am?.content || null,
        ai_reply: dec?.ai_reply || null,
        ai_decision_id: dec?.id || null,
        tool_action: dec?.tool_action || null,
        safety_class: dec?.safety_class || null,
        confidence: dec?.confidence || null,
        operator_verdict: dec?.operator_verdict || null,
        has_event_plan: !!plan,
        event_plan_id: plan?.id || null,
        event_plan_status: plan?.status || null,
        event_type: plan?.event_type || null,
        event_date: plan?.event_date || null,
        missing_fields: plan?.missing_fields || [],
        readiness_for_quote: plan?.readiness_for_quote || false
      };
    });

    // Apply filter
    let filtered = inbox;
    if (filter === 'pending') filtered = inbox.filter(i => i.status === 'pending' || i.status === 'shadow' || i.operator_verdict === null);
    if (filter === 'shadow') filtered = inbox.filter(i => i.status === 'shadow');
    if (filter === 'open') filtered = inbox.filter(i => i.status === 'open');

    res.json({ inbox: filtered, total: count || 0, limit, offset });
  } catch (err) {
    console.error('[OpDesk] inbox error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 2. REAL OPERATOR ACTIONS
// ═══════════════════════════════════════════

// APPROVE — mark AI reply as approved, save verdict
router.post('/action/approve', async (req, res) => {
  try {
    const { conversation_id, decision_id, reply_text } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id necesar' });

    // Update AI decision
    if (decision_id) {
      await supabase.from('ai_reply_decisions')
        .update({ operator_verdict: 'approved', operator_edited_reply: null, reply_status: 'approved' })
        .eq('id', decision_id);
    }

    // Save correction entry for audit
    await supabase.from('ai_learned_corrections').insert({
      conversation_id, correction_type: 'approved',
      corrected_reply: reply_text || null,
      verdict: 'approved', reason: 'Operator a aprobat răspunsul AI',
      changed_by: 'operator'
    });

    await audit('approve_reply', 'conversation', conversation_id, { decision_id, verdict: 'approved' });
    res.json({ ok: true, action: 'approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EDIT — save correction, update reply
router.post('/action/edit', async (req, res) => {
  try {
    const { conversation_id, decision_id, original_reply, edited_reply } = req.body;
    if (!conversation_id || !edited_reply) return res.status(400).json({ error: 'conversation_id și edited_reply necesare' });

    // Update AI decision with edited reply
    if (decision_id) {
      await supabase.from('ai_reply_decisions')
        .update({ operator_verdict: 'edited', operator_edited_reply: edited_reply, reply_status: 'edited' })
        .eq('id', decision_id);
    }

    // Save correction for learning
    await supabase.from('ai_learned_corrections').insert({
      conversation_id, correction_type: 'reply_edited',
      original_ai_reply: original_reply || null,
      corrected_reply: edited_reply,
      verdict: 'edited', reason: 'Operator a editat răspunsul',
      changed_by: 'operator'
    });

    await audit('edit_reply', 'conversation', conversation_id, { decision_id, original: original_reply?.substring(0, 100), edited: edited_reply.substring(0, 100) });
    res.json({ ok: true, action: 'edited', saved_reply: edited_reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CLARIFY — mark that AI should have asked for clarification
router.post('/action/clarify', async (req, res) => {
  try {
    const { conversation_id, decision_id, reason } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id necesar' });

    if (decision_id) {
      await supabase.from('ai_reply_decisions')
        .update({ operator_verdict: 'should_clarify', reply_status: 'needs_clarification' })
        .eq('id', decision_id);
    }

    await supabase.from('ai_learned_corrections').insert({
      conversation_id, correction_type: 'should_clarify',
      verdict: 'should_clarify', reason: reason || 'Trebuia clarificare',
      changed_by: 'operator'
    });

    await audit('mark_clarify', 'conversation', conversation_id, { decision_id, reason });
    res.json({ ok: true, action: 'marked_clarify' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HANDOFF — stop AI, mark for human operator
router.post('/action/handoff', async (req, res) => {
  try {
    const { conversation_id, decision_id, reason } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id necesar' });

    if (decision_id) {
      await supabase.from('ai_reply_decisions')
        .update({ operator_verdict: 'handoff', reply_status: 'blocked_autoreply' })
        .eq('id', decision_id);
    }

    // Update goal state if exists
    await supabase.from('ai_goal_states')
      .update({ current_state: 'human_takeover', next_best_action: 'operator_handles', updated_by: 'operator' })
      .eq('conversation_id', conversation_id);

    await supabase.from('ai_learned_corrections').insert({
      conversation_id, correction_type: 'handoff',
      verdict: 'handoff', reason: reason || 'Trimis la operator',
      changed_by: 'operator'
    });

    await audit('handoff', 'conversation', conversation_id, { decision_id, reason });
    res.json({ ok: true, action: 'handoff', autoreply_blocked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 3. FIELD REGISTRY CRUD
// ═══════════════════════════════════════════

router.get('/fields', async (req, res) => {
  try {
    const fields = await FR.loadFields(true);
    // Classify each field
    const result = fields.map(f => {
      const safety = FR.checkFieldSafety(f.field_key);
      return {
        ...f,
        bind_status: f.sensitive ? 'sensitive' : f.requires_custom_handler ? 'custom' : (!f.storage_path ? 'no_mapping' : 'auto_bind'),
        safety_info: safety
      };
    });
    res.json({ fields: result, total: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/fields', async (req, res) => {
  try {
    const result = await FR.createField(req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    await audit('create_field', 'field_registry', result.field.id, { field_key: result.field.field_key });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/fields/:id', async (req, res) => {
  try {
    const result = await FR.updateField(req.params.id, req.body);
    if (result.error) return res.status(400).json({ error: result.error });
    await audit('update_field', 'field_registry', req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/fields/:id', async (req, res) => {
  try {
    const result = await FR.deleteField(req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    await audit('deactivate_field', 'field_registry', req.params.id, {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 4. SERVICE REQUIREMENTS (from registry)
// ═══════════════════════════════════════════

router.get('/services', (req, res) => {
  const allSvc = SRE.getAllServices();
  // Enrich with field registry data
  const services = allSvc.map(s => {
    const regFields = FR.getFieldsForService(s.service_key);
    const classified = FR.classifyFields(s.service_key);
    return {
      service_key: s.service_key,
      display_name: s.display_name,
      description: s.description,
      tags: s.tags,
      autonomy_allowed: s.autonomy_allowed,
      registry_fields: regFields.length,
      auto_bind: classified.auto_bind.length,
      sensitive: classified.sensitive.length,
      custom: classified.needs_handler.length,
      required_fields: regFields.filter(f => f.required || f.create_required).map(f => ({ field_key: f.field_key, label: f.label })),
      optional_fields: regFields.filter(f => !f.required && !f.create_required).map(f => ({ field_key: f.field_key, label: f.label })),
      questions: regFields.filter(f => f.question_text).map(f => ({ field_key: f.field_key, question: f.question_text, order: f.question_order })).sort((a,b) => a.order - b.order)
    };
  });
  res.json({ services, total: services.length });
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

    // Use field registry for analysis
    const analysis = FR.analyzeCompletion(key, eventData);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// 5. EVENT ACTIONS — Create, Update, Analyze
// ═══════════════════════════════════════════

router.post('/events/create', async (req, res) => {
  try {
    const { client_id, conversation_id, service_key, fields } = req.body;
    if (!client_id || !conversation_id || !service_key) {
      return res.status(400).json({ error: 'Necesar: client_id, conversation_id, service_key' });
    }

    const result = await SRE.createEventPlan(client_id, conversation_id, service_key, fields || {});
    
    // Also write fields via registry if available
    if (result.plan?.id && fields) {
      const writeResult = await FR.writeFields(result.plan.id, fields, 'ai');
      result.field_write = writeResult;
    }

    await audit('create_event', 'event_plan', result.plan.id, { service_key, fields, readiness: result.analysis.readiness });
    res.status(201).json({ ok: true, action: 'created', plan_id: result.plan.id, readiness: result.analysis.readiness, missing_required: result.analysis.missing_required, next_question: result.analysis.next_question });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/events/:id/update', async (req, res) => {
  try {
    const { fields, reason } = req.body;
    if (!fields || Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Niciun câmp de actualizat' });
    }

    // Check safety per field via registry
    const safetyResults = {};
    const safeFields = {};
    const blockedFields = {};

    for (const [key, val] of Object.entries(fields)) {
      const check = FR.checkFieldSafety(key, 'update');
      safetyResults[key] = check;
      if (check.safe) safeFields[key] = val;
      else blockedFields[key] = { value: val, reason: check.reason, action: check.action };
    }

    if (Object.keys(safeFields).length === 0 && Object.keys(blockedFields).length > 0) {
      return res.status(403).json({ ok: false, blocked: true, blocked_fields: blockedFields, reason: 'Toate câmpurile sunt blocate' });
    }

    // Write safe fields via registry
    const writeResult = await FR.writeFields(req.params.id, safeFields, 'operator');

    // Also use SRE for mutation audit
    if (writeResult.ok) {
      const result = await SRE.updateEventPlanFields(req.params.id, safeFields, reason || 'operator_update');
    }

    await audit('update_event', 'event_plan', req.params.id, { fields: safeFields, blocked: blockedFields });
    res.json({ ok: true, action: 'updated', plan_id: req.params.id, written: Object.keys(safeFields), blocked: blockedFields, write_result: writeResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/events/detect-intent', async (req, res) => {
  try {
    const { message, client_id } = req.body;
    if (!message) return res.status(400).json({ error: 'Mesajul este necesar' });

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

router.get('/events/:id', async (req, res) => {
  try {
    const { data: plan, error } = await supabase.from('ai_event_plans').select('*').eq('id', req.params.id).single();
    if (error || !plan) return res.status(404).json({ error: 'Nu a fost găsit' });

    const serviceKey = (plan.requested_services || [])[0];
    const analysis = serviceKey ? FR.analyzeCompletion(serviceKey, plan) : null;
    const { data: mutations } = await supabase.from('ai_event_mutations').select('*').eq('event_draft_id', req.params.id).order('created_at', { ascending: false }).limit(20);
    res.json({ plan, analysis, mutations: mutations || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
