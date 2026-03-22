/**
 * Field Registry — Dynamic Field Binding Engine
 * 
 * Loads field definitions from Supabase field_registry table.
 * Provides:
 * - Dynamic field loading per service
 * - Field analysis (missing/filled/readiness)
 * - Storage mapping (field → DB column/json_path/array)
 * - Write fields to target entities
 * - Validation
 * - Safety checks (sensitive, custom handler)
 * 
 * Key principle: new standard fields added via UI work automatically.
 * Sensitive / custom fields require explicit handling.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Cache ───
let _fields = [];
let _byKey = {};
let _byService = {};
let _lastLoad = 0;
const CACHE_TTL = 60_000; // 60s

// ─── Load & Cache ───

export async function loadFields(force = false) {
  if (!force && _fields.length > 0 && Date.now() - _lastLoad < CACHE_TTL) return _fields;

  const { data, error } = await supabase
    .from('field_registry')
    .select('*')
    .eq('active', true)
    .order('question_order', { ascending: true });

  if (error) {
    console.error('[FieldRegistry] Load error:', error.message);
    return _fields; // return stale cache
  }

  _fields = data || [];
  _byKey = {};
  _byService = {};

  for (const f of _fields) {
    _byKey[f.field_key] = f;
    for (const svc of (f.service_keys || [])) {
      if (!_byService[svc]) _byService[svc] = [];
      _byService[svc].push(f);
    }
  }

  _lastLoad = Date.now();
  console.log(`[FieldRegistry] Loaded ${_fields.length} active fields for ${Object.keys(_byService).length} services`);
  return _fields;
}

export function getField(fieldKey) { return _byKey[fieldKey] || null; }
export function getAllFields() { return _fields; }

export function getFieldsForService(serviceKey) {
  return _byService[serviceKey] || [];
}

// ─── Field Analysis ───

/**
 * Analyze which fields are filled/missing for a given service+event data.
 * Returns: { filled, missing_required, missing_optional, readiness, next_question, completion_pct }
 */
export function analyzeCompletion(serviceKey, eventData = {}) {
  const fields = getFieldsForService(serviceKey);
  if (!fields.length) return { error: 'no_fields_for_service', service_key: serviceKey };

  const filled = [];
  const missingRequired = [];
  const missingOptional = [];

  for (const f of fields) {
    const val = resolveValue(f, eventData);
    const hasVal = val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);

    if (hasVal) {
      filled.push({ field_key: f.field_key, label: f.label, value: val });
    } else if (f.required || f.create_required) {
      missingRequired.push({
        field_key: f.field_key,
        label: f.label,
        question: f.question_text,
        clarification: f.clarification_text,
        field_type: f.field_type,
        order: f.question_order
      });
    } else {
      missingOptional.push({ field_key: f.field_key, label: f.label });
    }
  }

  // Sort missing by question_order
  missingRequired.sort((a, b) => a.order - b.order);

  const totalReq = fields.filter(f => f.required || f.create_required).length;
  const filledReq = totalReq - missingRequired.length;
  const pct = totalReq > 0 ? Math.round((filledReq / totalReq) * 100) : 100;

  let readiness = 'needs_more';
  if (missingRequired.length === 0) readiness = 'ready';
  else if (missingRequired.length === 1) readiness = 'almost_ready';

  return {
    service_key: serviceKey,
    filled,
    missing_required: missingRequired,
    missing_optional: missingOptional,
    completion_pct: pct,
    readiness,
    next_question: missingRequired[0]?.question || null,
    next_field: missingRequired[0]?.field_key || null,
    next_field_type: missingRequired[0]?.field_type || null,
    total_fields: fields.length,
    total_required: totalReq
  };
}

// ─── Storage Mapping: Read ───

function resolveValue(fieldDef, eventData) {
  const { storage_path, storage_type } = fieldDef;
  if (!storage_path) return null;

  if (storage_type === 'column') {
    return eventData[storage_path];
  }

  if (storage_type === 'json_path') {
    // e.g. "preferences.location" → eventData.preferences?.location
    const parts = storage_path.split('.');
    let val = eventData;
    for (const p of parts) {
      if (val == null) return null;
      val = val[p];
    }
    return val;
  }

  if (storage_type === 'array_merge' || storage_type === 'array_replace') {
    return eventData[storage_path];
  }

  return eventData[storage_path];
}

// ─── Storage Mapping: Write ───

/**
 * Build the DB update object for a field write.
 * Returns { column_updates: {}, needs_fetch: bool }
 */
export function buildStorageUpdate(fieldKey, value) {
  const f = _byKey[fieldKey];
  if (!f) return { error: 'unknown_field', field_key: fieldKey };
  if (!f.storage_path) return { error: 'no_storage_mapping', field_key: fieldKey };

  // Validation
  const valResult = validateValue(f, value);
  if (!valResult.valid) return { error: 'validation_failed', details: valResult };

  // Safety check
  if (f.sensitive) return { error: 'sensitive_field', field_key: fieldKey, label: f.label, action: 'require_operator' };
  if (f.requires_custom_handler) return { error: 'custom_handler_required', field_key: fieldKey, label: f.label };

  if (f.storage_type === 'column') {
    return { updates: { [f.storage_path]: value }, entity: f.storage_entity };
  }

  if (f.storage_type === 'json_path') {
    // For JSON paths, we need to read-modify-write
    const parts = f.storage_path.split('.');
    const rootCol = parts[0];
    return { updates: null, json_write: { root: rootCol, path: parts.slice(1), value }, entity: f.storage_entity, needs_fetch: true };
  }

  if (f.storage_type === 'array_merge') {
    // Append to existing array
    return { updates: null, array_op: { column: f.storage_path, mode: 'merge', value: Array.isArray(value) ? value : [value] }, entity: f.storage_entity, needs_fetch: true };
  }

  if (f.storage_type === 'array_replace') {
    return { updates: { [f.storage_path]: Array.isArray(value) ? value : [value] }, entity: f.storage_entity };
  }

  return { updates: { [f.storage_path]: value }, entity: f.storage_entity };
}

// ─── Write Fields to Event Plan ───

export async function writeFields(planId, fieldValues = {}, changedBy = 'ai') {
  const results = [];
  const directUpdates = {};
  const blocked = [];
  const arrayOps = [];

  for (const [key, val] of Object.entries(fieldValues)) {
    const mapping = buildStorageUpdate(key, val);
    
    if (mapping.error) {
      blocked.push({ field_key: key, error: mapping.error, details: mapping });
      continue;
    }

    if (mapping.updates) {
      Object.assign(directUpdates, mapping.updates);
      results.push({ field_key: key, action: 'write', target: mapping.entity + '.' + Object.keys(mapping.updates)[0] });
    }

    if (mapping.array_op) {
      arrayOps.push({ field_key: key, ...mapping.array_op });
    }
  }

  // Apply direct column updates
  if (Object.keys(directUpdates).length > 0) {
    directUpdates.last_updated_by = changedBy;
    directUpdates.last_updated_at = new Date().toISOString();
    directUpdates.source_of_last_mutation = 'field_registry';

    const { data, error } = await supabase
      .from('ai_event_plans')
      .update(directUpdates)
      .eq('id', planId)
      .select()
      .single();

    if (error) return { ok: false, error: error.message };

    // Handle array merge ops
    for (const op of arrayOps) {
      const current = data[op.column] || [];
      const merged = [...new Set([...current, ...op.value])];
      await supabase.from('ai_event_plans').update({ [op.column]: merged }).eq('id', planId);
      results.push({ field_key: op.field_key, action: 'array_merge', target: op.column, values: merged });
    }

    return { ok: true, updated_plan: data, results, blocked };
  }

  if (blocked.length > 0) {
    return { ok: false, blocked, reason: 'all_fields_blocked' };
  }

  return { ok: true, results, blocked };
}

// ─── Validation ───

export function validateValue(fieldDef, value) {
  const { field_type, validation_rules, allowed_values } = fieldDef;

  // Type checks
  if (field_type === 'number' && value !== null && value !== undefined) {
    const n = Number(value);
    if (isNaN(n)) return { valid: false, reason: 'not_a_number' };
    if (validation_rules?.min !== undefined && n < validation_rules.min) return { valid: false, reason: `min ${validation_rules.min}` };
    if (validation_rules?.max !== undefined && n > validation_rules.max) return { valid: false, reason: `max ${validation_rules.max}` };
  }

  if (field_type === 'date' && value) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return { valid: false, reason: 'invalid_date_format (YYYY-MM-DD)' };
  }

  if (field_type === 'time' && value) {
    if (!/^\d{2}:\d{2}/.test(value)) return { valid: false, reason: 'invalid_time_format (HH:MM)' };
  }

  if (field_type === 'boolean' && value !== null && value !== undefined) {
    if (typeof value !== 'boolean' && !['true','false','da','nu','1','0'].includes(String(value).toLowerCase())) {
      return { valid: false, reason: 'not_boolean' };
    }
  }

  if ((field_type === 'select' || field_type === 'multiselect') && allowed_values?.length) {
    const vals = Array.isArray(value) ? value : [value];
    for (const v of vals) {
      if (!allowed_values.includes(v)) return { valid: false, reason: `invalid_value: ${v}. Allowed: ${allowed_values.join(', ')}` };
    }
  }

  return { valid: true };
}

// ─── Safety Layer ───

export function checkFieldSafety(fieldKey, operation = 'update') {
  const f = _byKey[fieldKey];
  if (!f) return { safe: false, reason: 'unknown_field' };
  
  if (f.sensitive) return { safe: false, reason: 'sensitive', label: f.label, action: 'require_operator' };
  if (f.requires_custom_handler) return { safe: false, reason: 'custom_handler', label: f.label, action: 'require_handler' };
  if (operation === 'update' && !f.update_allowed) return { safe: false, reason: 'update_not_allowed', label: f.label, action: 'blocked' };
  if (operation === 'update' && f.clarify_if_ambiguous) return { safe: true, needs_clarification_check: true, label: f.label };

  return { safe: true, auto_bind: true, label: f.label };
}

/**
 * Check which fields can be auto-bound vs need manual handling.
 * Returns: { auto_bind: [], needs_handler: [], sensitive: [], blocked: [] }
 */
export function classifyFields(serviceKey) {
  const fields = getFieldsForService(serviceKey);
  const auto_bind = [], needs_handler = [], sensitive = [], blocked = [];

  for (const f of fields) {
    if (!f.storage_path) { blocked.push(f); continue; }
    if (f.sensitive) { sensitive.push(f); continue; }
    if (f.requires_custom_handler) { needs_handler.push(f); continue; }
    auto_bind.push(f);
  }

  return { auto_bind, needs_handler, sensitive, blocked };
}

// ─── CRUD Helpers ───

export async function createField(fieldData) {
  // Validate required properties
  if (!fieldData.field_key) return { error: 'field_key required' };
  if (!fieldData.label) return { error: 'label required' };
  if (_byKey[fieldData.field_key]) return { error: 'duplicate_field_key' };
  if (fieldData.active && !fieldData.storage_path) return { error: 'active field requires storage_path' };

  const { data, error } = await supabase.from('field_registry').insert(fieldData).select().single();
  if (error) return { error: error.message };
  
  await loadFields(true); // Refresh cache
  return { ok: true, field: data };
}

export async function updateField(fieldId, updates) {
  updates.updated_at = new Date().toISOString();
  updates.version = (updates.version || 1) + 1;
  
  const { data, error } = await supabase.from('field_registry').update(updates).eq('id', fieldId).select().single();
  if (error) return { error: error.message };
  
  await loadFields(true);
  return { ok: true, field: data };
}

export async function deleteField(fieldId) {
  // Soft delete: just deactivate
  const { error } = await supabase.from('field_registry').update({ active: false, updated_at: new Date().toISOString() }).eq('id', fieldId);
  if (error) return { error: error.message };
  
  await loadFields(true);
  return { ok: true };
}

// ─── Initialize ───
loadFields().catch(e => console.error('[FieldRegistry] Init failed:', e.message));

export default {
  loadFields, getField, getAllFields, getFieldsForService,
  analyzeCompletion, buildStorageUpdate, writeFields,
  validateValue, checkFieldSafety, classifyFields,
  createField, updateField, deleteField
};
