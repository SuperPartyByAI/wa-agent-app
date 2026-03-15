/**
 * The Action Registry defines all permitted tool actions the AI Agent can emit.
 * Each action includes its strict JSON Schema, execution policy rules, and risk level.
 */

export const ActionRiskLevel = {
    SAFE: 'safe',                 // E.g. reply, add notes. Can happen anytime.
    MODERATE: 'moderate',         // E.g. update event plan. Needs basic context sync.
    HIGH: 'high',                 // E.g. confirm booking, archive. Needs rigorous Goal State checks.
    CRITICAL: 'critical'          // E.g. override, delete. Needs Human confirmation.
};

export const ACTION_REGISTRY = {
    reply_only: {
        description: 'Used when the agent only needs to converse, answer questions, or ask for clarifications without modifying any database records.',
        riskLevel: ActionRiskLevel.SAFE,
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Brief internal reason why no action is taken (e.g. "answering question", "asking for date")' }
            },
            required: ['reason']
        },
        allowedGoalStates: ['*'] // Allowed anywhere
    },

    update_event_plan: {
        description: 'Used to safely update the current Event Plan draft with newly extracted entities (date, location, packages, children count, payment details).',
        riskLevel: ActionRiskLevel.MODERATE,
        schema: {
            type: 'object',
            properties: {
                // General Fields
                tip_eveniment: { type: 'string', description: 'Tipul evenimentului (ex. botez, zi de nastere, nunta)' },
                data_evenimentului: { type: 'string', description: 'Data evenimentului (ex. 20 aprilie)' },
                ora_evenimentului: { type: 'string', description: 'Ora evenimentului (ex. 17:00)' },
                locatie_eveniment: { type: 'string', description: 'Locatia generala sau numele locatiei' },
                localitate: { type: 'string', description: 'Localitatea' },
                judet: { type: 'string', description: 'Judetul' },
                adresa_completa: { type: 'string', description: 'Adresa exacta/completa a locatiei' },
                interior_sau_exterior: { type: 'string', description: 'Interior sau exterior' },
                numar_estimativ_invitati: { type: 'number', description: 'Numar total estimativ de invitati' },
                numar_copii: { type: 'number', description: 'Numar de copii participanti' },
                nume_sarbatorit: { type: 'string', description: 'Numele sarbatoritului (copilului)' },
                data_nasterii_sarbatoritului: { type: 'string', description: 'Data nasterii copilului' },
                varsta_sarbatoritului: { type: 'string', description: 'Varsta copilului (ex. implineste 5 ani)' },
                tematica_eveniment: { type: 'string', description: 'Tematica petrecerii' },
                observatii_generale: { type: 'string', description: 'Observatii sau mentiuni generale' },

                // Billing Fields
                metoda_de_plata: { type: 'string', description: 'Metoda de plata aleasa: cash, transfer bancar' },
                doreste_factura: { type: 'boolean', description: 'Daca clientul vrea factura (true/false)' },
                nume_facturare: { type: 'string', description: 'Numele pe care se face factura' },
                firma: { type: 'string', description: 'Numele firmei pentru facturare' },
                cui: { type: 'string', description: 'CUI-ul firmei' },
                reg_com: { type: 'string', description: 'Numarul de Inregistrare la Registrul Comertului' },
                adresa_facturare: { type: 'string', description: 'Adresa integrala de facturare' },
                email_facturare: { type: 'string', description: 'Adresa de email unde va fi trimisa factura/oferta' },
                persoana_contact_facturare: { type: 'string', description: 'Numele persoanei de contact pentru facturare' },
                telefon_facturare: { type: 'string', description: 'Numarul de telefon' },
                
                // Animatie
                personaj_dorit: { type: 'string', description: 'Personajul dorit pentru animatie (ex. Spiderman, Elsa)' },
                numar_animatori: { type: 'number', description: 'Numarul de animatori dorit' },
                durata_ore: { type: 'number', description: 'Durata in ore a prestarii serviciului (animatie, vata de zahar, popcorn)' },
                tematica_dorita: { type: 'string', description: 'Tematica dorita pentru activitati' },
                activitati_dorite: { type: 'string', description: 'Activitati dorite de la clovni sau animatori' },
                observatii_animatie: { type: 'string', description: 'Detalii specifice despre animatie' },

                // Arcade & Mascote
                metri_liniari: { type: 'number', description: 'Metri liniari pentru arcada de baloane' },
                model_arcada: { type: 'string', description: 'Modelul (ex. organica, clasica) sau forma dorita' },
                culori_dorite: { type: 'string', description: 'Culorile dorite pentru baloane' },
                zona_amplasare: { type: 'string', description: 'Locul de amplasare a arcadei' },
                cifre_dorite: { type: 'string', description: 'Ce cifre (numere) doreste sa ataseze la arcada' },
                culoare_cifre: { type: 'string', description: 'Culoarea cifrelor' },
                culori_arcada: { type: 'string', description: 'Culori specifice arcadei (daca e separata de cifre)' },
                tip_suport: { type: 'string', description: 'Tip suport (cerc, panou etc.)' },
                
                // Vata / Popcorn
                numar_estimat_portii: { type: 'number', description: 'Numar portii vata/popcorn' },
                acces_curent_electric: { type: 'boolean', description: 'Daca exista acces la sursa de curent (true/false)' },
                observatii_vata_de_zahar: { type: 'string', description: 'Observatii pentru vata de zahar' },
                observatii_popcorn: { type: 'string', description: 'Observatii pentru masina de popcorn' },
                observatii_pachet: { type: 'string', description: 'Observatii pentru pachetul combinat (vata+popcorn)' }
            }
            // All properties are optional (it's a partial update)
        },
        allowedGoalStates: [
            'new_lead',
            'greeting',
            'discovery',
            'service_selection',
            'event_qualification',
            'package_recommendation',
            'booking_pending',
            'reschedule_pending'
        ]
    },

    generate_quote_draft: {
        description: 'Used to actively trigger the generation of a pricing quote draft based on the current Event Plan.',
        riskLevel: ActionRiskLevel.MODERATE,
        schema: {
            type: 'object',
            properties: {
                target_package: { type: 'string', description: 'The exact package code to quote (e.g. super_3_confetti)' }
            },
            required: ['target_package']
        },
        allowedGoalStates: [
            'package_recommendation',
            'quotation_draft',
            'objection_handling'
        ]
    },

    confirm_booking_from_ai_plan: {
        description: 'Used to finalize the event and dispatch it to the Core API for official booking creation. High risk.',
        riskLevel: ActionRiskLevel.HIGH,
        schema: {
            type: 'object',
            properties: {
                ai_event_plan_id: { type: 'string', description: 'Optional. The ID of the plan to confirm. If omitted, the system will infer it from the active context.' }
            }
        },
        allowedGoalStates: [
            'booking_ready',
            'booking_confirmed'       // Explicitly requires the goal state to be mature
        ]
    },

    archive_plan: {
        description: 'Used to softly discard an event plan because the client explicitly canceled, rejected the offer, or the conversation resulted in a dead-end.',
        riskLevel: ActionRiskLevel.HIGH,
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why is the plan being archived?' }
            },
            required: ['reason']
        },
        allowedGoalStates: [
            'discovery',
            'service_selection',
            'event_qualification',
            'package_recommendation',
            'quotation_draft',
            'quotation_sent',
            'objection_handling',
            'booking_pending',
            'cancelled'
        ]
    },

    handoff_to_operator: {
        description: 'Used when the AI cannot satisfy the client request, encounters an aggressive objection, or the user explicitly asks for a human.',
        riskLevel: ActionRiskLevel.SAFE, // Safe because it delegates control
        schema: {
            type: 'object',
            properties: {
                reason: { type: 'string', description: 'Why is human intervention needed?' }
            },
            required: ['reason']
        },
        allowedGoalStates: ['*']
    }
};

/**
 * Validates a tool action payload against the registry schema.
 */
export function validateToolActionSchema(actionName, args) {
    const registryEntry = ACTION_REGISTRY[actionName];
    if (!registryEntry) {
        return { valid: false, error: `Action '${actionName}' is not recognized in the registry.` };
    }

    const schema = registryEntry.schema;
    if (schema.required) {
        for (const req of schema.required) {
            if (args[req] === undefined || args[req] === null) {
                return { valid: false, error: `Missing required argument: '${req}' for action '${actionName}'` };
            }
        }
    }

    // Basic enum validation + type coercion
    if (schema.properties) {
        for (const [key, rules] of Object.entries(schema.properties)) {
            const val = args[key];
            if (val !== undefined && rules.enum && !rules.enum.includes(val)) {
                return { valid: false, error: `Invalid enum value for '${key}'. Allowed: ${rules.enum.join(', ')}` };
            }
            // Type coercion: if schema expects number but LLM sent string, try to coerce
            if (val !== undefined && rules.type === 'number' && typeof val !== 'number') {
                const parsed = Number(val);
                if (!isNaN(parsed)) {
                    args[key] = parsed; // Coerce in place
                } else {
                    return { valid: false, error: `Type mismatch for '${key}'. Expected number, got '${val}'.` };
                }
            }
        }
    }

    return { valid: true };
}
