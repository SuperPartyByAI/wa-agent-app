-- ============================================
-- 011: AI Knowledge Base + Learned Corrections
-- Full robust schema — v2
-- ============================================

-- ────────────────────────────────────────────
-- 1. AI Knowledge Base
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS ai_learned_corrections;
DROP TABLE IF EXISTS ai_knowledge_base;

CREATE TABLE ai_knowledge_base (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Identity
    knowledge_key       text NOT NULL UNIQUE,           -- e.g. animator_packages, popcorn_pricing
    category            text NOT NULL DEFAULT 'faq',    -- services, pricing, faq, policy, packages
    service_tags        text[] NOT NULL DEFAULT '{}',   -- e.g. {animator, popcorn}

    -- Matching
    question_patterns   text[] NOT NULL DEFAULT '{}',   -- keyword/phrase patterns for matching

    -- Content
    answer_template     text NOT NULL,                  -- verified factual answer
    metadata            jsonb DEFAULT '{}',             -- prices, durations, conditions, extra fields
    required_context    text[] DEFAULT '{}',             -- what's needed for complete answer: {event_date, location, guest_count}
    applicability_rules jsonb DEFAULT '{}',             -- e.g. {"only_if_service_detected": "animator"}

    -- Lifecycle
    approval_status     text NOT NULL DEFAULT 'draft',  -- draft, approved, rejected, archived
    active              boolean DEFAULT true,
    version             integer DEFAULT 1,
    source              text DEFAULT 'manual',          -- manual, auto_promoted, imported
    owner               text DEFAULT 'system',
    verified_by         text,
    valid_from          timestamptz DEFAULT now(),
    valid_until         timestamptz,                    -- NULL = no expiry

    -- Stats
    times_used          integer DEFAULT 0,

    -- Timestamps
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_approval_status CHECK (approval_status IN ('draft', 'approved', 'rejected', 'archived')),
    CONSTRAINT chk_category CHECK (category IN ('services', 'pricing', 'faq', 'policy', 'packages', 'learned'))
);

-- Indexes
CREATE INDEX idx_kb_active_approved ON ai_knowledge_base(active, approval_status)
    WHERE active = true AND approval_status = 'approved';
CREATE INDEX idx_kb_category ON ai_knowledge_base(category);
CREATE INDEX idx_kb_knowledge_key ON ai_knowledge_base(knowledge_key);
CREATE INDEX idx_kb_service_tags ON ai_knowledge_base USING GIN(service_tags);

-- ────────────────────────────────────────────
-- 2. AI Learned Corrections
-- ────────────────────────────────────────────
CREATE TABLE ai_learned_corrections (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Source
    conversation_id     uuid,
    original_ai_reply   text,
    corrected_reply     text NOT NULL,
    question_context    text,

    -- Classification
    correction_type     text DEFAULT 'edit',            -- edit, rewrite, reject, operator_override
    correction_scope    text DEFAULT 'factual',         -- factual, pricing, policy, service_info, tone, clarity, sales_style
    service_tags        text[] DEFAULT '{}',

    -- Aggregation
    similarity_score    float DEFAULT 0,
    times_seen          integer DEFAULT 1,

    -- KB Candidacy (NO auto-activate)
    kb_candidate_status text DEFAULT 'none',            -- none, candidate, approved, rejected
    promoted_to_kb      boolean DEFAULT false,
    promoted_kb_id      uuid REFERENCES ai_knowledge_base(id),

    -- Review
    reviewed_by         text,
    review_notes        text,

    -- Timestamps
    created_at          timestamptz DEFAULT now(),

    -- Constraints
    CONSTRAINT chk_correction_type CHECK (correction_type IN ('edit', 'rewrite', 'reject', 'operator_override')),
    CONSTRAINT chk_correction_scope CHECK (correction_scope IN ('factual', 'pricing', 'policy', 'service_info', 'tone', 'clarity', 'sales_style')),
    CONSTRAINT chk_kb_candidate CHECK (kb_candidate_status IN ('none', 'candidate', 'approved', 'rejected'))
);

CREATE INDEX idx_corrections_candidate ON ai_learned_corrections(kb_candidate_status) WHERE kb_candidate_status = 'candidate';
CREATE INDEX idx_corrections_scope ON ai_learned_corrections(correction_scope);
CREATE INDEX idx_corrections_times ON ai_learned_corrections(times_seen);

-- ────────────────────────────────────────────
-- 3. Seed KB — only verified factual entries
-- ────────────────────────────────────────────
INSERT INTO ai_knowledge_base (knowledge_key, category, service_tags, question_patterns, answer_template, metadata, required_context, approval_status, active, verified_by, source) VALUES
(
    'animator_packages',
    'services',
    ARRAY['animator'],
    ARRAY['pachete animatie', 'animator copii', 'animatie petrecere', 'ce aveti pentru petrecere', 'animator', 'animatie'],
    E'Oferim pachete de animație personalizate pentru petreceri 🎉\n\n🎈 Animator cu jocuri interactive și activități distractive\n🎨 Facepainting (picturi pe față)\n🎈 Baloane modelate\n🍭 Vată de zahăr\n🍿 Popcorn\n\nPachetele se personalizează în funcție de numărul de copii, durata și locația evenimentului.\n\nCa să vă fac o ofertă, am nevoie de câteva detalii:\n• Ce tip de eveniment este? (aniversare, botez, etc.)\n• Câți copii vor fi?\n• Ce dată și locație aveți în vedere?',
    '{"service_type": "animator"}'::jsonb,
    ARRAY['event_type', 'child_count', 'event_date', 'location'],
    'approved', true, 'system_seed', 'manual'
),
(
    'vata_zahar_info',
    'services',
    ARRAY['vata_zahar'],
    ARRAY['vata de zahar', 'vata zahar', 'cotton candy', 'stand vata'],
    E'Da, avem stand de vată de zahăr! 🍭\n\nSe poate închiria separat sau ca parte dintr-un pachet complet de petrecere.\nVă putem face o ofertă personalizată.\n\nCe dată aveți în vedere și unde va fi evenimentul?',
    '{"service_type": "vata_zahar"}'::jsonb,
    ARRAY['event_date', 'location'],
    'approved', true, 'system_seed', 'manual'
),
(
    'popcorn_info',
    'services',
    ARRAY['popcorn'],
    ARRAY['popcorn', 'floricele', 'masina popcorn', 'stand popcorn'],
    E'Sigur, avem mașină de popcorn! 🍿\n\nPoate fi închiriată separat sau inclusă într-un pachet.\nPopcornul este proaspăt, nelimitat pe durata evenimentului.\n\nSpuneți-mi data evenimentului și locația ca să vă fac o ofertă.',
    '{"service_type": "popcorn"}'::jsonb,
    ARRAY['event_date', 'location'],
    'approved', true, 'system_seed', 'manual'
),
(
    'ursitoare_info',
    'services',
    ARRAY['ursitoare'],
    ARRAY['ursitoare', 'ursitoarea', 'botez ursitoare'],
    E'Da, oferim servicii de ursitoare pentru botez! ✨\n\nUrsitoarea noastră aduce o prezentare elegantă, personalizată cu urările pentru bebe.\n\nAm nevoie de câteva detalii:\n• Data botezului\n• Locația (restaurant, acasă, etc.)\n• Numele bebelușului',
    '{"service_type": "ursitoare"}'::jsonb,
    ARRAY['event_date', 'location', 'baby_name'],
    'approved', true, 'system_seed', 'manual'
),
(
    'baloane_info',
    'services',
    ARRAY['arcada_baloane', 'arcada_suport', 'arcada_exterior', 'suport_arcada_baloane', 'cifre_volumetrice'],
    ARRAY['baloane', 'arcada baloane', 'aranjament baloane', 'decor baloane', 'cifre baloane', 'cifre volumetrice'],
    E'Oferim decoruri din baloane pentru orice eveniment! 🎈\n\n• Arcadă de baloane (diverse modele și dimensiuni)\n• Aranjamente personalizate\n• Cifre volumetrice din baloane\n• Buchet de baloane cu heliu\n\nSpuneți-mi ce tip de eveniment aveți, data și locația, și vă fac o ofertă!',
    '{"service_type": "arcada_baloane"}'::jsonb,
    ARRAY['event_type', 'event_date', 'location'],
    'approved', true, 'system_seed', 'manual'
),
(
    'booking_info_required',
    'faq',
    ARRAY['animator', 'popcorn', 'vata_zahar', 'ursitoare', 'arcada_baloane'],
    ARRAY['cum rezerv', 'cum pot rezerva', 'vreau sa rezerv', 'booking', 'rezervare'],
    E'Pentru o rezervare, am nevoie de următoarele detalii:\n\n📅 Data evenimentului\n📍 Locația\n👶 Numărul de copii / invitați\n🎂 Tipul evenimentului (aniversare, botez, nuntă, etc.)\n🎈 Ce servicii vă interesează\n\nDupă ce am aceste informații, vă trimitem o ofertă personalizată!',
    '{"note": "generic booking info"}'::jsonb,
    ARRAY['event_date', 'location', 'guest_count', 'event_type', 'services'],
    'approved', true, 'system_seed', 'manual'
),
(
    'pricing_general',
    'pricing',
    ARRAY['animator', 'popcorn', 'vata_zahar', 'ursitoare', 'arcada_baloane'],
    ARRAY['cat costa', 'ce pret', 'preturi', 'tarife', 'oferta de pret', 'pret'],
    E'Prețurile variază în funcție de serviciile dorite, durata evenimentului, locație și număr de invitați.\n\nCa să vă pot face o ofertă personalizată, am nevoie de:\n• Ce servicii vă interesează?\n• Data evenimentului\n• Locația\n• Numărul aproximativ de copii/invitați\n\nVă fac oferta rapid după ce am aceste detalii! 😊',
    '{"note": "generic pricing, actual prices vary"}'::jsonb,
    ARRAY['services', 'event_date', 'location', 'guest_count'],
    'approved', true, 'system_seed', 'manual'
),
(
    'covered_locations',
    'faq',
    ARRAY[],
    ARRAY['acoperiti zona', 'veniti in', 'acoperiti si', 'zonele acoperite', 'mergeti si in', 'in ce zone', 'in ce oras'],
    E'Acoperim Bucureștiul și împrejurimile (până la ~50 km).\n\nPentru evenimente în afara Bucureștiului se aplică un cost suplimentar de deplasare.\n\nSpuneți-mi locația exactă și vă confirm dacă putem ajunge!',
    '{"coverage": "Bucuresti + 50km"}'::jsonb,
    ARRAY['location'],
    'approved', true, 'system_seed', 'manual'
);
