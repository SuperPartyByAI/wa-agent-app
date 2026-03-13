import { CATALOG_MAP } from '../services/postProcessServices.mjs';
import { formatQuoteForBrainTab } from '../quotes/quoteFormatter.mjs';

/**
 * Builds the dynamic layout_json for Android Brain Tab.
 * Generates schema-driven components from AI analysis results.
 */
export function buildBrainSchema({
    decision,
    clientMemory,
    eventDraft,
    convState,
    entityMemory,
    serviceData,
    suggestedReply,
    replyStatus,
    eligibility,
    salesCycle,
    replyQuality,
    mutation,
    mutationResult,
    progression,
    autonomy,
    escalation,
    goalState,
    eventPlan,
    nextBestAction,
    latestQuote
}) {
    const schema = [];

    // ── Status Badge ──
    const statusItems = [
        { label: "Incredere AI", value: `${decision.confidence_score}%` },
        { label: "Etapa", value: decision.conversation_stage }
    ];
    if (decision.escalation_reason) {
        statusItems.push({ label: "Escaladare", value: decision.escalation_reason });
    }
    schema.push({ type: "status_badge", items: statusItems });

    // ── Entity Badge (entity_type + eligibility) ──
    if (entityMemory) {
        const entityItems = [
            { label: "Tip Entitate", value: entityMemory.entity_type || "necunoscut" },
            { label: "Incredere", value: `${entityMemory.entity_confidence || 0}%` }
        ];
        if (eligibility) {
            entityItems.push({
                label: "Auto-reply",
                value: eligibility.eligible ? "Eligible" : eligibility.reason
            });
        }
        schema.push({ type: "entity_badge", items: entityItems });
    }

    // ── Cycle Badge ──
    if (salesCycle) {
        const cycleLabels = {
            'no_previous_cycle': 'Conversatie noua',
            'closed_cycle_new_event': 'Ciclu nou detectat',
            'closed_cycle_new_request': 'Cerere noua detectata',
            'closed_cycle_no_new_request': 'Ciclu vechi, fara cerere noua',
            'active_cycle_same_event': 'Eveniment activ in lucru',
            'active_cycle_new_event_needs_review': 'Eveniment nou + ciclu activ',
            'active_cycle_ambiguous': 'Ciclu activ, ambiguu',
            'ambiguous_cycle_detection': 'Ambiguu'
        };
        schema.push({
            type: "cycle_badge",
            items: [
                { label: "Ciclu", value: cycleLabels[salesCycle.cycle_reason] || salesCycle.cycle_reason },
                { label: "Status", value: salesCycle.active_cycle_status || 'necunoscut' },
                { label: "Eveniment", value: salesCycle.same_event_or_new_event || 'necunoscut' }
            ]
        });
    }

    // ── Quality Badge ──
    if (replyQuality) {
        const qualityLabels = { good: '✅ Bun', okay: '⚠️ Acceptabil', weak: '❌ Slab' };
        schema.push({
            type: "quality_badge",
            items: [
                { label: "Calitate Reply", value: qualityLabels[replyQuality.reply_quality_label] || replyQuality.reply_quality_label },
                { label: "Scor", value: `${replyQuality.reply_quality_score}/100` },
                { label: "Stil", value: replyQuality.reply_style || 'necunoscut' }
            ]
        });
    }

    // ── Event Status Badge ──
    if (mutationResult?.applied || mutation) {
        const statusLabels = {
            active: '✅ Activ',
            cancelled: '❌ Anulat',
            archived: '📦 Arhivat',
            completed: '✅ Finalizat',
            confirmed: '✅ Confirmat'
        };
        const currentStatus = mutationResult?.afterStatus || 'active';
        const mutationType = mutation?.mutation_type || 'no_mutation';
        const mutationLabels = {
            create_event: 'Eveniment nou creat',
            update_event: 'Eveniment actualizat',
            change_date: 'Data schimbata',
            change_location: 'Locatia schimbata',
            change_time: 'Ora schimbata',
            add_service: 'Serviciu adaugat',
            remove_service: 'Serviciu scos',
            replace_service: 'Serviciu inlocuit',
            cancel_event: 'Eveniment anulat',
            reactivate_event: 'Eveniment reactivat',
            confirm_event: 'Eveniment confirmat',
            no_mutation: 'Fara schimbare'
        };

        const items = [
            { label: "Status Eveniment", value: statusLabels[currentStatus] || currentStatus },
            { label: "Ultima Actiune", value: mutationLabels[mutationType] || mutationType }
        ];

        if (mutation?.mutation_reason) {
            items.push({ label: "Detaliu", value: mutation.mutation_reason });
        }

        schema.push({ type: "event_status_badge", items });

        // Delta card (what changed)
        if (mutationResult?.delta && Object.keys(mutationResult.delta).length > 0) {
            const deltaItems = [];
            for (const [key, val] of Object.entries(mutationResult.delta)) {
                if (key.startsWith('_')) continue; // skip meta fields
                deltaItems.push({
                    label: key,
                    value: `${val.before || '(gol)'} \u2192 ${val.after || '(gol)'}`
                });
            }
            if (deltaItems.length > 0) {
                schema.push({
                    type: "mutation_delta_card",
                    title: "Ce s-a schimbat",
                    items: deltaItems
                });
            }
        }
    }

    // ── Rezumat card ──
    schema.push({
        type: "card",
        title: "Creier AI - Rezumat",
        items: [
            { label: "Prioritate", value: clientMemory.priority_level },
            { label: "Intent", value: convState.current_intent }
        ]
    });

    // ── Entity Memory card ──
    if (entityMemory && entityMemory.entity_type !== 'unknown') {
        const memoryItems = [];
        if (entityMemory.usual_locations?.length > 0) {
            memoryItems.push({
                label: "Locatii uzuale",
                value: entityMemory.usual_locations.map(l => l.name).join(', ')
            });
        }
        if (entityMemory.usual_services?.length > 0) {
            memoryItems.push({
                label: "Servicii uzuale",
                value: entityMemory.usual_services.map(s => {
                    const entry = CATALOG_MAP[s.service_key];
                    return entry?.display_name || s.service_key;
                }).join(', ')
            });
        }
        if (entityMemory.behavior_patterns?.length > 0) {
            memoryItems.push({
                label: "Tipare",
                value: entityMemory.behavior_patterns.join(', ')
            });
        }
        if (entityMemory.notes_for_ops?.length > 0) {
            memoryItems.push({
                label: "Note",
                value: entityMemory.notes_for_ops.join(', ')
            });
        }
        if (memoryItems.length > 0) {
            schema.push({
                type: "memory_card",
                title: "Memorie Entitate",
                items: memoryItems
            });
        }
    }

    // ── Service list ──
    if (serviceData.selected_services.length > 0) {
        schema.push({
            type: "service_list",
            title: "Servicii Detectate",
            items: serviceData.selected_services.map(key => {
                const catalogEntry = serviceData.catalog_map[key];
                const missing = serviceData.missing_fields_per_service[key] || [];
                const status = missing.length === 0 ? 'complet' : `${missing.length} lipsa`;
                return { label: catalogEntry?.display_name || key, value: status };
            })
        });

        // Service missing cards
        for (const key of serviceData.selected_services) {
            const catalogEntry = serviceData.catalog_map[key];
            const missing = serviceData.missing_fields_per_service[key] || [];
            const extracted = {};
            // Get extracted fields to show completed ones
            const svcReq = serviceData.service_requirements?.[key];
            if (svcReq?.extracted_fields) {
                Object.entries(svcReq.extracted_fields).forEach(([k, v]) => {
                    if (v && v !== 'null') extracted[k] = v;
                });
            }

            if (missing.length > 0) {
                schema.push({
                    type: "service_missing_card",
                    title: `${catalogEntry?.display_name || key} - Lipsuri`,
                    items: [
                        ...missing.map(f => ({ label: f, value: "lipsa" })),
                        ...Object.entries(extracted).map(([k, v]) => ({ label: k, value: String(v) }))
                    ]
                });
            }
        }

        // Cross-sell card
        if (serviceData.cross_sell_opportunities.length > 0) {
            schema.push({
                type: "cross_sell_card",
                title: "Sugestii Suplimentare",
                text: "Servicii complementare pe care le puteti oferi clientului:",
                items: serviceData.cross_sell_opportunities.map(key => {
                    const entry = CATALOG_MAP[key];
                    return { label: entry?.display_name || key, value: entry?.description || '' };
                })
            });
        }
    }

    // ── Draft Eveniment ──
    schema.push({
        type: "card",
        title: "Draft Eveniment",
        items: [
            { label: "Tip", value: eventDraft.structured_data?.event_type || "Nespecificat" },
            { label: "Locatie", value: eventDraft.structured_data?.location || "Nespecificat" },
            { label: "Data", value: eventDraft.structured_data?.date || "Nespecificat" }
        ]
    });

    // ── Suggested Reply ──
    schema.push({
        type: "reply_card",
        title: replyStatus === 'sent' ? "Raspuns Trimis de AI" : "Raspuns Propus",
        text: suggestedReply,
        items: [
            { label: "Status", value: replyStatus === 'sent' ? "Trimis automat" : "Asteapta confirmare" }
        ],
        action: "inject_reply",
        action_payload: suggestedReply
    });

    // ── Prompt input ──
    schema.push({
        type: "prompt_input",
        title: "Instructiune Operator",
        text: "Scrie o instructiune pentru AI (ex: raspunde mai cald, intreaba de numarul de copii)",
        action: "send_prompt"
    });

    // ── Autonomy Badge ──
    if (autonomy) {
        const autonomyEmoji = autonomy.autonomy_level === 'full' ? '🟢' : autonomy.autonomy_level === 'supervised' ? '🟡' : '🔴';
        schema.push({
            type: "status_badge",
            title: `${autonomyEmoji} Autonomie Agent`,
            items: [
                { label: "Nivel", value: autonomy.autonomy_level || 'necunoscut' },
                { label: "Actiune", value: autonomy.effective_action || '-' },
                { label: "Permis", value: autonomy.action_autonomy_allowed ? 'Da' : 'Nu' },
                { label: "Motiv", value: (autonomy.autonomy_decision_reason || '').substring(0, 80) }
            ]
        });
    }

    // ── Next Step Card ──
    if (progression) {
        const progressItems = [
            { label: "Pas urmator", value: progression.next_step || '-' },
            { label: "Motiv", value: (progression.next_step_reason || '').substring(0, 80) },
            { label: "Status", value: progression.progression_status || '-' },
            { label: "Campuri lipsa", value: `${progression.missing_critical_count}/${progression.total_fields_needed}` },
            { label: "Completate", value: progression.completed_fields?.join(', ') || 'niciunul' }
        ];
        if (progression.next_question_field) {
            progressItems.push({ label: "Intrebare", value: progression.next_question_field });
        }
        schema.push({
            type: "section",
            title: "📋 Progres Conversatie",
            items: progressItems
        });
    }

    // ── Escalation Badge ──
    if (escalation && escalation.needs_escalation) {
        schema.push({
            type: "status_badge",
            title: "⚠️ Escaladare",
            items: [
                { label: "Tip", value: escalation.escalation_type || '-' },
                { label: "Motiv", value: (escalation.escalation_reason || '').substring(0, 120) },
                { label: "Actiune recomandata", value: (escalation.recommended_operator_action || '').substring(0, 100) }
            ]
        });
    }

    // ── General missing fields ──
    const generalMissing = eventDraft.missing_fields || [];
    if (generalMissing.length > 0) {
        schema.push({
            type: "form_card",
            title: "Trebuie sa aflam:",
            items: generalMissing.map(f => ({ label: f, value: "" }))
        });
    }

    // ── Goal State Card ──
    if (goalState) {
        const stateLabels = {
            new_lead: '🆕 Lead Nou', greeting: '👋 Salut', discovery: '🔍 Descoperire',
            service_selection: '🎯 Selectare Servicii', event_qualification: '📋 Calificare Eveniment',
            package_recommendation: '📦 Recomandare Pachete', quotation_draft: '📝 Ofertă Draft',
            quotation_sent: '📤 Ofertă Trimisă', objection_handling: '🤝 Obiecții',
            booking_pending: '⏳ Rezervare Pending', booking_confirmed: '✅ Confirmat',
            reschedule_pending: '🔄 Reprogramare', cancelled: '❌ Anulat', completed: '✅ Finalizat'
        };
        const goalItems = [
            { label: 'Stare', value: stateLabels[goalState.current_state] || goalState.current_state }
        ];
        if (goalState.previous_state) {
            goalItems.push({ label: 'Anterioară', value: stateLabels[goalState.previous_state] || goalState.previous_state });
        }
        schema.push({ type: 'section', title: '🧠 Goal State', items: goalItems });
    }

    // ── Next Best Action Card ──
    if (nextBestAction) {
        const nbaItems = [
            { label: 'Acțiune', value: nextBestAction.action || '-' },
            { label: 'Explicație', value: (nextBestAction.explanation || '').substring(0, 120) }
        ];
        if (nextBestAction.question) {
            nbaItems.push({ label: 'Întrebare', value: nextBestAction.question });
        }
        schema.push({ type: 'section', title: '🎯 Următoarea Acțiune', items: nbaItems });
    }

    // ── Event Plan Card ──
    if (eventPlan && eventPlan.id) {
        const planItems = [];
        if ((eventPlan.requested_services || []).length > 0) {
            planItems.push({ label: 'Servicii', value: eventPlan.requested_services.join(', ') });
        }
        if (eventPlan.event_date) planItems.push({ label: 'Data', value: eventPlan.event_date });
        if (eventPlan.location) planItems.push({ label: 'Locație', value: eventPlan.location });
        if (eventPlan.guest_count) planItems.push({ label: 'Invitați', value: String(eventPlan.guest_count) });
        if (eventPlan.child_age) planItems.push({ label: 'Vârsta copil', value: String(eventPlan.child_age) });

        const readyEmoji = eventPlan.readiness_for_quote ? '✅' : '⏳';
        planItems.push({ label: 'Gata de ofertă', value: `${readyEmoji} ${eventPlan.readiness_for_quote ? 'Da' : 'Nu'}` });

        if ((eventPlan.missing_fields || []).length > 0) {
            planItems.push({ label: 'Lipsă', value: eventPlan.missing_fields.join(', ') });
        }
        planItems.push({ label: 'Completare', value: `${eventPlan.confidence || 0}%` });
        schema.push({ type: 'section', title: '📅 Plan Eveniment', items: planItems });
    }

    // ── Quote Card ──
    if (latestQuote) {
        const quoteCard = formatQuoteForBrainTab(latestQuote);
        if (quoteCard) schema.push(quoteCard);
    }

    return schema;
}
