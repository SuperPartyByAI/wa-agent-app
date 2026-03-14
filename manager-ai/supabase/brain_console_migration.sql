-- ============================================================
-- AI Brain Console — Database Migration
-- 3 new tables: ai_brain_rules, ai_answer_patterns, ai_coverage_config
-- ============================================================

-- 1. Brain Rules — configurable behavioral rules
CREATE TABLE IF NOT EXISTS ai_brain_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  query_type TEXT,                     -- price_question, costume_query, reschedule, greeting, etc.
  trigger_stage TEXT,                  -- discovery, negotiation, booking, coordination, etc.
  trigger_conditions JSONB DEFAULT '{}',  -- {kb_key, client_segment, canal, has_booking, etc.}
  behavior TEXT NOT NULL,              -- answer_direct, clarify_first, ask_missing_field, use_kb, use_memory, handoff, block
  priority INT DEFAULT 50,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','candidate','approved','active','disabled','retired')),
  examples JSONB DEFAULT '[]',         -- [{question, good_answer, bad_answer, reason}]
  created_by TEXT DEFAULT 'operator',
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_rules_status ON ai_brain_rules(status);
CREATE INDEX IF NOT EXISTS idx_brain_rules_query_type ON ai_brain_rules(query_type);

-- 2. Answer Patterns — observed patterns from corrections & traffic
CREATE TABLE IF NOT EXISTS ai_answer_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  frequency INT DEFAULT 1,
  category TEXT,                       -- price_question, costume_query, etc.
  strategy TEXT,                       -- answer_direct, clarify_first, etc.
  template TEXT,                       -- template with variables
  conditions JSONB DEFAULT '{}',
  linked_rule_id UUID REFERENCES ai_brain_rules(id) ON DELETE SET NULL,
  examples JSONB DEFAULT '[]',
  status TEXT DEFAULT 'observed' CHECK (status IN ('observed','candidate','approved','rejected','retired')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_patterns_status ON ai_answer_patterns(status);
CREATE INDEX IF NOT EXISTS idx_answer_patterns_category ON ai_answer_patterns(category);

-- 3. Coverage Config — where AI can/cannot auto-reply
CREATE TABLE IF NOT EXISTS ai_coverage_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone TEXT NOT NULL UNIQUE,           -- greeting, simple_clarification, kb_guided_price, etc.
  coverage_level TEXT DEFAULT 'medium' CHECK (coverage_level IN ('high','medium','low')),
  autoreply_mode TEXT DEFAULT 'shadow_only' CHECK (autoreply_mode IN ('allow_autoreply','shadow_only','operator_review','blocked')),
  description TEXT,
  conditions JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_zone ON ai_coverage_config(zone);

-- ============================================================
-- Seed initial coverage zones
-- ============================================================
INSERT INTO ai_coverage_config (zone, coverage_level, autoreply_mode, description) VALUES
  ('greeting',              'high',   'allow_autoreply',  'Salut inițial — AI știe foarte bine'),
  ('simple_clarification',  'high',   'allow_autoreply',  'Clarificări simple (dată, locație, nr copii)'),
  ('kb_guided_answer',      'medium', 'shadow_only',      'Răspunsuri din KB (costume, pachete, prețuri)'),
  ('price_question',        'medium', 'shadow_only',      'Întrebări de preț cu clarificare durată'),
  ('service_discovery',     'medium', 'shadow_only',      'Discovery servicii — întrebare deschisă'),
  ('booking_modification',  'low',    'operator_review',  'Modificări booking existent — risc'),
  ('booking_cancellation',  'low',    'operator_review',  'Anulări — necesită confirmare operator'),
  ('identity_uncertain',    'low',    'operator_review',  'Identitate client incertă'),
  ('complaint',             'low',    'blocked',          'Reclamații — doar operator'),
  ('sensitive_policy',      'low',    'blocked',          'Politici sensibile — doar operator')
ON CONFLICT (zone) DO NOTHING;

-- ============================================================
-- Seed initial brain rules
-- ============================================================
INSERT INTO ai_brain_rules (name, description, query_type, trigger_stage, behavior, priority, status, examples) VALUES
  ('Costume Query → KB Direct',
   'Când clientul întreabă de un costum/personaj, răspunde direct din KB costume_disponibile',
   'costume_query', 'discovery', 'use_kb', 80, 'active',
   '[{"question":"Aveti personajul Sofia?","good_answer":"Da, avem Prințesa Sofia! 🎉","bad_answer":"Ce servicii vă interesează?","reason":"Clientul a cerut ceva concret"}]'),
  
  ('Price Question → Ask Duration',
   'Când clientul întreabă de preț generic, întreabă mai întâi durata',
   'price_question', 'discovery', 'clarify_first', 70, 'active',
   '[{"question":"Cât costă animatorul?","good_answer":"Cu drag! Pentru câte ore aveți nevoie?","bad_answer":"Prețul e între 500-1500 lei","reason":"Prețul depinde de durată"}]'),
   
  ('Ambiguous Reschedule → Clarify',
   'Când clientul vrea să modifice dar nu e clar ce, clarifică',
   'reschedule', 'coordination', 'clarify_first', 60, 'active',
   '[{"question":"Vreau să schimb","good_answer":"Sigur! Ce anume doriți să modificăm?","bad_answer":"Am modificat","reason":"Trebuie clarificat ce vrea să schimbe"}]'),
   
  ('Existing Client → Skip Known Fields',
   'Nu întreba din nou informații deja cunoscute din memory',
   'any', 'any', 'use_memory', 50, 'active',
   '[{"question":"Vreau animator","good_answer":"Bună Maria! Pe aceeași dată ca ultima dată?","bad_answer":"Cum vă numiți?","reason":"Știm deja cine e clientul"}]')
ON CONFLICT DO NOTHING;
