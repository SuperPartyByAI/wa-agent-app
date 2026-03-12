-- ============================================
-- 011: AI Knowledge Base + Learning Corrections
-- ============================================

-- 1. Knowledge Base — verified answers to common questions
CREATE TABLE IF NOT EXISTS ai_knowledge_base (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    category        text NOT NULL DEFAULT 'faq',          -- servicii, preturi, faq, politici
    question_patterns text[] NOT NULL DEFAULT '{}',        -- matching patterns: ["pachete animatie","animator"]
    answer          text NOT NULL,                         -- verified answer text
    metadata        jsonb DEFAULT '{}',                    -- prices, conditions, extras
    verified_by     text DEFAULT 'operator_manual',        -- who approved this entry
    active          boolean DEFAULT true,                  -- can be deactivated without deletion
    times_used      integer DEFAULT 0,                     -- usage counter
    match_threshold float DEFAULT 0.6,                     -- min similarity for matching
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_kb_active ON ai_knowledge_base(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_kb_category ON ai_knowledge_base(category);

-- 2. Learned Corrections — operator edits that AI can learn from
CREATE TABLE IF NOT EXISTS ai_learned_corrections (
    id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id     uuid REFERENCES conversations(id),
    original_ai_reply   text,                              -- what AI generated
    corrected_reply     text NOT NULL,                     -- what operator sent instead
    question_context    text,                              -- what the client asked
    correction_type     text DEFAULT 'edit',               -- edit, rewrite, reject
    similarity_score    float DEFAULT 0,                   -- how different from original (0=identical, 1=completely different)
    times_seen          integer DEFAULT 1,                 -- how many times similar correction appeared
    promoted_to_kb      boolean DEFAULT false,             -- was promoted to Knowledge Base
    promoted_kb_id      uuid REFERENCES ai_knowledge_base(id),
    created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_promoted ON ai_learned_corrections(promoted_to_kb) WHERE promoted_to_kb = false;
CREATE INDEX IF NOT EXISTS idx_corrections_times ON ai_learned_corrections(times_seen);

-- 3. Seed initial KB with known services
INSERT INTO ai_knowledge_base (category, question_patterns, answer, metadata) VALUES
(
    'servicii',
    ARRAY['pachete animatie', 'animator copii', 'animatie petrecere', 'ce aveti pentru petrecere', 'animator pentru copii'],
    'Oferim pachete de animație personalizate pentru petreceri 🎉

🎈 Animator cu jocuri interactive și activități distractive
🎨 Facepainting (picturi pe față)
🎈 Baloane modelate
🍭 Vată de zahăr
🍿 Popcorn

Pachetele se personalizează în funcție de numărul de copii, durata și locația evenimentului.

Ca să vă fac o ofertă, am nevoie de câteva detalii:
• Ce tip de eveniment este? (aniversare, botez, etc.)
• Câți copii vor fi?
• Ce dată și locație aveți în vedere?',
    '{"service_type": "animator", "min_price": 500, "currency": "RON"}'::jsonb
),
(
    'servicii',
    ARRAY['vata de zahar', 'vata zahar', 'cotton candy', 'stand vata'],
    'Da, avem stand de vată de zahăr! 🍭

Se poate închiria separat sau ca parte dintr-un pachet complet de petrecere.
Vă putem face o ofertă personalizată.

Ce dată aveți în vedere și unde va fi evenimentul?',
    '{"service_type": "vata_zahar"}'::jsonb
),
(
    'servicii',
    ARRAY['popcorn', 'floricele', 'masina popcorn', 'stand popcorn'],
    'Sigur, avem mașină de popcorn! 🍿

Poate fi închiriată separat sau inclusă într-un pachet.
Popcornul este proaspăt, nelimitat pe durata evenimentului.

Spuneți-mi data evenimentului și locația ca să vă fac o ofertă.',
    '{"service_type": "popcorn"}'::jsonb
),
(
    'servicii',
    ARRAY['ursitoare', 'ursitoarea', 'botez ursitoare'],
    'Da, oferim servicii de ursitoare pentru botez! ✨

Ursitoarea noastră aduce o prezentare elegantă, personalizată cu urările pentru bebe.

Am nevoie de câteva detalii:
• Data botezului
• Locația (restaurant, acasă, etc.)
• Numele bebelușului',
    '{"service_type": "ursitoare"}'::jsonb
),
(
    'servicii',
    ARRAY['baloane', 'arcada baloane', 'aranjament baloane', 'decor baloane'],
    'Oferim decoruri din baloane pentru orice eveniment! 🎈

• Arcadă de baloane (diverse modele și dimensiuni)
• Aranjamente personalizate
• Cifre volumetrice din baloane
• Buchet de baloane cu heliu

Spuneți-mi ce tip de eveniment aveți, data și locația, și vă fac o ofertă!',
    '{"service_type": "arcada_baloane"}'::jsonb
),
(
    'preturi',
    ARRAY['cat costa', 'ce pret', 'preturi', 'tarife', 'oferta de pret'],
    'Prețurile variază în funcție de serviciile dorite, durata evenimentului, locație și număr de invitați.

Ca să vă pot face o ofertă personalizată, am nevoie de:
• Ce servicii vă interesează?
• Data evenimentului
• Locația
• Numărul aproximativ de copii/invitați

Vă fac oferta rapid după ce am aceste detalii! 😊',
    '{"note": "generic pricing response"}'::jsonb
),
(
    'faq',
    ARRAY['acoperiti zona', 'veniti in', 'acoperiti si', 'zonele acoperite', 'mergeti si in'],
    'Acoperim Bucureștiul și împrejurimile (până la ~50 km).

Pentru evenimente în afara Bucureștiului se aplică un cost suplimentar de deplasare.

Spuneți-mi locația exactă și vă confirm dacă putem ajunge!',
    '{"coverage": "Bucuresti + 50km"}'::jsonb
);
