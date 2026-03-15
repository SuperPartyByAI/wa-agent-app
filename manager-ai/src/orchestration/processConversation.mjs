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
import { extractActiveRoles } from '../knowledge/knowledgeBase.mjs';
import { buildActiveCommercialPoliciesBlock } from '../policy/buildActiveCommercialPoliciesBlock.mjs';
import { loadRelationshipData } from '../memory/loadRelationshipData.mjs';
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
import { loadGoalState, transitionGoalState } from '../workflow/goalStateMachine.mjs';
import { evaluateGoalTransition } from '../workflow/goalTransitions.mjs';
import { evaluateNextBestAction } from '../workflow/evaluateNextBestAction.mjs';
import { loadOrCreateEventPlan } from '../events/eventPlanAssembler.mjs';
import { evaluateEventPlan } from '../events/eventPlanEvaluator.mjs';
import { executeAiAction } from '../actions/actionExecutor.mjs';
import { loadLatestQuote } from '../quotes/buildQuoteDraft.mjs';
import { formatQuoteForBrainTab } from '../quotes/quoteFormatter.mjs';
import { loadRuntimeContext } from '../grounding/loadRuntimeContext.mjs';
import { evaluateSafetyClass } from '../policy/evaluateSafetyClass.mjs';
import { shouldIncludeInWave1, isWave1Eligible } from '../rollout/wave1Controller.mjs';
import { evaluateRollback } from '../rollout/rollbackEvaluator.mjs';
import { detectMemoryConflicts } from '../rollout/memoryConflictDetector.mjs';
import { isWave2Eligible } from '../rollout/wave2Eligibility.mjs';
import { verifyPostWrite } from '../rollout/postWriteVerifier.mjs';
import {
    AI_SHADOW_MODE_ENABLED, AI_SAFE_AUTOREPLY_ENABLED, AI_FULL_AUTOREPLY_ENABLED
} from '../config/env.mjs';
import { AI_WAVE2_ENABLED } from '../config/env.mjs';

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
    const recentCutoff = new Date(Date.now() - 20_000).toISOString(); // last 20 sec
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
    console.log(`[Pipeline] Attempting to acquire lock for ${conversation_id}...`);
    if (!acquireConversationLock(conversation_id)) {
        console.log(`[Pipeline] Skipped: conversation ${conversation_id} already locked by another pipeline run.`);
        return;
    }
    console.log(`[Pipeline] Lock acquired for ${conversation_id}.`);

    try {
        // ── 0. Load Runtime Context Pack (Hybrid Grounding) ──
        const { contextPack, drift } = await loadRuntimeContext();
        if (drift.hasDrift) {
            console.warn(`[Pipeline] ⚠️  Context drift detected: ${drift.details.join('; ')}`);
        }

        // ── 1. Load conversation context ──
        const { data: convData } = await supabase
            .from('conversations')
            .select('client_id, created_at')
            .eq('id', conversation_id)
            .single();

        const clientId = convData?.client_id;
        const conversationCreatedAt = convData?.created_at;

        // Fetch messages
        console.log(`[Pipeline] Fetching messages for ${conversation_id}...`);
        const { data: messages, error: msgErr } = await supabase
            .from('messages')
            .select('content, direction, created_at, sender_type')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (msgErr) {
            console.error(`[Pipeline] Failed to fetch messages`, msgErr);
            throw new Error(`Failed to fetch messages: ${msgErr.message}`);
        }
        if (!messages || messages.length === 0) {
            console.log(`[Pipeline] ABORT: No messages found for ${conversation_id}.`);
            return;
        }
        console.log(`[Pipeline] Found ${messages.length} messages.`);

        // ── 2. Load entity memory ──
        const existingMemory = await loadClientMemory(clientId);
        console.log(`[Pipeline] Entity memory: type=${existingMemory.entity_type}, locations=${existingMemory.usual_locations.length}, services=${existingMemory.usual_services.length}`);

        // ── 2.0.1. Load Relationship Data ──
        const relationshipData = await loadRelationshipData(clientId);

        // ── 2.1. Load Goal State + Event Plan ──
        const goalState = await loadGoalState(conversation_id);
        const eventPlan = await loadOrCreateEventPlan(conversation_id, clientId);
        let latestQuote = await loadLatestQuote(eventPlan?.id);
        console.log(`[Pipeline] Goal: ${goalState.current_state}, EventPlan: ${eventPlan?.id || 'new'} (status=${eventPlan?.status}), Quote: ${latestQuote ? 'v' + latestQuote.version_no + '/' + latestQuote.status : 'none'}`);

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
        // CLONE the array using [...messages] because .reverse() mutates the array in-place!
        // If we mutate it, the later .find() logic will extract the oldest message instead of the newest.
        const transcript = [...messages].reverse().map(m =>
            `[${new Date(m.created_at).toISOString()}] ${m.sender_type === 'agent' ? 'Superparty (Noi)' : 'Client'}: ${m.content}`
        ).join('\n');

        // Extract last client message for service confidence guard
        const lastClientMsg = messages.find(m => m.sender_type === 'client');
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

        // ── AUTONOMOUS COMMERCIAL AGENT: Phase 1 Runtime ──
        const { loadLeadRuntimeState } = await import('../agent/loadLeadRuntimeState.mjs');
        const { saveLeadRuntimeState } = await import('../agent/saveLeadRuntimeState.mjs');
        const { computeMissingFields } = await import('../agent/missingFieldsEngine.mjs');
        const { computeNextBestAction } = await import('../agent/nextBestActionPlanner.mjs');

        // ── AUTONOMOUS COMMERCIAL AGENT: Phase 3 Party Builder ──
        const { loadPartyDraft } = await import('../party/loadPartyDraft.mjs');
        const { savePartyDraft } = await import('../party/savePartyDraft.mjs');
        const { updatePartyDraftFromMessage } = await import('../party/updatePartyDraftFromMessage.mjs');
        const { computeMissingPartyFields } = await import('../party/partyMissingFieldsEngine.mjs');

        const runtimeState = await loadLeadRuntimeState(conversation_id);
        let partyDraft = await loadPartyDraft(conversation_id, clientId);

        const activeRoles = await extractActiveRoles(lastClientMessageText, eventPlan);
        const activeRolesText = activeRoles && activeRoles.length > 0 ? buildActiveCommercialPoliciesBlock(activeRoles) : null;
        const activeRoleKeys = activeRoles ? activeRoles.map(r => r.role_id) : [];
        
        if (!runtimeState.primary_service && eventPlan?.selected_package) {
            runtimeState.primary_service = eventPlan.selected_package;
        }
        if (activeRoles && activeRoles.length > 0) {
            const newSvc = activeRoles[0].service_key;
            if (!runtimeState.primary_service || runtimeState.primary_service !== newSvc) {
                runtimeState.primary_service = newSvc;
            }
            runtimeState.active_roles = activeRoles.map(r => r.role_id);
        }

        // Fix: Replace V1 legacy missingFieldsEngine with V2 partyMissingFieldsEngine
        let rolesToEvaluate = activeRoleKeys;
        if (rolesToEvaluate.length === 0 && runtimeState.primary_service) {
            // Fallback mapper for primary_service string -> role array
            rolesToEvaluate = [`role_${runtimeState.primary_service}`];
        }
        
        const missingMetrics = computeMissingPartyFields(partyDraft, rolesToEvaluate);

        const plannerContext = {
            runtimeState,
            missingMetrics,
            humanTakeover: false, // TODO: Wire human takeover logic dynamically
            isAcknowledgment: isAck,
            isGreeting: lastClientMessageText && /^(bun[aă]|salut|hey|hello|hi|bun[aă]\s*(seara|ziua|dimineata|dimineața)|sal|hei|ce\s*faci|servus)\s*[!.,?]*$/i.test(lastClientMessageText.trim()),
            clientMessageText: lastClientMessageText
        };
        const nextTarget = computeNextBestAction(plannerContext);
        
        // ── AUTONOMOUS COMMERCIAL AGENT: Phase 2 Intelligence ──
        const { deriveGoalFromState } = await import('../agent/goalEngine.mjs');
        const { calculateLeadScore } = await import('../agent/leadScoring.mjs');
        
        const goalDirective = deriveGoalFromState(runtimeState.lead_state);
        const scoring = calculateLeadScore({ runtimeState, missingMetrics, relationshipData, hasActiveBooking: relationshipData?.hasActiveBooking });
        
        runtimeState.lead_score = scoring.score; // Store in state for later persistence
        
        console.log(`[Agent] State=${runtimeState.lead_state}, Score=${scoring.score}(${scoring.temperature}), Primary=${runtimeState.primary_service}, NBA=${nextTarget.action}, NextState=${nextTarget.nextState}`);

        const systemPrompt = buildSystemPrompt(existingMemory, { eventPlan, partyDraft, goalState, contextPack, relationshipData, activeRolesText, nextBestActionGoal: nextTarget, goalDirective });

        console.log(`[Pipeline] Calling LLM with ${transcript.length} chars${operator_prompt ? ' + operator prompt' : ''}...`);
        const t_llm_start = Date.now();
        let analysis = await callLocalLLM(systemPrompt, userMessage);
        const t_llm_ms = Date.now() - t_llm_start;
        console.log(`[Pipeline] LLM analysis completed in ${t_llm_ms}ms`);

        if (!analysis) {
            console.warn(`[Pipeline] LLM unreachable or returned invalid JSON for conv ${conversation_id}. Aborting.`);
            releaseConversationLock(conversation_id);
            return;
        }

        // ── 5. Post-process & Legacy Subsystem Cleanup ──
        // The LLM now strictly returns { assistant_reply, tool_action }.
        // The properties below are legacy fallback stubs kept temporarily to satisfy
        // the remaining orchestration pipeline without triggering large rewrites.
        const serviceData = postProcessServices(analysis);
        serviceData.service_requirements = analysis.service_requirements || [];

        const decision = analysis.decision || {
            can_auto_reply: true,   // Trust the tool_action pathway
            needs_human_review: false,
            escalation_reason: null,
            confidence_score: 85,
            conversation_stage: 'discovery'
        };

        let suggestedReply = analysis.assistant_reply || analysis.suggested_reply || 'Nu am putut genera un raspuns.';
        let toolAction = analysis.tool_action || { name: 'reply_only', arguments: { reason: 'No tool action provided' } };
        
        // ── AUTONOMOUS COMMERCIAL AGENT: Phase 2 Self-Check ──
        const { runSelfCheckAudit, AUDIT_RESULTS } = await import('../agent/replySelfCheck.mjs');
        const audit = runSelfCheckAudit(suggestedReply, { eventPlan, missingMetrics });
        
        if (!audit.passed) {
            console.warn(`[Agent] Self-check FAILED: ${audit.reason}. Rewriting reply to safe fallback.`);
            decision.can_auto_reply = false;
            decision.needs_human_review = true;
            decision.escalation_reason = `self_check_failed_${audit.reason}`;
            
            if (audit.reason === AUDIT_RESULTS.BLOCK_PREMATURE_CONFIRMATION) {
                suggestedReply = 'Confirmarea oficială urmează să fie realizată de un coleg din echipă imediat ce avem toate detaliile.';
            } else if (audit.reason === AUDIT_RESULTS.BLOCK_UNAUTHORIZED_DISCOUNT) {
                 suggestedReply = 'Vom verifica detaliile ofertei și un coleg vă va confirma varianta finală de preț.';
            } else if (audit.reason === AUDIT_RESULTS.BLOCK_HALLUCINATED_PRICE) {
                 suggestedReply = 'Pentru a structura un preț corect și final, mai avem nevoie de câteva detalii logistice. Revin imediat cu informația clară.';
            } else {
                 suggestedReply = '[Mesaj recalculat pentru revizie umană]';
            }
            
            toolAction = { name: 'reply_only', arguments: { reason: 'self_check_fallback' } };
        }
        
        // Legacy stubs
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

        // KB direct answer bypasses ALL eligibility blocks when score ≥ 0.75
        // Safe: KB data is approved factual content (prices, packages, etc.)
        const kbBypassEligibility = kbMatch && effectiveKbMode === 'kb_direct_answer' && kbMatch.score >= 0.75
            && !eligibility.eligible;
        if (kbBypassEligibility) {
            console.log(`[Pipeline] KB direct answer bypassing eligibility block: ${eligibility.reason} (KB score=${kbMatch.score.toFixed(2)})`);
        }
        // Greeting guard: if client just said "Bună seara" don't dump packages
        // Let the normal composer reply with "Cu ce vă pot ajuta?" first
        const GREETING_ONLY = /^(bun[aă]|salut|hey|hello|hi|bun[aă]\s*(seara|ziua|dimineata|dimineața)|sal|hei|ce\s*faci|servus)\s*[!.,?]*$/i;
        const isGreeting = lastClientMessageText && GREETING_ONLY.test(lastClientMessageText.trim());
        
        // Faza 4 Business Playbook Bypass: Never hijack with a KB direct answer if the Playbook has a specific strategy
        const isPlaybookAction = !!nextTarget?.playbookKey;

        if (kbMatch && effectiveKbMode === 'kb_direct_answer' && (eligibility.eligible || kbBypassEligibility) && !isGreeting && !isPlaybookAction) {
            // Package presenter — detect intent + format reply (summary/detail/compare/pricing/duration)
            const { detectPackageIntent, formatPackageReply, hasStructuredPackages } = await import('../knowledge/packagePresenter.mjs');
            let kbReply;
            let usedKbMatch = kbMatch;

            // Duration pricing routing: if pricing_general matched a duration query, use packages KB
            const isDurationQuery = kbMatch.category === 'pricing' && /\d+\s*ore/i.test(lastClientMessageText);
            if (isDurationQuery) {
                const { matchKnowledge: matchKB } = await import('../knowledge/knowledgeMatcher.mjs');
                const pkgKB = await matchKB('Ce pachete de animatie aveti?', { detectedServices: serviceData.selected_services || ['animator'] });
                if (pkgKB && pkgKB.knowledgeKey === 'animator_packages') {
                    usedKbMatch = pkgKB;
                    console.log(`[Pipeline] Duration pricing: routed to animator_packages`);
                }
            }

            if (hasStructuredPackages(usedKbMatch)) {
                const intent = detectPackageIntent(lastClientMessageText);
                kbReply = formatPackageReply(usedKbMatch, intent, conversation_id);
                console.log(`[Pipeline] Package presenter: mode=${intent.mode}${intent.hours ? ', hours=' + intent.hours : ''}, feature=${intent.feature}`);
            } else {
                kbReply = kbMatch.answer;
            }

            // For high-score KB matches (≥0.88): send directly, skip shouldReplyNow
            // Client asked a direct question → they get a direct answer
            let kbShouldSend = false;
            let kbReplyDecision = { decision: 'reply_now', reason: 'kb_high_score_bypass' };

            if (kbMatch.score >= 0.88) {
                // Smart anti-duplicate: block only if no new client msg after recent outbound
                const { data: recentOut } = await supabase
                    .from('messages').select('id, created_at')
                    .eq('conversation_id', conversation_id)
                    .eq('direction', 'outbound')
                    .gt('created_at', new Date(Date.now() - 20 * 1000).toISOString()) // 20 sec window
                    .order('created_at', { ascending: false })
                    .limit(1);
                let isDuplicate = false;
                if (recentOut && recentOut.length > 0) {
                    // Check if client sent a new message AFTER our last outbound
                    const { data: newInbound } = await supabase
                        .from('messages').select('id')
                        .eq('conversation_id', conversation_id)
                        .eq('direction', 'inbound')
                        .gt('created_at', recentOut[0].created_at)
                        .limit(1);
                    isDuplicate = !newInbound || newInbound.length === 0;
                }
                if (isDuplicate) {
                    kbReplyDecision = { decision: 'blocked_duplicate', reason: 'recent_outbound_exists' };
                    console.log(`[Pipeline] KB direct: anti-duplicate blocked`);
                } else {
                    kbShouldSend = true;
                    console.log(`[Pipeline] KB direct: high score (${kbMatch.score.toFixed(2)}) → sending directly`);
                }
            } else {
                // Lower score: use shouldReplyNow guards
                kbReplyDecision = await shouldReplyNow({
                    conversationId: conversation_id,
                    newReply: kbReply,
                    nextStep: 'kb_direct_answer',
                    lastClientMessage: lastClientMessageText
                });
                kbShouldSend = kbReplyDecision.decision === 'reply_now';
            }

            let kbStatus = 'pending';
            let kbSentBy = 'reply_engine';
            let kbSentAt = null;

            if (kbShouldSend) {
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
        // ── 8.4.0. Confidence Guard — prevent side effects on ambiguous intent ──
        const llmConfidence = decision.confidence_score || 0;
        const SIDE_EFFECT_TOOLS = ['update_event_plan', 'generate_quote_draft', 'confirm_booking_from_ai_plan', 'archive_plan'];
        if (llmConfidence < 50 && SIDE_EFFECT_TOOLS.includes(toolAction.name)) {
            console.warn(`[Pipeline] ⚠️  Confidence too low (${llmConfidence}) for side-effect tool "${toolAction.name}" → downgrading to reply_only`);
            toolAction = { name: 'reply_only', arguments: { reason: `confidence_guard: ${llmConfidence}% too low for ${toolAction.name}` } };
        }

        // ── 8.4.1. Execute LLM Tool Action ──
        console.log(`[Pipeline] Attempting to execute tool action: ${toolAction.name}`);
        const actionResult = await executeAiAction(toolAction, {
            conversationId: conversation_id,
            clientId,
            goalState,
            eventPlan,
            contextPack
        });

        // If the action successfully updated the event plan, re-evaluate it
        if (eventPlan?.id && (toolAction.name === 'update_event_plan' && actionResult.success)) {
            // Reload the plan to get the fresh DB state
            const updatedPlan = await loadOrCreateEventPlan(conversation_id, clientId);
            Object.assign(eventPlan, updatedPlan);

            const planEval = evaluateEventPlan(eventPlan);
            
            // Push the evaluation metrics back to the DB cleanly
            const { updateEventPlan: rawUpdateEventPlan } = await import('../events/eventPlanAssembler.mjs');
            await rawUpdateEventPlan(eventPlan.id, conversation_id, {
                missing_fields: planEval.missingFields,
                confirmed_fields: planEval.confirmedFields,
                confidence: planEval.confidence,
                readiness_for_recommendation: planEval.readinessForRecommendation,
                readiness_for_quote: planEval.readinessForQuote,
                readiness_for_booking: planEval.readinessForBooking
            }, 'system', 'post_action_evaluation');

            console.log(`[Pipeline] EventPlan evaluated post-action: ${planEval.completionPercent}% complete, quote_ready=${planEval.readinessForQuote}, missing=[${planEval.missingFields.join(',')}]`);
        } else if (!actionResult.success) {
            console.warn(`[Pipeline] Action failed or blocked: ${actionResult.message}`);
            // If it's a critical failure, we might want to tell the user or override the reply, 
            // but for now we degrade gracefully and keep the reply.
        }

        // ── Phase 3: Synchronize Party Draft Post Action ──
        if (toolAction.name === 'update_event_plan' && partyDraft) {
            try {
                let finalRolesToEvaluate = rolesToEvaluate;
                if (serviceData && serviceData.selected_services && serviceData.selected_services.length > 0) {
                    const CATALOG_TO_ROLE = {
                        'animator': 'role_animatie',
                        'ursitoare': 'role_ursitoare',
                        'vata_zahar': 'role_vata_de_zahar',
                        'popcorn': 'role_popcorn',
                        'arcada_baloane': 'role_arcada_fara_suport',
                        'arcada_suport': 'role_arcada_pe_suport',
                        'arcada_exterior': 'role_arcada_pe_suport', // rough map
                        'suport_arcada_baloane': 'role_arcada_pe_suport',
                        'cifre_volumetrice': 'role_arcada_cu_cifre_volumetrice',
                        'mos_craciun': 'role_mos_craciun',
                        'parfumerie': 'role_parfumerie',
                        'gheata_carbonica': 'role_gheata_carbonica'
                    };
                    const detectedRoles = serviceData.selected_services
                        .map(s => CATALOG_TO_ROLE[s] || `role_${s}`);
                    finalRolesToEvaluate = [...new Set([...rolesToEvaluate, ...detectedRoles])];
                }

                partyDraft = updatePartyDraftFromMessage(partyDraft, toolAction.arguments, finalRolesToEvaluate);
                const p3Eval = computeMissingPartyFields(partyDraft, finalRolesToEvaluate);
                
                partyDraft.comercial.campuri_obligatorii_lipsa = p3Eval.missingForBooking;
                partyDraft.comercial.gata_pentru_oferta = p3Eval.isReadyForQuote;
                
                const saveSuccess = await savePartyDraft(partyDraft);
                if (saveSuccess) {
                    console.log(`[Phase3 PartyBuilder] Synced Party Draft. Missing booking fields: ${p3Eval.missingForBooking.length}. Ready for quote: ${p3Eval.isReadyForQuote}`);
                }
            } catch (e) {
                console.error(`[Phase3 PartyBuilder] Sync exception: ${e.message}`);
            }
        }

        const statePayload = {
            conversation_id,
            current_intent: convState.current_intent,
            current_stage: decision.conversation_stage,
            next_best_action: convState.next_best_action,
            updated_at: new Date().toISOString()
        };
        if (message_id) statePayload.last_processed_message_id = message_id;
        await supabase.from('ai_conversation_state').upsert(statePayload);

        // ── 8.4.2. Persist Autonomous Runtime State ──
        if (typeof runtimeState !== 'undefined' && typeof nextTarget !== 'undefined') {
            await saveLeadRuntimeState(conversation_id, {
                lead_state: nextTarget.nextState,
                last_agent_goal: nextTarget.instruction.substring(0, 200),
                next_best_action: nextTarget.action,
                primary_service: runtimeState.primary_service,
                active_roles: runtimeState.active_roles,
                missing_fields: missingMetrics?.missing || [],
                human_takeover: runtimeState.human_takeover
            });
            console.log(`[Agent] Persisted runtime state to DB: ${nextTarget.nextState} / ${nextTarget.action}`);
        }

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
            // But NOT for simple greetings — let normal composer handle those
            const isPricingDuration = kbMatch.category === 'pricing' && /\d+\s*ore/i.test(kbMatchedMessage);
            if ((kbMatch.category === 'packages' || isPricingDuration) && kbMatch.score >= 0.75 && !isGreeting) {
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
        const escalation = {
            needs_escalation: false,
            escalation_type: 'none',
            escalation_reason: 'mock',
            human_takeover: false,
            needs_human_review: false
        };
        if (escalation.needs_escalation) {
            console.log(`[Pipeline] Escalation: type=${escalation.escalation_type}, reason=${escalation.escalation_reason}`);
        }

        // ── 8.8.1. Goal State Transition ──
        const goalTransition = evaluateGoalTransition({
            currentState: goalState.current_state,
            eventPlan,
            analysis,
            mutation,
            services: {
                selected: serviceData.selected_services,
                confirmed: eventPlan?.confirmed_services || [],
                detection_status: serviceConfidence?.service_detection_status
            },
            isGreeting,
            lastClientMessage: lastClientMessageText
        });

        if (goalTransition.shouldTransition) {
            await transitionGoalState(conversation_id, goalTransition.newState, {
                trigger: 'message',
                reason: goalTransition.reason,
                confidence: goalTransition.confidence
            });
            goalState.current_state = goalTransition.newState;
            goalState.previous_state = goalTransition.from;

        }

        // ── 8.8.2. Next Best Action ──
        const nextBestAction = evaluateNextBestAction({
            goalState,
            eventPlan,
            quoteState: latestQuote,
            kbMatch,
            escalation,
            humanTakeover: convState?.human_takeover_active || false,
            services: {
                selected: serviceData.selected_services,
                detection_status: serviceConfidence?.service_detection_status
            }
        });

        // ── 8.8.3. Auto-Generate Quote Draft (if NBA says so) ──
        if (nextBestAction.action === 'generate_quote_draft') {
            const { buildQuoteDraft, saveQuoteDraft } = await import('../quotes/buildQuoteDraft.mjs');
            const pkgCode = eventPlan.selected_package?.package || eventPlan.selected_package;
            console.log(`[Pipeline] NBA requested quote. Building from package: ${pkgCode}`);
            
            const newQuote = await buildQuoteDraft(eventPlan, { packageCode: pkgCode });
            if (newQuote && !newQuote.error) {
                const savedQuote = await saveQuoteDraft(newQuote);
                if (savedQuote) {
                    latestQuote = newQuote; // Update in-memory for Brain Tab / Composer
                    latestQuote.id = savedQuote.id;
                    latestQuote.version_no = savedQuote.version_no;
                    console.log(`[Pipeline] Auto-generated Quote Draft v${savedQuote.version_no}`);
                    
                    // Tell the composer to present it
                    nextBestAction.action = 'send_quote';
                    nextBestAction.explanation = 'Am generat oferta draft. Poti sa o trimiti clientului.';
                }
            }
        }

        // Persist NBA into goal state
        await transitionGoalState(conversation_id, goalState.current_state, {
            trigger: 'nba_update',
            reason: 'next_best_action_computed',
            confidence: goalTransition.confidence || 80,
            nextBestAction: nextBestAction.action,
            nextBestQuestion: nextBestAction.question,
            explanationForOperator: nextBestAction.explanation
        });

        console.log(`[Pipeline] Goal: ${goalTransition.shouldTransition ? goalTransition.from + '→' + goalTransition.newState : goalState.current_state} | NBA: ${nextBestAction.action} | ${nextBestAction.explanation}`);

        // ── 8.9. Compose humanized reply (with progression + KB grounding context) ──
        let composerResult = { reply: suggestedReply, replyStyle: 'warm_sales', composerUsed: false, serviceDetectionStatus: 'unknown' };
        let t_composer_ms = 0;

        // Hybrid package composer bypass — prices from KB template, context from LLM
        if (hybridPackageReply) {
            suggestedReply = hybridPackageReply;
            composerResult = { reply: hybridPackageReply, replyStyle: 'warm_sales', composerUsed: true, specificity: 'kb_packages', serviceDetectionStatus: 'confirmed' };
            console.log(`[Pipeline] Using hybrid package reply (${hybridPackageReply.length} chars), skipping general composer`);
        } else if ((kbGroundingContext || latestQuote) && (eligibility.eligible || !decision.needs_human_review)) {
            const t_comp_start = Date.now();

            // Run composer ONLY for KB injection or freshly generated Quotes.
            composerResult = await composeHumanReply({
                analysis,
                entityMemory,
                salesCycle,
                conversationStage: dbStage || decision.conversation_stage,
                conversationText: userMessage,
                serviceConfidence,
                progression,
                kbGrounding: kbGroundingContext,
                learnedContext,
                latestQuote
            });
            console.log(`[Pipeline] Composer run for ${kbGroundingContext ? 'KB Grounding' : 'Quote Presentation'}`);

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
        } else {
            console.log(`[Pipeline] Bypassing legacy composer -> Autonomous Phase 3 Reply preserved.`);
            composerResult = { reply: suggestedReply, replyStyle: 'warm_sales', composerUsed: false, specificity: 'autonomous_phase3', serviceDetectionStatus: 'unknown' };
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

        // ── 9. Safety classification + operational mode ──
        const operationalMode = AI_SHADOW_MODE_ENABLED ? 'shadow_mode'
            : AI_SAFE_AUTOREPLY_ENABLED ? 'safe_autoreply_mode'
            : AI_FULL_AUTOREPLY_ENABLED ? 'full_autoreply_mode'
            : 'legacy';

        const safetyResult = evaluateSafetyClass({
            decision,
            toolAction,
            goalState,
            escalation,
            serviceConfidence,
            relationshipData,
            eventPlan,
            mutation
        });

        console.log(`[Pipeline] Safety: class=${safetyResult.safetyClass}, mode=${operationalMode}, reasons=${safetyResult.reasons.join('; ')}`);

        // ── 9.1. Auto-send logic (via shouldReplyNow engine) ──
        let replyStatus = 'pending';
        let sentBy = 'pending';
        let sentAt = null;
        let replyDecisionResult = { decision: 'blocked_autoreply_off', reason: 'not_checked' };

        // Shadow mode: never send, always save
        if (operationalMode === 'shadow_mode') {
            replyStatus = 'shadow';
            sentBy = 'shadow_mode';
            replyDecisionResult = { decision: 'shadow_hold', reason: `shadow_mode: ${safetyResult.safetyClass}` };
            console.log(`[Pipeline] Shadow mode: holding reply (safety=${safetyResult.safetyClass})`);
        }
        // Safe autoreply mode: cohort + eligibility + safety check
        else if (operationalMode === 'safe_autoreply_mode') {
            const toolName = toolAction?.name || toolAction;

            // Wave 2 path: update_event_plan
            if (toolName === 'update_event_plan' && AI_WAVE2_ENABLED) {
                const memConflict = await detectMemoryConflicts({
                    conversationId: conversation_id, clientId,
                    proposedUpdates: toolAction?.arguments || {},
                    eventPlan, goalState, relationshipData, entityMemory: null
                });
                const wave2Elig = isWave2Eligible({
                    safetyClass: safetyResult.safetyClass, toolAction, decision,
                    goalState, escalation, eventPlan, memoryConflict: memConflict,
                    relationshipData, ambiguityDetected: decision.needs_human_review,
                    identityUncertain: false, clarificationNeeded: false
                });
                console.log(`[Pipeline] Wave2: eligible=${wave2Elig.eligible}, conflicts=${memConflict.conflict_count}, severity=${memConflict.severity}`);
                if (!wave2Elig.eligible || memConflict.recommendation === 'block_autoreply') {
                    replyStatus = 'pending_review';
                    sentBy = 'wave2_hold';
                    replyDecisionResult = { decision: 'wave2_hold',
                        reason: wave2Elig.blockers.join('; ') || memConflict.recommendation };
                    console.log(`[Pipeline] Wave2 hold: ${replyDecisionResult.reason}`);
                }
            }
            // Wave 1 path: reply_only
            else {
                const cohort = shouldIncludeInWave1(conversation_id, clientId, 'whatsapp');
                const wave1Elig = isWave1Eligible({
                    safetyClass: safetyResult.safetyClass,
                    decision, toolAction, goalState, escalation,
                    relationshipData, mutation,
                    ambiguityDetected: decision.needs_human_review,
                    identityUncertain: false
                });
                console.log(`[Pipeline] Wave1: cohort=${cohort.included} (${cohort.reason}), eligible=${wave1Elig.eligible} (${wave1Elig.blockers.join('; ') || 'all_clear'})`);

                if (!cohort.included || !wave1Elig.eligible || safetyResult.safetyClass !== 'safe_autoreply_allowed') {
                    replyStatus = cohort.included ? 'pending_review' : 'shadow';
                    sentBy = !cohort.included ? 'cohort_excluded' : 'safety_hold';
                    replyDecisionResult = { decision: cohort.included ? 'safety_hold' : 'cohort_excluded',
                        reason: !cohort.included ? cohort.reason : (wave1Elig.blockers.join('; ') || safetyResult.reasons.join('; ')) };
                    console.log(`[Pipeline] Wave1 hold: ${replyDecisionResult.decision} — ${replyDecisionResult.reason}`);
                }
            }
        }
        // Wave 1 / safe autoreply send path (only when included + eligible + safe)
        if (operationalMode === 'safe_autoreply_mode' && replyStatus === 'pending') {

        // KB score-based bypass for composer path (same as KB direct answer bypass)
        const kbComposerBypass = kbMatch && kbMatch.score >= 0.75 && kbGroundingContext && !eligibility.eligible;
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
                playbookKey: nextTarget.playbookKey,
                serviceConfidence
            });

            if (replyDecisionResult.decision === 'reply_now') {
                // Smart anti-duplicate: block only if no new client msg after recent outbound
                const { data: recentOutbound } = await supabase
                    .from('messages')
                    .select('id, created_at')
                    .eq('conversation_id', conversation_id)
                    .eq('direction', 'outbound')
                    .gt('created_at', new Date(Date.now() - 20 * 1000).toISOString()) // 20 sec window
                    .order('created_at', { ascending: false })
                    .limit(1);
                let isComposerDuplicate = false;
                if (recentOutbound && recentOutbound.length > 0) {
                    const { data: newClientMsg } = await supabase
                        .from('messages').select('id')
                        .eq('conversation_id', conversation_id)
                        .eq('direction', 'inbound')
                        .gt('created_at', recentOutbound[0].created_at)
                        .limit(1);
                    isComposerDuplicate = !newClientMsg || newClientMsg.length === 0;
                }
                if (isComposerDuplicate) {
                    console.log(`[Pipeline] Anti-duplicate: outbound exists with no new client msg, skipping send`);
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
        } // close shadow/safe mode else

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
        // Try with all columns (eligibility + quality + safety)
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
            escalation_reason: escalation.needs_escalation ? escalation.escalation_reason : null,
            safety_class: safetyResult.safetyClass,
            safety_class_reasons: safetyResult.reasons,
            operational_mode: operationalMode,
            tool_action_suggested: toolAction ? JSON.stringify(toolAction) : null,
            memory_context_used: JSON.stringify({
                entity_type: existingMemory?.entity_type,
                is_recurring: relationshipData?.isRecurring,
                conversation_count: relationshipData?.conversationCount,
                has_active_booking: relationshipData?.hasActiveBooking,
                plan_status: eventPlan?.status,
                goal_state: goalState?.current_state
            })
        });
        // Fallback 1: if safety JSONB columns missing, try without them
        if (errDecision && errDecision.message?.includes('does not exist')) {
            console.warn('[Pipeline] Safety JSONB columns missing. Trying with simple safety...');
            const { error: e1b } = await supabase.from('ai_reply_decisions').insert({
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
                escalation_reason: escalation.needs_escalation ? escalation.escalation_reason : null,
                safety_class: safetyResult.safetyClass,
                operational_mode: operationalMode,
                tool_action_suggested: toolAction ? JSON.stringify(toolAction) : null
            });
            errDecision = e1b;
        }
        // Fallback 2: if safety columns also missing, try without them
        if (errDecision && errDecision.message?.includes('does not exist')) {
            console.warn('[Pipeline] Safety columns not in schema. Trying with quality only...');
            const { error: e2 } = await supabase.from('ai_reply_decisions').insert({
                ...decisionPayload,
                eligibility_status: eligibility.eligible ? 'eligible' : 'blocked',
                eligibility_reason: eligibility.reason,
                cycle_status: salesCycle.cycle_eligibility,
                cycle_reason: salesCycle.cycle_reason
            });
            errDecision = e2;
        }
        // Fallback 3: if eligibility columns also missing, save base only
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
            escalation,
            goalState,
            eventPlan,
            nextBestAction,
            latestQuote
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
