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
import { recordEvent, recordKbMiss } from '../analytics/recordAiEvent.mjs';
import { detectEventMutation } from '../events/detectEventMutation.mjs';
import { applyEventMutation } from '../events/applyEventMutation.mjs';
import { evaluateNextStep } from './evaluateNextStep.mjs';
import { evaluateAutonomy } from '../policy/evaluateAutonomy.mjs';
import { evaluateEscalation } from '../policy/evaluateEscalation.mjs';
import { evaluateFastPath } from './evaluateFastPath.mjs';
import { buildFastPathReply } from '../replies/buildFastPathReply.mjs';
import { shouldReplyNow, acquireConversationLock, releaseConversationLock } from '../policy/shouldReplyNow.mjs';
import { evaluateFollowUpEligibility } from '../policy/evaluateFollowUpEligibility.mjs';
import { scheduleFollowUp, clearFollowUp } from '../orchestration/scheduleFollowUp.mjs';

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

    // ── HARD ANTI-DUPLICATE: check messages table for recent outbound ──
    const recentCutoff = new Date(Date.now() - 120_000).toISOString(); // last 2 min
    const { data: recentOut } = await supabase
        .from('messages')
        .select('content, created_at')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .gt('created_at', recentCutoff)
        .order('created_at', { ascending: false })
        .limit(3);

    if (recentOut && recentOut.length > 0) {
        // Check if any recent outbound is same/similar text
        const normNew = text.toLowerCase().replace(/[^\w\sîăâșț]/g, '').trim();
        for (const msg of recentOut) {
            const normOld = (msg.content || '').toLowerCase().replace(/[^\w\sîăâșț]/g, '').trim();
            if (normNew === normOld || (normNew.length > 20 && normOld.includes(normNew.substring(0, 20)))) {
                console.log(`[AutoSend] BLOCKED DUPLICATE: same message sent ${Math.round((Date.now() - new Date(msg.created_at).getTime())/1000)}s ago`);
                return false;
            }
        }
        // Also block if >1 outbound in last 2 min (anti-spam)
        if (recentOut.length >= 2) {
            console.log(`[AutoSend] BLOCKED SPAM: ${recentOut.length} outbound messages in last 2 min`);
            return false;
        }
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
    const t_pipeline_start = Date.now();

    // ── 0. Conversation lock ──
    if (!acquireConversationLock(conversation_id)) {
        console.log(`[Pipeline] Skipped: conversation ${conversation_id} already locked by another pipeline run.`);
        return;
    }

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

        // ── 3.5. Fast Path Check ──
        // Skip entire LLM pipeline for simple greetings/discovery
        const { data: existingDraftForFP } = await supabase
            .from('ai_event_drafts')
            .select('id, services, draft_status')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        const { data: convStateForFP } = await supabase
            .from('ai_conversation_state')
            .select('current_stage')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        const fastPath = evaluateFastPath({
            messageText: lastClientMessageText,
            existingDraft: existingDraftForFP,
            conversationStage: convStateForFP?.current_stage || 'lead',
            messageCount: messages.length
        });

        if (fastPath.use_fast_path && !operator_prompt) {
            console.log(`[FastPath] Using fast path: type=${fastPath.fast_path_type}, reason=${fastPath.fast_path_reason}`);
            const fpReply = buildFastPathReply({
                fastPathType: fastPath.fast_path_type,
                detectedServices: fastPath.detected_services,
                nextStep: 'ask_event_date',
                entityMemory: existingMemory
            });

            // Should Reply check (replaces old spam guard)
            const replyDecision = await shouldReplyNow({
                conversationId: conversation_id,
                newReply: fpReply.reply,
                nextStep: fastPath.fast_path_type,
                lastClientMessage: lastClientMessageText
            });

            let fpReplyStatus = 'pending';
            let fpSentBy = 'pending';
            let fpSentAt = null;

            if (replyDecision.decision === 'reply_now') {
                const sent = await sendViaWhatsApp(conversation_id, fpReply.reply);
                if (sent) {
                    fpReplyStatus = 'sent';
                    fpSentBy = 'ai';
                    fpSentAt = new Date().toISOString();
                }
            } else {
                fpReplyStatus = 'blocked';
                fpSentBy = 'reply_engine';
                console.log(`[FastPath] Blocked by reply engine: ${replyDecision.decision} — ${replyDecision.reason}`);
            }

            // Minimal audit
            const { error: fpAuditErr } = await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: fpReply.reply,
                can_auto_reply: true,
                needs_human_review: false,
                confidence_score: 90,
                conversation_stage: convStateForFP?.current_stage || 'lead',
                reply_status: fpReplyStatus,
                sent_by: fpSentBy,
                sent_at: fpSentAt,
                next_step: fastPath.fast_path_type,
                progression_status: 'fast_path',
                autonomy_level: 'full',
                escalation_reason: replyDecision.decision !== 'reply_now' ? replyDecision.reason : null
            });
            if (fpAuditErr) console.warn('[FastPath] Audit insert error:', fpAuditErr.message);

            // Follow-up scheduling for fast path blocked decisions
            if (replyDecision.decision === 'reply_now') {
                await clearFollowUp(conversation_id, 'ai_replied_now_fastpath');
            } else if (['wait_for_more_messages', 'wait_for_missing_info'].includes(replyDecision.decision)) {
                const fpFollowUpElig = evaluateFollowUpEligibility({
                    replyDecision: replyDecision.decision,
                    lastClientMessage: lastClientMessageText,
                    conversationStage: convStateForFP?.current_stage || 'lead',
                    nextStep: fastPath.fast_path_type,
                    conversationStatus: convStateForFP?.current_stage,
                    closingSignalDetected: replyDecision.closingSignalDetected,
                    customerPausedDetected: replyDecision.customerPausedDetected,
                    humanTakeoverActive: replyDecision.humanTakeoverActive,
                    aiCommitmentPending: replyDecision.aiCommitmentPending
                });
                if (fpFollowUpElig.eligible) {
                    const schedResult = await scheduleFollowUp({
                        conversationId: conversation_id,
                        followUpReason: fpFollowUpElig.followUpType,
                        openQuestionDetected: fpFollowUpElig.openQuestionDetected,
                        customerIntentUnanswered: fpFollowUpElig.customerIntentUnanswered,
                        missingFields: fpFollowUpElig.missingFields,
                        triggerMessageId: message_id,
                        nextStep: fastPath.fast_path_type,
                        lastCustomerMessageAt: new Date().toISOString()
                    });
                    console.log(`[FastPath] Follow-up: ${schedResult.scheduled ? 'SCHEDULED' : 'NOT scheduled'} (${schedResult.reason})`);
                }
            }

            // Update conversation state
            await supabase.from('ai_conversation_state').upsert({
                conversation_id,
                current_stage: convStateForFP?.current_stage || 'lead',
                updated_at: new Date().toISOString(),
                ...(message_id ? { last_processed_message_id: message_id } : {})
            });

            const fpTotal = Date.now() - t_pipeline_start;
            console.log(`[Pipeline] FastPath done ${conversation_id}. Type: ${fastPath.fast_path_type}, Reply: ${fpReplyStatus}, Decision: ${replyDecision.decision}/${replyDecision.reason}, Timing: total=${fpTotal}ms`);
            return;
        }

        console.log(`[Pipeline] Full pipeline (no fast path: ${fastPath.fast_path_reason})`);

        // ── 3.6. Pre-LLM early exits ──
        const ACK_WORDS = ['ok','okay','bine','da','mhm','aha','in regula','am inteles','perfect','super','mersi','multumesc','ms','merci','k','sigur','desigur','da da','okk','okei'];
        const normalizedMsg = lastClientMessageText.toLowerCase().trim().replace(/[!?.]+$/g, '').trim();
        const isAck = normalizedMsg.length <= 25 && ACK_WORDS.some(p => normalizedMsg === p);

        if (isAck) {
            console.log(`[Pipeline] Early exit: ack "${normalizedMsg}" -> stay_silent`);
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: '[stay_silent - acknowledgment]',
                can_auto_reply: false, needs_human_review: false, confidence_score: 100,
                conversation_stage: convStateForFP?.current_stage || 'lead',
                reply_status: 'blocked', sent_by: 'reply_engine',
                next_step: 'stay_silent', progression_status: 'acknowledgment',
                escalation_reason: 'blocked_acknowledgment_only'
            });
            console.log(`[Pipeline] AckExit done ${conversation_id}. ${Date.now() - t_pipeline_start}ms`);
            return;
        }

        const ANGRY_KW = ['nu mai inteleg','de ce ati schimbat','sunt nemultumit','sunt suparat','vreau sa vorbesc cu cineva','e o bataie de joc','vreau reclamatie','anulati tot'];
        const lowerMsg = lastClientMessageText.toLowerCase();
        const isAngry = ANGRY_KW.some(p => lowerMsg.includes(p));

        if (isAngry) {
            console.log(`[Pipeline] Early exit: angry/confused -> escalate`);
            await clearFollowUp(conversation_id, 'escalated_pre_llm');
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: '[escalated - client sentiment]',
                can_auto_reply: false, needs_human_review: true, confidence_score: 0,
                conversation_stage: convStateForFP?.current_stage || 'lead',
                reply_status: 'blocked', sent_by: 'reply_engine',
                next_step: 'escalate', progression_status: 'escalated',
                escalation_reason: 'escalated_client_sentiment'
            });
            console.log(`[Pipeline] EscalateExit done ${conversation_id}. ${Date.now() - t_pipeline_start}ms`);
            return;
        }

        // Pre-LLM closing signal check
        const { detectClosingSignal: detectClose } = await import('../policy/shouldReplyNow.mjs');
        const closingCheck = detectClose(lastClientMessageText);
        if (closingCheck.detected && !closingCheck.hasOpenQuestion && !closingCheck.hasActiveIntent) {
            console.log(`[Pipeline] Early exit: closing signal -> stay_silent`);
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: '[stay_silent - closing signal]',
                can_auto_reply: false, needs_human_review: false, confidence_score: 100,
                conversation_stage: convStateForFP?.current_stage || 'lead',
                reply_status: 'blocked', sent_by: 'reply_engine',
                next_step: 'stay_silent', progression_status: 'closing_signal',
                escalation_reason: 'blocked_closing_signal'
            });
            console.log(`[Pipeline] ClosingExit done ${conversation_id}. ${Date.now() - t_pipeline_start}ms`);
            return;
        }

        // Pre-LLM customer paused check
        const PAUSE_RE = /^(revin eu|revin|ma mai gandesc|mă mai gândesc|ok.*revin|bine.*revin|te anunt eu|te anunț eu|lasa ca revin|lasă că revin|mai vorbim|va anunt|vă anunț)$/i;
        const pauseNorm = lastClientMessageText.toLowerCase().trim().replace(/[!?.]+$/g, '').trim();
        if (pauseNorm.length <= 35 && PAUSE_RE.test(pauseNorm)) {
            console.log(`[Pipeline] Early exit: customer paused -> stay_silent`);
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: '[stay_silent - customer paused]',
                can_auto_reply: false, needs_human_review: false, confidence_score: 100,
                conversation_stage: convStateForFP?.current_stage || 'lead',
                reply_status: 'blocked', sent_by: 'reply_engine',
                next_step: 'stay_silent', progression_status: 'customer_paused',
                escalation_reason: 'blocked_customer_paused'
            });
            console.log(`[Pipeline] PausedExit done ${conversation_id}. ${Date.now() - t_pipeline_start}ms`);
            return;
        }

        // ── 3.7. (KB lookup moved AFTER guards — see step 7.1) ──

        let userMessage = `--- CONVERSATIE ---\n${transcript}`;
        if (operator_prompt) {
            userMessage += `\n\n--- INSTRUCTIUNE OPERATOR ---\n${operator_prompt}\nAplicam instructiunea de mai sus la generarea raspunsului sugerat.`;
        }

        const systemPrompt = buildSystemPrompt(existingMemory);

        console.log(`[Pipeline] Calling LLM with ${transcript.length} chars${operator_prompt ? ' + operator prompt' : ''}...`);
        const t_llm_start = Date.now();
        let analysis = await callLocalLLM(systemPrompt, userMessage);
        const t_llm_ms = Date.now() - t_llm_start;
        console.log(`[Pipeline] LLM analysis completed in ${t_llm_ms}ms`);

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
        
        // Defensive: ensure confidence_score is always a valid number.
        // The LLM sometimes omits it despite returning can_auto_reply=true.
        // If can_auto_reply is true but confidence is missing, default to 80.
        if (decision.confidence_score === undefined || decision.confidence_score === null) {
            decision.confidence_score = decision.can_auto_reply ? 80 : 0;
            console.log(`[Pipeline] Confidence score missing from LLM, defaulting to ${decision.confidence_score} (can_auto_reply=${decision.can_auto_reply})`);
        }
        decision.confidence_score = Number(decision.confidence_score) || 0;

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

        // ── 7.1. KB Lookup — AFTER all guards, service-aware ──
        // Try ALL recent unprocessed client messages (not just last) for KB match
        // This handles debounced multi-message scenarios
        const { searchKnowledgeBase, getLearningContext } = await import('../knowledge/knowledgeBase.mjs');
        const recentClientMsgs = [...messages].reverse()
            .filter(m => m.sender_type === 'client')
            .slice(0, 5) // max 5 recent client messages
            .map(m => m.content || '');

        let kbMatch = null;
        let kbMatchedMessage = lastClientMessageText; // which message triggered the match
        for (const msgText of recentClientMsgs) {
            const candidate = await searchKnowledgeBase(msgText, {
                detectedServices: serviceData.selected_services,
                conversationStage: dbStage || decision.conversation_stage
            });
            if (candidate && (!kbMatch || candidate.score > kbMatch.score)) {
                kbMatch = candidate;
                kbMatchedMessage = msgText;
            }
        }

        if (kbMatch) {
            console.log(`[Pipeline] KB: key=${kbMatch.knowledgeKey}, score=${kbMatch.score.toFixed(2)}, mode=${kbMatch.mode}, matchedMsg="${kbMatchedMessage.substring(0, 50)}"`);
            recordEvent('kb_match_found', conversation_id, {
                knowledgeKey: kbMatch.knowledgeKey, score: kbMatch.score,
                mode: kbMatch.mode, category: kbMatch.category,
                matchedMessage: kbMatchedMessage.substring(0, 100)
            });
        } else {
            console.log('[Pipeline] KB: no match found');
            recordEvent('kb_match_not_found', conversation_id, {
                message: lastClientMessageText.substring(0, 100),
                detectedServices: serviceData.selected_services
            });
            recordKbMiss(conversation_id, lastClientMessageText, 0, serviceData.selected_services);
        }

        // ── 7.2. KB Direct Answer Path ──
        // Truthfulness: sensitive categories (pricing/packages/policy) → force direct
        const { resolveGroundingMode, validateGroundedReply, buildGroundingPayload } = await import('../knowledge/groundedValidator.mjs');
        let effectiveKbMode = kbMatch ? resolveGroundingMode(kbMatch) : null;

        // If strong KB match → send KB answer directly, skip LLM
        // KB direct answer bypasses legacy eligibility blocks (safe: KB data is approved factual)
        const kbBypassEligibility = kbMatch && effectiveKbMode === 'kb_direct_answer' && kbMatch.score >= 0.75
            && ['cycle_review_on_legacy', 'blocked_manual_legacy', 'cycle_review_on_draft', 'cycle_review_on_blocked_stage'].includes(eligibility.reason);
        if (kbBypassEligibility) {
            console.log(`[Pipeline] KB direct answer bypassing eligibility block: ${eligibility.reason} (KB score=${kbMatch.score.toFixed(2)})`);
        }

        if (kbMatch && effectiveKbMode === 'kb_direct_answer' && (eligibility.eligible || kbBypassEligibility)) {
            // Package presenter — detect intent + format reply (summary/detail/compare/pricing)
            const { detectPackageIntent, formatPackageReply, hasStructuredPackages } = await import('../knowledge/packagePresenter.mjs');
            let kbReply;

            if (hasStructuredPackages(kbMatch)) {
                const intent = detectPackageIntent(lastClientMessageText);
                kbReply = formatPackageReply(kbMatch, intent, conversation_id);
                console.log(`[Pipeline] Package presenter: mode=${intent.mode}, feature=${intent.feature}, price=${intent.priceFilter}`);
            } else {
                kbReply = kbMatch.answer;
            }

            // Run shouldReplyNow — respects ALL guards
            const kbReplyDecision = await shouldReplyNow({
                conversationId: conversation_id,
                newReply: kbReply,
                nextStep: 'kb_direct_answer',
                lastClientMessage: lastClientMessageText
            });

            let kbStatus = 'pending';
            let kbSentBy = 'reply_engine';
            let kbSentAt = null;

            if (kbReplyDecision.decision === 'reply_now') {
                const sent = await sendViaWhatsApp(conversation_id, kbReply);
                if (sent) {
                    kbStatus = 'sent';
                    kbSentBy = 'ai';
                    kbSentAt = new Date().toISOString();
                }
                await clearFollowUp(conversation_id, 'kb_replied');
            } else {
                kbStatus = 'blocked';
                console.log(`[Pipeline] KB direct blocked: ${kbReplyDecision.decision} — ${kbReplyDecision.reason}`);
            }

            // Audit
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: kbReply,
                can_auto_reply: true,
                needs_human_review: false,
                confidence_score: Math.round(kbMatch.score * 100),
                conversation_stage: dbStage || decision.conversation_stage,
                reply_status: kbStatus,
                sent_by: kbSentBy,
                sent_at: kbSentAt,
                next_step: 'kb_direct_answer',
                progression_status: 'kb_direct_answer',
                autonomy_level: 'full',
                eligibility_status: eligibility.eligible ? 'eligible' : 'blocked',
                eligibility_reason: eligibility.reason,
                escalation_reason: kbStatus === 'sent' ? null : `kb_blocked_${kbReplyDecision.decision}`
            });

            // Update conversation state
            await supabase.from('ai_conversation_state').upsert({
                conversation_id,
                current_stage: dbStage || decision.conversation_stage,
                next_best_action: 'kb_direct_answer',
                updated_at: new Date().toISOString(),
                ...(message_id ? { last_processed_message_id: message_id } : {})
            });

            console.log(`[Pipeline] KB DIRECT done ${conversation_id}. Key: ${kbMatch.knowledgeKey}, Score: ${kbMatch.score.toFixed(2)}, Reply: ${kbStatus}. ${Date.now() - t_pipeline_start}ms`);
            recordEvent('kb_direct_answer_used', conversation_id, {
                knowledgeKey: kbMatch.knowledgeKey, score: kbMatch.score, status: kbStatus
            });
            return;
        }

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

        // ── 8.5.1. KB Grounded Composer context ──
        // If KB matched in grounded mode, inject structured grounding payload
        let kbGroundingContext = null;
        let hybridPackageReply = null; // Set when hybrid package composer is used

        if (kbMatch && (effectiveKbMode === 'kb_grounded_composer' || effectiveKbMode === 'kb_strict_grounded')) {
            kbGroundingContext = buildGroundingPayload(kbMatch);

            // For packages or pricing/duration queries: use dedicated hybrid composer
            const isPricingDuration = kbMatch.category === 'pricing' && /\d+\s*ore/i.test(kbMatchedMessage);
            if ((kbMatch.category === 'packages' || isPricingDuration) && kbMatch.score >= 0.75) {
                const { detectPackageIntent, formatPackageReply, hasStructuredPackages, composeContextualPackageReply } = await import('../knowledge/packagePresenter.mjs');

                // For pricing queries, we need to load the packages KB entry
                let packageKbMatch = kbMatch;
                if (isPricingDuration) {
                    const { matchKnowledge } = await import('../knowledge/knowledgeMatcher.mjs');
                    const pkgMatch = await matchKnowledge('Ce pachete de animatie aveti?', { detectedServices: serviceData.selected_services || ['animator'] });
                    if (pkgMatch && pkgMatch.knowledgeKey === 'animator_packages') {
                        packageKbMatch = pkgMatch;
                    }
                }

                if (hasStructuredPackages(packageKbMatch)) {
                    const intent = detectPackageIntent(kbMatchedMessage);
                    const formattedPkgs = formatPackageReply(packageKbMatch, intent, conversation_id);
                    kbGroundingContext.formattedPackages = formattedPkgs;
                    console.log(`[Pipeline] Package presenter: mode=${intent.mode}${intent.hours ? ', hours=' + intent.hours : ''}, formatted ${formattedPkgs.length} chars`);

                    // Hybrid compose: LLM writes intro/outro, template provides prices
                    hybridPackageReply = await composeContextualPackageReply(formattedPkgs, userMessage, conversation_id);
                    console.log(`[Pipeline] Hybrid package reply: ${hybridPackageReply.length} chars`);
                }
            }

            console.log(`[Pipeline] KB grounding injected: key=${kbMatch.knowledgeKey}, mode=${effectiveKbMode}, sensitive=${kbGroundingContext.sensitive}`);
        }

        // ── 8.5.2. Learned corrections as supplementary LLM context ──
        let learnedContext = [];
        if (!kbMatch) {
            learnedContext = await getLearningContext(lastClientMessageText, {
                serviceTags: serviceData.selected_services
            });
            if (learnedContext.length > 0) {
                console.log(`[Pipeline] Learned context: ${learnedContext.length} corrections available`);
            }
        }

        // ── 8.6. Conversation Progression Engine ──
        const replyContext = buildReplyContext({ analysis, entityMemory, serviceConfidence });
        const progression = evaluateNextStep({
            replyContext,
            draft: existingDraftRow,
            mutation,
            mutationResult,
            decision,
            analysis,
            serviceConfidence
        });
        console.log(`[Pipeline] Progression: next_step=${progression.next_step}, status=${progression.progression_status}, missing=${progression.missing_critical_count}, autonomous=${progression.can_continue_autonomously}`);

        // ── 8.7. Autonomy Policy ──
        const autonomy = evaluateAutonomy({
            action: progression.next_step,
            decision,
            mutation,
            progression,
            serviceConfidence,
            conversationStage: dbStage || decision.conversation_stage
        });
        console.log(`[Pipeline] Autonomy: level=${autonomy.autonomy_level}, allowed=${autonomy.action_autonomy_allowed}, action=${autonomy.effective_action}`);

        // ── 8.8. Escalation Engine ──
        const escalation = evaluateEscalation({
            decision,
            mutation,
            autonomy,
            progression,
            serviceConfidence,
            analysis,
            conversationStage: dbStage || decision.conversation_stage,
            lastClientMessage: lastClientMessageText
        });
        if (escalation.needs_escalation) {
            console.log(`[Pipeline] Escalation: type=${escalation.escalation_type}, reason=${escalation.escalation_reason}`);
        }

        // ── 8.9. Compose humanized reply (with progression + KB grounding context) ──
        let composerResult = { reply: suggestedReply, replyStyle: 'warm_sales', composerUsed: false, serviceDetectionStatus: 'unknown' };
        let t_composer_ms = 0;

        // Hybrid package composer bypass — prices from KB template, context from LLM
        if (hybridPackageReply) {
            suggestedReply = hybridPackageReply;
            composerResult = { reply: hybridPackageReply, replyStyle: 'warm_sales', composerUsed: true, specificity: 'kb_packages', serviceDetectionStatus: 'confirmed' };
            console.log(`[Pipeline] Using hybrid package reply (${hybridPackageReply.length} chars), skipping general composer`);
        } else if (eligibility.eligible || !decision.needs_human_review) {
            const t_comp_start = Date.now();

            // If KB grounded mode, use KB answer as base truth
            if (kbGroundingContext) {
                composerResult = await composeHumanReply({
                    analysis,
                    entityMemory,
                    salesCycle,
                    conversationStage: dbStage || decision.conversation_stage,
                    conversationText: userMessage,
                    serviceConfidence,
                    progression,
                    kbGrounding: kbGroundingContext
                });
                console.log(`[Pipeline] Composer used KB grounding: key=${kbGroundingContext.knowledgeKey}`);
            } else {
                composerResult = await composeHumanReply({
                    analysis,
                    entityMemory,
                    salesCycle,
                    conversationStage: dbStage || decision.conversation_stage,
                    conversationText: userMessage,
                    serviceConfidence,
                    progression,
                    learnedContext
                });
            }

            suggestedReply = composerResult.reply;
            t_composer_ms = Date.now() - t_comp_start;
            console.log(`[Pipeline] Composer completed in ${t_composer_ms}ms`);

            // KB template fallback: if composer produced bad/empty reply but we have KB data, use formatted template
            const BAD_REPLIES = ['nu am putut genera un raspuns', 'nu am putut genera'];
            if (kbGroundingContext && BAD_REPLIES.some(b => suggestedReply.toLowerCase().includes(b))) {
                const kbFallback = kbGroundingContext.formattedPackages || kbGroundingContext.factualAnswer;
                if (kbFallback && kbFallback.length > 20) {
                    suggestedReply = kbFallback;
                    console.log(`[Pipeline] Composer failed → KB template fallback used (${kbFallback.length} chars)`);
                }
            }

            // ── 8.9.1. Truthfulness validation for grounded composer ──
            if (kbGroundingContext && kbGroundingContext.sensitive) {
                const validation = validateGroundedReply(
                    suggestedReply,
                    kbGroundingContext.factualAnswer,
                    kbGroundingContext.category
                );
                if (!validation.valid) {
                    console.log(`[Pipeline] Grounded validation FAILED: ${validation.failReason}. Falling back to kb_direct_answer.`);
                    suggestedReply = kbMatch.answer; // fallback to safe KB answer
                    recordEvent('grounded_validation_failed', conversation_id, {
                        knowledgeKey: kbGroundingContext.knowledgeKey,
                        failReason: validation.failReason,
                        originalComposed: composerResult.reply?.substring(0, 100)
                    });
                } else {
                    recordEvent('kb_grounded_composer_used', conversation_id, {
                        knowledgeKey: kbGroundingContext.knowledgeKey,
                        score: kbMatch?.score, confidence: validation.confidence
                    });
                }
            } else if (kbGroundingContext) {
                recordEvent('kb_grounded_composer_used', conversation_id, {
                    knowledgeKey: kbGroundingContext.knowledgeKey, score: kbMatch?.score
                });
            } else {
                recordEvent('llm_fallback_used', conversation_id, {
                    message: lastClientMessageText.substring(0, 80),
                    hasLearnedContext: learnedContext.length > 0
                });
            }
        }

        // ── 8.10. Evaluate reply quality ──
        const replyQuality = evaluateReplyQuality({
            reply: suggestedReply,
            analysis,
            replyContext,
            entityMemory,
            replyStyle: composerResult.replyStyle,
            composerUsed: composerResult.composerUsed
        });

        // ── 9. Auto-send logic (via shouldReplyNow engine) ──
        let replyStatus = 'pending';
        let sentBy = 'pending';
        let sentAt = null;
        let replyDecisionResult = { decision: 'blocked_autoreply_off', reason: 'not_checked' };

        // KB score-based bypass for composer path (same logic as KB direct answer bypass)
        const kbComposerBypass = kbMatch && kbMatch.score >= 0.75 && kbGroundingContext && !eligibility.eligible
            && ['blocked_by_decision', 'blocked_low_confidence', 'cycle_review_on_legacy', 'blocked_manual_legacy'].includes(eligibility.reason);
        if (kbComposerBypass) {
            console.log(`[Pipeline] KB grounded composer bypassing eligibility: ${eligibility.reason} (KB score=${kbMatch.score.toFixed(2)})`);
        }

        if (eligibility.eligible || kbComposerBypass) {
            // When KB bypass is active, override LLM's low confidence/escalation
            // KB data is factual and approved — no need for human review
            const effectiveEscalation = kbComposerBypass ? null : escalation;
            const effectiveDecision = kbComposerBypass
                ? { ...decision, confidence_score: Math.max(decision.confidence_score, 75), needs_human_review: false }
                : decision;

            // Central should-reply decision (full context)
            replyDecisionResult = await shouldReplyNow({
                conversationId: conversation_id,
                newReply: suggestedReply,
                nextStep: progression.next_step,
                mutation,
                lastClientMessage: lastClientMessageText,
                escalation: effectiveEscalation,
                decision: effectiveDecision,
                serviceConfidence
            });

            if (replyDecisionResult.decision === 'reply_now') {
                // Anti-duplicate guard: check if we already sent recently (prevents catchup + webhook double-send)
                const { data: recentOutbound } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('conversation_id', conversation_id)
                    .eq('direction', 'outbound')
                    .gt('created_at', new Date(Date.now() - 3 * 60 * 1000).toISOString()) // last 3 min
                    .limit(1);
                if (recentOutbound && recentOutbound.length > 0) {
                    console.log(`[Pipeline] Anti-duplicate: outbound msg found in last 3min, skipping send`);
                    replyStatus = 'blocked';
                    sentBy = 'anti_duplicate';
                    replyDecisionResult = { decision: 'blocked_duplicate', reason: 'recent_outbound_exists' };
                } else {
                console.log(`[Pipeline] Auto-reply ALLOWED (confidence=${decision.confidence_score}, style=${composerResult.replyStyle}, reason=${replyDecisionResult.reason}). Sending...`);
                const sent = await sendViaWhatsApp(conversation_id, suggestedReply);
                if (sent) {
                    replyStatus = 'sent';
                    sentBy = 'ai';
                    sentAt = new Date().toISOString();
                }
                // Clear any pending follow-up since we just replied
                await clearFollowUp(conversation_id, 'ai_replied_now');
                recordEvent('decision_reply_now', conversation_id, {
                    confidence: decision.confidence_score, style: composerResult.replyStyle
                });
                } // end anti-duplicate else
            } else {
                replyStatus = 'blocked';
                sentBy = 'reply_engine';
                console.log(`[Pipeline] Auto-reply BLOCKED: ${replyDecisionResult.decision} — ${replyDecisionResult.reason} (${replyDecisionResult.details || ''})`);

                // Evaluate follow-up eligibility for wait decisions
                const followUpElig = evaluateFollowUpEligibility({
                    replyDecision: replyDecisionResult.decision,
                    lastClientMessage: lastClientMessageText,
                    conversationStage: decision.conversation_stage,
                    existingDraft: existingDraftRow,
                    nextStep: progression.next_step,
                    conversationStatus: dbStage,
                    closingSignalDetected: replyDecisionResult.closingSignalDetected,
                    customerPausedDetected: replyDecisionResult.customerPausedDetected,
                    humanTakeoverActive: replyDecisionResult.humanTakeoverActive,
                    aiCommitmentPending: replyDecisionResult.aiCommitmentPending
                });

                if (followUpElig.eligible) {
                    const schedResult = await scheduleFollowUp({
                        conversationId: conversation_id,
                        followUpReason: followUpElig.followUpType,
                        openQuestionDetected: followUpElig.openQuestionDetected,
                        customerIntentUnanswered: followUpElig.customerIntentUnanswered,
                        missingFields: followUpElig.missingFields,
                        triggerMessageId: message_id,
                        nextStep: progression.next_step,
                        lastCustomerMessageAt: new Date().toISOString()
                    });
                    console.log(`[Pipeline] Follow-up: ${schedResult.scheduled ? 'SCHEDULED' : 'NOT scheduled'} (${schedResult.reason})`);
                }
            }
        } else if (decision.escalation_reason) {
            console.log(`[Pipeline] Escalation: ${decision.escalation_reason}`);
            await clearFollowUp(conversation_id, 'escalated');
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
            composer_used: composerResult.composerUsed,
            next_step: progression.next_step,
            progression_status: progression.progression_status,
            autonomy_level: autonomy.autonomy_level,
            escalation_type: escalation.escalation_type,
            escalation_reason: escalation.needs_escalation ? escalation.escalation_reason : null
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
            mutationResult,
            progression,
            autonomy,
            escalation
        });

        const { error: err4 } = await supabase.from('ai_ui_schemas').insert({
            conversation_id,
            screen_type: 'brain_tab',
            layout_json: dynamicSchema
        });
        if (err4) console.error('[Pipeline] DB Error schemas:', err4.message);

        const t_total_ms = Date.now() - t_pipeline_start;
        console.log(`[Pipeline] Done ${conversation_id}. Services: ${serviceData.selected_services.length}, Entity: ${entityMemory.entity_type}, Reply: ${replyStatus}, Eligibility: ${eligibility.reason}, Quality: ${replyQuality.reply_quality_label}(${replyQuality.reply_quality_score}), SvcDetection: ${serviceConfidence.service_detection_status}, Timing: analysis=${t_llm_ms}ms composer=${t_composer_ms}ms total=${t_total_ms}ms`);

    } catch (error) {
        console.error(`[Pipeline] Critical failure:`, error);
    } finally {
        releaseConversationLock(conversation_id);
    }
}
