/**
 * Service Requirements Engine
 *
 * Loads service-catalog.json and provides:
 * - Per-service field requirements (required/optional)
 * - Missing field detection
 * - Create/update readiness evaluation
 * - Clarification logic for ambiguous requests
 * - Question generation for missing fields
 *
 * Ticket: stabilizare/antigravity - Service Requirements Engine
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../../service-catalog.json');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Load & Cache Catalog ───
let catalog = null;
let catalogMap = {};

export function loadCatalog() {
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    catalogMap = {};
    for (const svc of catalog.services || []) {
      catalogMap[svc.service_key] = svc;
    }
    console.log(`[SRE] Loaded ${Object.keys(catalogMap).length} service definitions`);
  } catch (e) {
    console.error('[SRE] Failed to load catalog:', e.message);
    catalog = { services: [] };
    catalogMap = {};
  }
  return catalogMap;
}

export function getServiceDef(serviceKey) {
  if (!catalog) loadCatalog();
  return catalogMap[serviceKey] || null;
}

export function getAllServices() {
  if (!catalog) loadCatalog();
  return catalog.services || [];
}

// ─── Field Analysis ───

/**
 * Given a service key and current event plan data, returns:
 * - missing_required: fields still needed
 * - missing_optional: optional fields not yet filled
 * - filled: fields already provided
 * - readiness: 'ready' | 'needs_more' | 'almost_ready'
 * - next_question: the next question to ask
 */
export function analyzeFields(serviceKey, eventData = {}) {
  const svc = getServiceDef(serviceKey);
  if (!svc) return { error: 'unknown_service', service_key: serviceKey };

  const required = svc.required_fields || [];
  const optional = svc.optional_fields || [];
  const fieldMap = mapEventToFields(eventData);

  const filled = [];
  const missingRequired = [];
  const missingOptional = [];

  for (const f of required) {
    if (fieldMap[f]) filled.push(f);
    else missingRequired.push(f);
  }
  for (const f of optional) {
    if (fieldMap[f]) filled.push(f);
    else missingOptional.push(f);
  }

  const totalRequired = required.length;
  const filledRequired = totalRequired - missingRequired.length;
  const completionPct = totalRequired > 0 ? Math.round((filledRequired / totalRequired) * 100) : 100;

  let readiness = 'needs_more';
  if (missingRequired.length === 0) readiness = 'ready';
  else if (missingRequired.length <= 1) readiness = 'almost_ready';

  // Pick next question from standard_questions based on missing field order
  const questionOrder = svc.question_order || svc.required_fields || [];
  let nextQuestion = null;
  let nextField = null;
  const questions = svc.standard_questions || [];
  const missingPrompts = svc.missing_field_prompts || {};

  for (const f of questionOrder) {
    if (missingRequired.includes(f)) {
      nextField = f;
      nextQuestion = missingPrompts[f] || questions[questionOrder.indexOf(f)] || `Care este ${f.replaceAll('_', ' ')}?`;
      break;
    }
  }

  return {
    service_key: serviceKey,
    display_name: svc.display_name,
    required: required,
    optional: optional,
    filled,
    missing_required: missingRequired,
    missing_optional: missingOptional,
    completion_pct: completionPct,
    readiness,
    next_field: nextField,
    next_question: nextQuestion,
    autonomy_allowed: svc.autonomy_allowed !== false,
    human_review_triggers: svc.human_review_triggers || [],
    cross_sell: svc.cross_sell_services || []
  };
}

/**
 * Map event plan columns to service catalog field names.
 * The catalog uses Romanian field names (e.g. 'data_eveniment'),
 * but the DB uses English (e.g. 'event_date').
 */
function mapEventToFields(eventData) {
  const map = {};
  const aliases = {
    'data_eveniment': ['event_date'],
    'locatie': ['location'],
    'durata_ore': ['duration_hours'],
    'nr_copii': ['children_count_estimate'],
    'varsta_copil': ['child_age'],
    'interval_orar': ['event_time'],
    'nr_invitati': ['adults_count_estimate', 'children_count_estimate'],
    'sex_copil': ['child_gender'],
    'nume_copil': ['child_name'],
    'tematica': ['occasion', 'event_type'],
    'personaj_preferat': ['selected_characters', 'requested_services'],
  };

  // Direct DB fields
  for (const [k, v] of Object.entries(eventData)) {
    if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) {
      map[k] = true;
    }
  }

  // Map aliases
  for (const [catalogField, dbFields] of Object.entries(aliases)) {
    for (const dbField of dbFields) {
      const val = eventData[dbField];
      if (val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0)) {
        map[catalogField] = true;
        break;
      }
    }
  }

  return map;
}

// ─── Detect Intent: Create vs Update ───

export function detectIntent(message, existingPlans = []) {
  const lower = (message || '').toLowerCase();

  const updatePatterns = [
    /mut[aă]/i, /schimb[aă]/i, /modific[aă]/i, /actualiz/i,
    /în loc de/i, /nu mai vr/i, /mai pune/i, /mai adaug/i,
    /scoate/i, /elimina/i, /renunț/i, /anule/i,
    /alt[aă] (or[aă]|dat[aă]|adres[aă]|loca[tț]ie)/i,
    /la ora/i, /pe data/i, /la adresa/i
  ];

  const isUpdate = updatePatterns.some(p => p.test(lower));

  if (isUpdate && existingPlans.length === 0) {
    return { intent: 'create', reason: 'update_language_but_no_existing_plan' };
  }

  if (isUpdate && existingPlans.length === 1) {
    return { intent: 'update', target_plan_id: existingPlans[0].id, reason: 'clear_update_single_plan' };
  }

  if (isUpdate && existingPlans.length > 1) {
    return { intent: 'clarify', reason: 'multiple_plans_active', plans: existingPlans.map(p => ({ id: p.id, event_type: p.event_type, event_date: p.event_date })) };
  }

  return { intent: 'create', reason: 'new_request' };
}

// ─── Update Safety Check ───

const SENSITIVE_FIELDS = ['budget_min', 'budget_max', 'advance_amount', 'payment_method_preference', 'billing_details_status'];
const CONFIRMED_BLOCK_FIELDS = ['event_date', 'location']; // after booking confirmed

export function checkUpdateSafety(eventPlan, fieldsToUpdate = {}) {
  const issues = [];

  // Check if plan is confirmed/booked
  const isConfirmed = ['confirmed', 'booked', 'paid'].includes(eventPlan?.status);

  for (const field of Object.keys(fieldsToUpdate)) {
    if (SENSITIVE_FIELDS.includes(field)) {
      issues.push({ field, reason: 'sensitive_field', action: 'require_operator' });
    }
    if (isConfirmed && CONFIRMED_BLOCK_FIELDS.includes(field)) {
      issues.push({ field, reason: 'confirmed_booking_change', action: 'require_operator' });
    }
  }

  if (issues.length > 0) {
    return { safe: false, issues, recommendation: 'operator_review' };
  }

  return { safe: true, issues: [], recommendation: 'auto_update' };
}

// ─── Detect Fields from Message ───

export function extractFieldsFromMessage(message) {
  const fields = {};

  // Date patterns
  const dateMatch = message.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dateMatch) {
    const y = dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3];
    fields.event_date = `${y}-${dateMatch[2].padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`;
  }

  // Time patterns
  const timeMatch = message.match(/(?:la |ora |pe la )(\d{1,2})[:.h](\d{0,2})/i);
  if (timeMatch) {
    fields.event_time = `${timeMatch[1].padStart(2,'0')}:${(timeMatch[2]||'00').padStart(2,'0')}`;
  }

  // Duration
  const durationMatch = message.match(/(\d+)\s*(?:ore|h|hours)/i);
  if (durationMatch) {
    fields.duration_hours = parseInt(durationMatch[1]);
  }

  // Linear Meters
  const metersMatch = message.match(/(\d+)\s*(?:m|metri|metru|ml)/i);
  if (metersMatch) {
    fields.linear_meters = parseInt(metersMatch[1]);
  }

  // Children count
  const kidMatch = message.match(/(\d+)\s*(?:copii|copil|kids|children)/i);
  if (kidMatch) {
    fields.children_count_estimate = parseInt(kidMatch[1]);
  }

  // Age
  const ageMatch = message.match(/(?:împlinește|face|ani|age)\s*(\d+)/i) || message.match(/(\d+)\s*(?:ani|anișor)/i);
  if (ageMatch) {
    fields.child_age = parseInt(ageMatch[1]);
  }

  return fields;
}

// ─── Event Plan Operations (DB) ───

export async function createEventPlan(clientId, conversationId, serviceKey, fields = {}) {
  const svc = getServiceDef(serviceKey);
  const analysis = analyzeFields(serviceKey, fields);

  const plan = {
    client_id: clientId,
    conversation_id: conversationId,
    status: 'draft',
    event_type: svc?.display_name || serviceKey,
    event_date: fields.event_date || null,
    event_time: fields.event_time || null,
    location: fields.location || null,
    venue_type: fields.venue_type || null,
    children_count_estimate: fields.children_count_estimate || null,
    child_age: fields.child_age || null,
    requested_services: [serviceKey],
    missing_fields: analysis.missing_required,
    confidence: analysis.completion_pct,
    readiness_for_quote: analysis.readiness === 'ready',
    last_updated_by: 'ai',
    source_of_last_mutation: 'service_requirements_engine'
  };

  const { data, error } = await supabase.from('ai_event_plans').insert(plan).select().single();
  if (error) throw error;

  // Log mutation
  await supabase.from('ai_event_mutations').insert({
    conversation_id: conversationId,
    event_draft_id: data.id,
    mutation_type: 'create_event',
    changed_by: 'ai',
    before_json: {},
    after_json: plan,
    delta_json: fields,
    reason_summary: `Created via SRE for ${serviceKey}`,
    confidence: analysis.completion_pct
  });

  return { plan: data, analysis };
}

export async function updateEventPlanFields(planId, fieldsToUpdate, reason = 'client_request') {
  // Get current plan
  const { data: current, error: fetchErr } = await supabase.from('ai_event_plans')
    .select('*').eq('id', planId).single();
  if (fetchErr) throw fetchErr;

  // Safety check
  const safety = checkUpdateSafety(current, fieldsToUpdate);
  if (!safety.safe) {
    return { updated: false, safety, reason: 'blocked_by_safety' };
  }

  // Detect service from current plan
  const serviceKey = (current.requested_services || [])[0];
  const before = {};
  const after = {};
  for (const [k, v] of Object.entries(fieldsToUpdate)) {
    before[k] = current[k];
    after[k] = v;
  }

  // Apply update
  const updates = {
    ...fieldsToUpdate,
    last_updated_by: 'ai',
    last_updated_at: new Date().toISOString(),
    source_of_last_mutation: 'service_requirements_engine'
  };

  // Recalculate missing_fields after update
  const merged = { ...current, ...fieldsToUpdate };
  if (serviceKey) {
    const analysis = analyzeFields(serviceKey, merged);
    updates.missing_fields = analysis.missing_required;
    updates.confidence = analysis.completion_pct;
    updates.readiness_for_quote = analysis.readiness === 'ready';
  }

  const { data, error } = await supabase.from('ai_event_plans')
    .update(updates).eq('id', planId).select().single();
  if (error) throw error;

  // Log mutation
  await supabase.from('ai_event_mutations').insert({
    conversation_id: current.conversation_id,
    event_draft_id: planId,
    mutation_type: 'update_fields',
    changed_by: 'ai',
    before_json: before,
    after_json: after,
    delta_json: fieldsToUpdate,
    reason_summary: reason,
    confidence: updates.confidence || 0
  });

  return { updated: true, plan: data, before, after, safety };
}

// Initialize on import
loadCatalog();

export default {
  loadCatalog, getServiceDef, getAllServices,
  analyzeFields, detectIntent, checkUpdateSafety,
  extractFieldsFromMessage, createEventPlan, updateEventPlanFields
};
