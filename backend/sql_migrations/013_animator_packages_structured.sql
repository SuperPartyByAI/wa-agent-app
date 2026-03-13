-- ============================================
-- 013: Animator Packages — Structured KB Seed
-- ============================================
-- Updates existing animator_packages with structured metadata
-- Adds animator_pricing_general and animator_package_comparison

-- 1. Update animator_packages with full structured package data
UPDATE ai_knowledge_base
SET
    category = 'packages',
    answer_template = E'Avem mai multe variante de animație, de la 490 lei până la 1290 lei 🎉\n\nDe exemplu:\n• 1 personaj · 2 ore — 490 lei\n• Super 3: 2 personaje · 2 ore + confetti — 840 lei\n• 1 personaj · 2 ore + vată + popcorn — 840 lei\n• 1 animator · 3 ore + 4 ursitoare — 1290 lei\n\nToate includ transport gratuit în București.\nDacă vrei, îți recomand imediat varianta potrivită în funcție de vârsta copilului, numărul de invitați și data evenimentului! 😊',
    metadata = '{
        "currency": "RON",
        "transport_notes": "Transport gratuit în București",
        "price_range": {"min": 490, "max": 1290},
        "packages": [
            {
                "package_code": "animator_1p_2h",
                "title": "1 Personaj · 2 ore",
                "subtitle": null,
                "price": 490,
                "duration_text": "2 ore",
                "character_count": 1,
                "weekday_only": false,
                "includes": [
                    "Jocuri & concursuri interactive",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri & coregrafii",
                    "Tatuaje temporare",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["basic", "entry"]
            },
            {
                "package_code": "animator_2p_1h_weekday",
                "title": "2 Personaje · 1 oră (L–V)",
                "subtitle": null,
                "price": 490,
                "duration_text": "1 oră",
                "character_count": 2,
                "weekday_only": true,
                "includes": [
                    "Jocuri & concursuri interactive",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri & coregrafii",
                    "Tatuaje temporare",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["basic", "weekday"]
            },
            {
                "package_code": "super_3_confetti",
                "title": "Super 3",
                "subtitle": "2 Personaje · 2 ore + Confetti",
                "price": 840,
                "duration_text": "2 ore",
                "character_count": 2,
                "weekday_only": false,
                "includes": [
                    "Jocuri & concursuri interactive",
                    "Confetti party",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri & coregrafii",
                    "Tatuaje temporare",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["premium", "confetti", "named"]
            },
            {
                "package_code": "animator_tort_dulciuri",
                "title": "1 Personaj · 1 oră + Tort dulciuri",
                "subtitle": null,
                "price": 590,
                "duration_text": "1 oră",
                "character_count": 1,
                "weekday_only": false,
                "includes": [
                    "Tort din dulciuri (22–24 copii)",
                    "Jocuri & concursuri",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["combo", "tort"]
            },
            {
                "package_code": "animator_vata_popcorn",
                "title": "1 Pers. · 2 ore + 1h Vată + 1h Popcorn",
                "subtitle": null,
                "price": 840,
                "duration_text": "2 ore animator + 1h vată + 1h popcorn",
                "character_count": 1,
                "weekday_only": false,
                "includes": [
                    "Mașină vată de zahăr + popcorn",
                    "Jocuri & concursuri",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["combo", "popcorn", "vata"]
            },
            {
                "package_code": "super_5_banner_confetti",
                "title": "Super 5",
                "subtitle": "1 Animator · 2 ore + Banner + Confetti",
                "price": 540,
                "duration_text": "2 ore",
                "character_count": 1,
                "weekday_only": false,
                "includes": [
                    "Banner personalizat + Tun confetti",
                    "Jocuri & concursuri",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["premium", "confetti", "banner", "named"]
            },
            {
                "package_code": "animator_3h_4_ursitoare",
                "title": "1 Animator · 3 ore + 4 Ursitoare",
                "subtitle": null,
                "price": 1290,
                "duration_text": "3 ore",
                "character_count": 1,
                "weekday_only": false,
                "includes": [
                    "Spectacol 4 ursitoare botez",
                    "Jocuri & concursuri",
                    "Baloane modelate",
                    "Pictură pe față",
                    "Dansuri",
                    "Diplome magnetice",
                    "Boxă portabilă",
                    "Transport gratuit București"
                ],
                "tags": ["premium", "ursitoare", "botez"]
            }
        ]
    }'::jsonb,
    question_patterns = ARRAY[
        'pachete animatie', 'animator copii', 'animatie petrecere',
        'ce aveti pentru petrecere', 'animator', 'animatie',
        'ce pachete aveti', 'ce variante aveti', 'pachete animator',
        'ce include pachetul', 'ce include', 'ce contine pachetul',
        'pachetul de 490', 'pachetul de 540', 'pachetul de 590',
        'pachetul de 840', 'pachetul de 1290',
        '490 lei', '540 lei', '590 lei', '840 lei', '1290 lei',
        'include la animator', 'aveti cu popcorn', 'aveti cu vata',
        'aveti cu confetti', 'aveti cu ursitoare', 'aveti cu tort',
        'super 3', 'super 5'
    ],
    required_context = ARRAY['event_type', 'child_count', 'event_date', 'location'],
    updated_at = now()
WHERE knowledge_key = 'animator_packages';

-- Also update category constraint to include 'packages'
-- (already present from 011 migration)

-- 2. Delete old animator_pricing_general if exists, insert fresh
DELETE FROM ai_knowledge_base WHERE knowledge_key = 'animator_pricing_general';

INSERT INTO ai_knowledge_base (
    knowledge_key, category, service_tags, question_patterns,
    answer_template, metadata, required_context,
    approval_status, active, verified_by, source
) VALUES (
    'animator_pricing_general',
    'pricing',
    ARRAY['animator'],
    ARRAY['cat costa animatorul', 'ce pret animator', 'preturi animatie',
          'tarife animator', 'cat costa animatie', 'pret animatie',
          'cat costa', 'ce preturi aveti la animatie'],
    E'Pachetele noastre de animație pornesc de la 490 lei 🎉\n\nAvem variante la: 490 / 540 / 590 / 840 / 1290 lei\n\nPrețul depinde de:\n• Numărul de personaje (1 sau 2)\n• Durata (1–3 ore)\n• Extra-uri incluse (confetti, vată de zahăr, popcorn, tort, ursitoare)\n\nTransport gratuit în București.\n\nSpune-mi ce tip de eveniment ai și câți copii vor fi, și îți recomand varianta potrivită! 😊',
    '{"currency": "RON", "price_range": {"min": 490, "max": 1290}, "prices": [490, 540, 590, 840, 1290], "transport_notes": "Transport gratuit în București"}'::jsonb,
    ARRAY['event_type', 'child_count', 'event_date'],
    'approved', true, 'system_seed', 'manual'
);

-- 3. Insert animator_package_comparison
DELETE FROM ai_knowledge_base WHERE knowledge_key = 'animator_package_comparison';

INSERT INTO ai_knowledge_base (
    knowledge_key, category, service_tags, question_patterns,
    answer_template, metadata, required_context,
    approval_status, active, verified_by, source
) VALUES (
    'animator_package_comparison',
    'packages',
    ARRAY['animator'],
    ARRAY['diferenta intre pachete', 'care e diferenta', 'ce e diferit',
          'compara pachete', 'care e mai bun', 'care se potriveste',
          'diferenta animator', 'comparatie pachete'],
    E'Diferențele principale între pachetele noastre:\n\n📦 490 lei — varianta simplă:\n• 1 personaj · 2 ore SAU 2 personaje · 1 oră (L–V)\n\n🎊 540 lei — Super 5:\n• 1 animator · 2 ore + banner personalizat + tun confetti\n\n🎂 590 lei — cu tort:\n• 1 personaj · 1 oră + tort din dulciuri (22–24 copii)\n\n⭐ 840 lei — variante premium:\n• Super 3: 2 personaje · 2 ore + confetti\n• SAU: 1 personaj · 2 ore + 1h vată + 1h popcorn\n\n👑 1290 lei — pachet complet botez:\n• 1 animator · 3 ore + spectacol 4 ursitoare\n\nToate includ transport gratuit în București.\nCare variantă te-ar interesa mai mult? 😊',
    '{"comparison_type": "full_range"}'::jsonb,
    ARRAY['event_type'],
    'approved', true, 'system_seed', 'manual'
);
