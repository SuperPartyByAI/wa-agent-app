-- ═══════════════════════════════════════════
-- 008: Field Registry — Dynamic field binding
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS field_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text','number','boolean','date','time','datetime','select','multiselect','list','notes')),
  service_keys TEXT[] DEFAULT '{}',
  required BOOLEAN DEFAULT false,
  question_text TEXT,
  clarification_text TEXT,
  question_order INTEGER DEFAULT 50,
  create_required BOOLEAN DEFAULT false,
  quote_required BOOLEAN DEFAULT false,
  update_allowed BOOLEAN DEFAULT true,
  clarify_if_ambiguous BOOLEAN DEFAULT true,
  sensitive BOOLEAN DEFAULT false,
  requires_custom_handler BOOLEAN DEFAULT false,
  storage_entity TEXT DEFAULT 'ai_event_plans',
  storage_path TEXT,
  storage_type TEXT DEFAULT 'column'
    CHECK (storage_type IN ('column','json_path','array_merge','array_replace')),
  ui_visible BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  default_value TEXT,
  validation_rules JSONB DEFAULT '{}',
  allowed_values TEXT[],
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT DEFAULT 'system'
);

-- RLS
ALTER TABLE field_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_field_registry"
  ON field_registry FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_field_registry_active ON field_registry(active);
CREATE INDEX IF NOT EXISTS idx_field_registry_service ON field_registry USING GIN(service_keys);

-- ═══════════════════════════════════════════
-- SEED: Standard field definitions
-- ═══════════════════════════════════════════

INSERT INTO field_registry (field_key, label, description, field_type, service_keys, required, question_text, clarification_text, question_order, create_required, quote_required, update_allowed, clarify_if_ambiguous, sensitive, storage_entity, storage_path, storage_type) VALUES
-- Core event fields
('event_date', 'Data eveniment', 'Data la care are loc evenimentul', 'date',
 '{animator,ursitoare,vata_zahar,popcorn,arcada_baloane,cifre_volumetrice,candy_bar,foto_video,personaje,mascote,dans,decor}',
 true, 'Pentru ce dată doriți evenimentul?', 'Vă rugăm să specificați data exactă (ex: 15 mai 2026)', 10, true, true, true, true, false, 'ai_event_plans', 'event_date', 'column'),

('event_time', 'Ora eveniment', 'Ora de începere a evenimentului', 'time',
 '{animator,ursitoare,vata_zahar,popcorn,arcada_baloane,cifre_volumetrice,candy_bar,foto_video,personaje,mascote,dans,decor}',
 true, 'La ce oră doriți să înceapă?', 'Vă rugăm să precizați ora exactă', 15, true, false, true, true, false, 'ai_event_plans', 'event_time', 'column'),

('location', 'Locație', 'Adresa sau locația evenimentului', 'text',
 '{animator,ursitoare,vata_zahar,popcorn,arcada_baloane,cifre_volumetrice,candy_bar,foto_video,personaje,mascote,dans,decor}',
 true, 'Unde va avea loc evenimentul?', 'Vă rugăm să specificați adresa completă', 20, true, true, true, true, false, 'ai_event_plans', 'location', 'column'),

('children_count_estimate', 'Număr copii', 'Numărul estimat de copii prezenți', 'number',
 '{animator,personaje,mascote,dans}',
 true, 'Câți copii vor fi la petrecere?', 'Câți copii estimați aproximativ?', 25, true, true, true, false, false, 'ai_event_plans', 'children_count_estimate', 'column'),

('child_age', 'Vârsta copilului', 'Vârsta copilului sărbătorit', 'number',
 '{animator,personaje}',
 true, 'Câți ani împlinește copilul?', 'Ce vârstă are copilul?', 30, true, false, true, false, false, 'ai_event_plans', 'child_age', 'column'),

('duration_hours', 'Durata (ore)', 'Durata programului în ore', 'number',
 '{animator,vata_zahar,popcorn,arcada_baloane,foto_video,personaje,mascote,dans}',
 true, 'Câte ore doriți programul?', 'Specificați durata în ore', 35, true, true, true, false, false, 'ai_event_plans', 'duration_hours', 'column'),

('occasion', 'Ocazie', 'Tipul evenimentului (zi de naștere, botez, etc)', 'select',
 '{animator,ursitoare,personaje,mascote,dans,decor}',
 false, 'Ce fel de eveniment este?', NULL, 40, false, false, true, false, false, 'ai_event_plans', 'occasion', 'column'),

('venue_type', 'Tip locație', 'Interior sau exterior', 'select',
 '{animator,vata_zahar,popcorn,arcada_baloane,foto_video,personaje,mascote,dans,decor}',
 false, 'Evenimentul este în interior sau exterior?', NULL, 45, false, false, true, false, false, 'ai_event_plans', 'venue_type', 'column'),

-- Characters/services specific
('selected_characters', 'Personaje selectate', 'Personajele dorite pentru eveniment', 'multiselect',
 '{personaje,mascote,animator}',
 false, 'Ce personaje doriți?', 'Care personaje preferați? (Elsa, Spiderman, Minnie, etc)', 50, false, true, true, true, false, 'ai_event_plans', 'requested_services', 'array_merge'),

-- Commercial / sensitive fields
('budget_min', 'Buget minim', 'Bugetul minim al clientului', 'number',
 '{animator,ursitoare,foto_video,personaje}',
 false, NULL, NULL, 90, false, true, false, true, true, 'ai_event_plans', 'budget_min', 'column'),

('budget_max', 'Buget maxim', 'Bugetul maxim al clientului', 'number',
 '{animator,ursitoare,foto_video,personaje}',
 false, NULL, NULL, 91, false, true, false, true, true, 'ai_event_plans', 'budget_max', 'column'),

('advance_amount', 'Avans', 'Suma de avans necesară', 'number',
 '{animator,ursitoare,foto_video,personaje,mascote,dans,decor}',
 false, NULL, NULL, 92, false, false, false, true, true, 'ai_event_plans', 'advance_amount', 'column'),

('payment_method_preference', 'Metoda de plată', 'Preferința pentru metoda de plată', 'select',
 '{animator,ursitoare,foto_video,personaje,mascote,dans,decor}',
 false, 'Ce metodă de plată preferați?', NULL, 93, false, false, true, true, true, 'ai_event_plans', 'payment_method_preference', 'column'),

('invoice_requested', 'Factură solicitată', 'Dacă clientul dorește factură', 'boolean',
 '{animator,ursitoare,foto_video,personaje,mascote,dans,decor}',
 false, 'Doriți factură?', NULL, 94, false, false, true, false, true, 'ai_event_plans', 'invoice_requested', 'column'),

-- Ursitoare specific
('child_name', 'Numele copilului', 'Numele copilului pentru botez', 'text',
 '{ursitoare}',
 true, 'Cum se numește copilul?', NULL, 32, true, false, true, false, false, 'ai_event_plans', 'audience_notes', 'column'),

('child_gender', 'Sexul copilului', 'Sexul copilului (fată/băiat)', 'select',
 '{ursitoare}',
 true, 'Este băiat sau fată?', NULL, 33, true, false, true, false, false, 'ai_event_plans', 'audience_notes', 'column'),

('adults_count', 'Număr invitați', 'Numărul estimat de invitați adulți', 'number',
 '{ursitoare,foto_video,decor}',
 false, 'Câți invitați vor fi?', NULL, 26, false, false, true, false, false, 'ai_event_plans', 'adults_count_estimate', 'column'),

-- Notes / freeform
('access_notes', 'Note acces', 'Indicații de acces la locație', 'notes',
 '{animator,vata_zahar,popcorn,arcada_baloane,foto_video,personaje,mascote,dans,decor}',
 false, 'Aveți indicații speciale de acces?', NULL, 80, false, false, true, false, false, 'ai_event_plans', 'audience_notes', 'column')

ON CONFLICT (field_key) DO NOTHING;
