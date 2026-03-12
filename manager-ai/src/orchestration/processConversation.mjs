import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_AUTOREPLY_CUTOFF, WHTSUP_API_URL, WHTSUP_API_KEY } from '../config/env.mjs';
import { callLocalLLM } from '../llm/client.mjs';
import { postProcessServices } from '../services/postProcessServices.mjs';
import { evaluateServiceConfidence } from '../services/evaluateServiceConfidence.mjs';
import { buildSystemPrompt } from '../prompts/systemPrompt.mjs';
import { buildBrainSchema } from '../schemas/buildBrainSchema.mjs';
import { evaluateEligibility } from '../policy/evaluateEligibility.mjs';
import { evaluateSalesCycle } from '../policy/evaluateSalesCycle.mjs';
import { composeHumanReply } from '../replies/composeHumanReply.mjs';
import { evaluateReplyQuality } from '../replies/evaluateReplyQuality.mjs';
import { buildReplyContext } from '../replies/buildReplyContext.mjs';
import { loadClientMemory } from '../memory/loadClientMemory.mjs';
import { updateClientMemory } from '../memory/updateClientMemory.mjs';
import { detectEventMutation } from '../events/detectEventMutation.mjs';
import { applyEventMutation } from '../events/applyEventMutation.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Send a message to WhatsApp via the whts-up transport API.
 */
async function sendViaWhatsApp(conversationId, text) {
    const { data: conv } = await supabase.from('conversations').select('session_id').eq('id', conversationId).single();
    if (!conv?.session_id) {
        console.error('[AutoSend] No session_id for conversation', conversationId);
        return false;
    }

    try {
        const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': WHTSUP_API_KEY },
            body: JSON.stringify({
                sessionId: conv.session_id,
                conversationId: conversationId,
                text: text,
                message_type: 'text'
            })
        });

        if (!response.ok) {
            console.error('[AutoSend] API error:', await response.text());
            return false;
        }
        console.log(`[AutoSend] Message sent for ${conversationId}`);
        return true;
    } catch (err) {
        console.error('[AutoSend] Network error:', err.message);
        return false;
    }
}

/**
 * Main orchestration pipeline.
 * Called by webhook (new message) or operator prompt (regeneration).
 */
export async function processConversation(conversation_id, message_id = null, operator_prompt = null) {
    if (!conversation_id) return;

    console.log(`[Pipeline] Starting for ${conversation_id}...`);

    try {
        // ── 1. Load conversation context ──
        const { data: convData } = await supabase
            .from('conversations')
            .select('client_id, created_at')
            .eq('id', conversation_id)
            .single();

        const clientId = convData?.client_id;
        const conversationCreatedAt = convData?.created_at;

        // Fetch messages
        const { data: messages, error: msgErr } = await supabase
            .from('messages')
            .select('content, direction, created_at, sender_type')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (msgErr) throw new Error(`Failed to fetch messages: ${msgErr.message}`);
        if (!messages || messages.length === 0) return;

        // ── 2. Load entity memory ──
        const existingMemory = await loadClientMemory(clientId);
        console.log(`[Pipeline] Entity memory: type=${existingMemory.entity_type}, locations=${existingMemory.usual_locations.length}, services=${existingMemory.usual_services.length}`);

        // ── 3. Check for legacy context + last inbound ──
        const lastHumanMsg = messages.find(m => m.sender_type === 'agent');
        const lastHumanActivityAt = lastHumanMsg?.created_at || null;

        // Find last inbound (client) message for cutoff reactivation check
        const lastInboundMsg = messages.find(m => m.sender_type !== 'agent');
        const lastInboundMessageAt = lastInboundMsg?.created_at || null;

        // Check for existing event draft before cutoff
        let hasExistingDraft = false;
        if (AI_AUTOREPLY_CUTOFF) {
            const { data: draftData } = await supabase
                .from('ai_event_drafts')
                .select('created_at')
                .eq('conversation_id', conversation_id)
                .maybeSingle();
            if (draftData && new Date(draftData.created_at) < new Date(AI_AUTOREPLY_CUTOFF)) {
                hasExistingDraft = true;
            }
        }

        // ── 4. Build transcript and call LLM ──
        const transcript = messages.reverse().map(m =>
            `[${new Date(m.created_at).toISOString()}] ${m.sender_type === 'agent' ? 'Superparty (Noi)' : 'Client'}: ${m.content}`
        ).join('\n');

        // Extract last client message for service confidence guard
        const lastClientMsg = [...messages].reverse().find(m => m.sender_type === 'client');
        const lastClientMessageText = lastClientMsg?.content || '';

        let userMessage = `--- CONVERSATIE ---\n${transcript}`;
        if (operator_prompt) {
            userMessage += `\n\n--- INSTRUCTIUNE OPERATOR ---\n${operator_prompt}\nAplicam instructiunea de mai sus la generarea raspunsului sugerat.`;
        }

        const systemPrompt = buildSystemPrompt(existingMemory);

        console.log(`[Pipeline] Calling LLM with ${transcript.length} chars${operator_prompt ? ' + operator prompt' : ''}...`);
        let analysis = await callLocalLLM(systemPrompt, userMessage);

        if (!analysis) {
            console.warn(`[Pipeline] LLM unreachable. Using mock fallback.`);
            analysis = {
                client_memory: { priority_level: 'normal', internal_notes_summary: 'LLM nedisponibil' },
                entity_memory: { entity_type: 'unknown', entity_confidence: 0, usual_locations: [], usual_services: [], preferences: {}, behavior_patterns: [], notes_for_ops: [] },
                event_draft: { draft_type: 'necunoscut', structured_data: { location: null, date: null, event_type: null }, missing_fields: [] },
                selected_services: [],
                service_requirements: {},
                missing_fields_per_service: {},
                cross_sell_opportunities: [],
                conversation_state: { current_intent: 'necunoscut', next_best_action: 'necunoscut' },
                suggested_reply: 'Buna! Va multumim pentru mesaj. Un coleg va reveni cu detalii in cel mai scurt timp.',
                decision: { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: 'lead' }
            };
        }

        // ── 5. Post-process ──
        const serviceData = postProcessServices(analysis);
        // Attach raw service_requirements for schema builder
        serviceData.service_requirements = analysis.service_requirements;

        const decision = analysis.decision || { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: 'lead' };
        let suggestedReply = analysis.suggested_reply || 'Nu am putut genera un raspuns.';
        const clientMemory = analysis.client_memory || { priority_level: 'normal', internal_notes_summary: '' };
        const eventDraft = analysis.event_draft || { draft_type: 'necunoscut', structured_data: {}, missing_fields: [] };
        const convState = analysis.conversation_state || { current_intent: 'necunoscut', next_best_action: 'necunoscut' };
        const entityMemory = analysis.entity_memory || existingMemory;

        // Force review if catalog says so
        if (serviceData.should_force_review) {
            decision.needs_human_review = true;
            decision.can_auto_reply = false;
        }

        // ── 6. Get existing conversation stage from DB ──
        const { data: stateData } = await supabase
            .from('ai_conversation_state')
            .select('current_stage')
            .eq('conversation_id', conversation_id)
            .maybeSingle();
        const dbStage = stateData?.current_stage;

        // ── 6.5. Evaluate sales cycle ──
        const llmSalesCycle = analysis.sales_cycle || { new_request_detected: false, same_event_or_new_event: 'no_previous', cycle_notes: '' };
        const existingDraftData = hasExistingDraft ? { updated_at: new Date().toISOString() } : null;
        const salesCycle = await evaluateSalesCycle({
            conversationId: conversation_id,
            currentStage: dbStage || decision.conversation_stage,
            llmSalesCycle,
            eventDraft: existingDraftData,
            lastHumanActivityAt,
            conversationCreatedAt
        });

        // ── 7. Evaluate eligibility (cycle-aware) ──
        const eligibility = evaluateEligibility({
            decision,
            conversationStage: dbStage || decision.conversation_stage,
            conversationCreatedAt,
            lastHumanActivityAt,
            hasExistingDraft,
            lastInboundMessageAt,
            salesCycle
        });

        console.log(`[Pipeline] Services: [${serviceData.selected_services.join(', ')}], Entity: ${entityMemory.entity_type} (${entityMemory.entity_confidence}%), Eligibility: ${eligibility.eligible ? 'ALLOWED' : eligibility.reason}, Cycle: ${salesCycle.cycle_eligibility}/${salesCycle.cycle_reason}, Decision: confidence=${decision.confidence_score}, stage=${decision.conversation_stage}`);

        // ── 8. Persist to DB ──
        // Client memory + entity memory
        if (clientId) {
            await updateClientMemory(clientId, entityMemory, existingMemory, clientMemory);
        }

        // Event drafts — mutation-aware
        const { data: existingDraftRow } = await supabase
            .from('ai_event_drafts')
            .select('id, draft_type, structured_data_json, missing_fields_json, draft_status, services, version')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        // Detect mutation
        const mutation = detectEventMutation(analysis, existingDraftRow);
        let mutationResult = { applied: false };

        if (mutation.mutation_type !== 'no_mutation') {
            mutationResult = await applyEventMutation({
                mutation,
                existingDraft: existingDraftRow,
                newDraftData: eventDraft,
                newServices: serviceData.selected_services,
                conversationId: conversation_id,
                clientId
            });
        } else {
            // No mutation detected — simple upsert (backwards compatible)
            const draftPayload = {
                client_id: clientId,
                draft_type: eventDraft.draft_type,
                structured_data_json: eventDraft.structured_data,
                missing_fields_json: eventDraft.missing_fields,
                updated_at: new Date().toISOString()
            };
            if (existingDraftRow) {
                await supabase.from('ai_event_drafts').update(draftPayload).eq('id', existingDraftRow.id);
            } else {
                await supabase.from('ai_event_drafts').insert({ conversation_id, ...draftPayload });
            }
        }

        console.log(`[Pipeline] Mutation: ${mutation.mutation_type} (confidence=${mutation.mutation_confidence}, applied=${mutationResult.applied})`);

        // Conversation state
        const statePayload = {
            conversation_id,
            current_intent: convState.current_intent,
            current_stage: decision.conversation_stage,
            next_best_action: convState.next_best_action,
            updated_at: new Date().toISOString()
        };
        if (message_id) statePayload.last_processed_message_id = message_id;
        await supabase.from('ai_conversation_state').upsert(statePayload);

        // ── 8.5. Service Detection Confidence Guard ──
        const serviceConfidence = evaluateServiceConfidence({
            analysis,
            selectedServices: serviceData.selected_services,
            lastClientMessage: lastClientMessageText
        });
        console.log(`[Pipeline] Service Detection: status=${serviceConfidence.service_detection_status}, confirmation=${serviceConfidence.service_confirmation_allowed}, confirmed=[${serviceConfidence.confirmed_services.join(',')}], ambiguous=[${serviceConfidence.ambiguous_services.join(',')}]`);

        // ── 8.6. Compose humanized reply ──
        let composerResult = { reply: suggestedReply, replyStyle: 'warm_sales', composerUsed: false, serviceDetectionStatus: 'unknown' };
        if (eligibility.eligible || !decision.needs_human_review) {
            composerResult = await composeHumanReply({
                analysis,
                entityMemory,
                salesCycle,
                conversationStage: dbStage || decision.conversation_stage,
                conversationText: userMessage,
                serviceConfidence
            });
            suggestedReply = composerResult.reply;
        }

        // ── 8.7. Evaluate reply quality ──
        const replyContext = buildReplyContext({ analysis, entityMemory, serviceConfidence });
        const replyQuality = evaluateReplyQuality({
            reply: suggestedReply,
            analysis,
            replyContext,
            entityMemory,
            replyStyle: composerResult.replyStyle,
            composerUsed: composerResult.composerUsed
        });

        // ── 9. Auto-send logic ──
        let replyStatus = 'pending';
        let sentBy = 'pending';
        let sentAt = null;

        if (eligibility.eligible) {
            console.log(`[Pipeline] Auto-reply ALLOWED (confidence=${decision.confidence_score}, style=${composerResult.replyStyle}). Sending...`);
            const sent = await sendViaWhatsApp(conversation_id, suggestedReply);
            if (sent) {
                replyStatus = 'sent';
                sentBy = 'ai';
                sentAt = new Date().toISOString();
            }
        } else if (decision.escalation_reason) {
            console.log(`[Pipeline] Escalation: ${decision.escalation_reason}`);
        }

        // ── 10. Audit trail ──
        const decisionPayload = {
            conversation_id,
            suggested_reply: suggestedReply,
            can_auto_reply: decision.can_auto_reply,
            needs_human_review: decision.needs_human_review,
            escalation_reason: decision.escalation_reason || null,
            confidence_score: decision.confidence_score,
            conversation_stage: decision.conversation_stage,
            reply_status: replyStatus,
            sent_by: sentBy,
            sent_at: sentAt,
            operator_prompt: operator_prompt || null
        };
        // Try with all columns (eligibility + quality)
        let { error: errDecision } = await supabase.from('ai_reply_decisions').insert({
            ...decisionPayload,
            eligibility_status: eligibility.eligible ? 'eligible' : 'blocked',
            eligibility_reason: eligibility.reason,
            cycle_status: salesCycle.cycle_eligibility,
            cycle_reason: salesCycle.cycle_reason,
            reply_quality_score: replyQuality.reply_quality_score,
            reply_quality_label: replyQuality.reply_quality_label,
            reply_quality_flags: replyQuality.reply_quality_flags,
            reply_style: composerResult.replyStyle,
            composer_used: composerResult.composerUsed
        });
        // Fallback cascade: if quality columns missing, try without them
        if (errDecision && errDecision.message?.includes('does not exist')) {
            console.warn('[Pipeline] Quality columns not in schema cache. Trying without quality...');
            const { error: e2 } = await supabase.from('ai_reply_decisions').insert({
                ...decisionPayload,
                eligibility_status: eligibility.eligible ? 'eligible' : 'blocked',
                eligibility_reason: eligibility.reason,
                cycle_status: salesCycle.cycle_eligibility,
                cycle_reason: salesCycle.cycle_reason
            });
            errDecision = e2;
        }
        // Fallback cascade: if eligibility columns also missing, save base only
        if (errDecision && errDecision.message?.includes('does not exist')) {
            console.warn('[Pipeline] Eligibility columns also missing. Saving base only.');
            const { error: e3 } = await supabase.from('ai_reply_decisions').insert(decisionPayload);
            errDecision = e3;
        }
        if (errDecision) console.error('[Pipeline] DB Error reply_decisions:', errDecision.message);

        // ── 11. Build Brain Tab schema ──
        const dynamicSchema = buildBrainSchema({
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
            mutationResult
        });

        const { error: err4 } = await supabase.from('ai_ui_schemas').insert({
            conversation_id,
            screen_type: 'brain_tab',
            layout_json: dynamicSchema
        });
        if (err4) console.error('[Pipeline] DB Error schemas:', err4.message);

        console.log(`[Pipeline] Done ${conversation_id}. Services: ${serviceData.selected_services.length}, Entity: ${entityMemory.entity_type}, Reply: ${replyStatus}, Eligibility: ${eligibility.reason}, Quality: ${replyQuality.reply_quality_label}(${replyQuality.reply_quality_score}), SvcDetection: ${serviceConfidence.service_detection_status}`);

    } catch (error) {
        console.error(`[Pipeline] Critical failure:`, error);
    }
}
