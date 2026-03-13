import { ACTION_REGISTRY, validateToolActionSchema } from './actionRegistry.mjs';
import { updateEventPlan, archiveEventPlan } from '../events/eventPlanAssembler.mjs';
import { dispatchBookingToCore } from '../api/coreApiClient.mjs';
import { buildQuoteDraft, saveQuoteDraft } from '../quotes/buildQuoteDraft.mjs';

/**
 * Validates whether the requested action is permitted in the current goal state.
 */
function isActionAllowedInState(actionName, currentState) {
    const registryEntry = ACTION_REGISTRY[actionName];
    if (!registryEntry) return false;

    if (registryEntry.allowedGoalStates.includes('*')) return true;
    return registryEntry.allowedGoalStates.includes(currentState);
}

/**
 * Executes a verified LLM tool action.
 * Returns { success: boolean, message: string, data: object }
 */
export async function executeAiAction(toolAction, context) {
    const { name, arguments: args } = toolAction;
    const { conversationId, clientId, goalState, eventPlan, contextPack } = context;

    console.log(`[Executor] Received Action: ${name}`);

    // Build audit metadata
    const audit = {
        context_pack_version: contextPack?.action_registry_version || 'none',
        deployed_sha: contextPack?.deployed_commit_sha || 'unknown',
        registry_version: contextPack?.action_registry_version || 'live',
        drift_detected: false,
        executed_at: new Date().toISOString()
    };

    // 0. Cross-validate: if context pack exists, check tool exists in snapshot
    if (contextPack?.action_registry_snapshot) {
        const snapshotTools = Object.keys(contextPack.action_registry_snapshot);
        if (!snapshotTools.includes(name) && name !== 'reply_only') {
            audit.drift_detected = true;
            console.warn(`[Executor] Tool '${name}' not found in context pack snapshot (drift). Checking live registry.`);
        }
    }

    // 1. Validate Schema
    const schemaValidation = validateToolActionSchema(name, args);
    if (!schemaValidation.valid) {
        console.warn(`[Executor] Action Schema Invalid:`, schemaValidation.error);
        return { success: false, message: schemaValidation.error, audit };
    }

    // 2. Validate Execution Policy (Goal State Match)
    if (!isActionAllowedInState(name, goalState.current_state)) {
        console.warn(`[Executor] Action '${name}' not permitted in state '${goalState.current_state}'`);
        return { success: false, message: `Action '${name}' not permitted in current stage.`, audit };
    }

    // 3. Execute Registry Hooks
    try {
        switch (name) {
            case 'reply_only':
                return { success: true, message: 'Reply only.', data: { reason: args.reason }, audit };

            case 'update_event_plan':
                if (!eventPlan) {
                    return { success: false, message: 'No active event plan found to update.', audit };
                }
                if (eventPlan.operator_locked) {
                    return { success: false, message: 'Event plan is locked by an operator.', audit };
                }
                
                // Diagnostic: log what fields the LLM extracted
                const updateKeys = Object.keys(args).filter(k => args[k] !== undefined && args[k] !== null);
                console.log(`[Executor] update_event_plan args: ${JSON.stringify(args)} (${updateKeys.length} fields: ${updateKeys.join(', ')})`);
                
                await updateEventPlan(eventPlan.id, conversationId, args, 'ai', 'action_executor');
                return { success: true, message: 'Event plan updated safely.', audit };

            case 'generate_quote_draft':
                if (!eventPlan) {
                    return { success: false, message: 'No active event plan to quote.', audit };
                }
                const newQuote = await buildQuoteDraft(eventPlan, { packageCode: args.target_package });
                if (newQuote && !newQuote.error) {
                    const savedQuote = await saveQuoteDraft(newQuote);
                    return { success: true, message: 'Quote draft generated.', data: { quote_id: savedQuote.id }, audit };
                }
                return { success: false, message: 'Quote builder failed.', audit };

            case 'confirm_booking_from_ai_plan':
                if (eventPlan?.operator_locked) {
                    return { success: false, message: 'Cannot confirm booking: plan is locked by an operator.', audit };
                }
                if (goalState.current_state === 'archived' || goalState.current_state === 'cancelled') {
                    return { success: false, message: 'Cannot confirm booking: Plan is archived or cancelled.', audit };
                }

                const finalPlanId = args.ai_event_plan_id || eventPlan?.id;
                if (!finalPlanId) {
                    return { success: false, message: 'Missing ai_event_plan_id and no active plan in context.', audit };
                }
                try {
                    const dispatchResult = await dispatchBookingToCore({
                        ai_event_plan_id: finalPlanId,
                        conversation_id: conversationId,
                        client_id: clientId,
                        operator_locked: eventPlan?.operator_locked || false,
                        plan_details: {
                            date: eventPlan?.event_date,
                            location: eventPlan?.location,
                            children_count_estimate: eventPlan?.children_count_estimate,
                            selected_package: eventPlan?.selected_package
                        }
                    });
                    return { success: dispatchResult.success, message: 'Booking confirmed via API.', data: dispatchResult, audit };
                } catch (dispatchErr) {
                    console.error(`[Executor] Core API failed: ${dispatchErr.message}`);
                    return { success: false, message: `Core API error: ${dispatchErr.message}`, audit };
                }

            case 'archive_plan':
                if (!eventPlan) return { success: false, message: 'No plan to archive.', audit };
                if (eventPlan.operator_locked) {
                    return { success: false, message: 'Cannot archive: plan is locked by an operator.', audit };
                }
                await archiveEventPlan(eventPlan.id, conversationId, {
                    archivedBy: 'ai',
                    archiveReason: args.reason
                });
                return { success: true, message: 'Plan archived softly.', audit };

            case 'handoff_to_operator':
                return { success: true, message: 'Handoff initiated.', data: { reason: args.reason }, audit };

            default:
                return { success: false, message: `Unknown action logic: ${name}`, audit };
        }
    } catch (err) {
        console.error(`[Executor] Critical failure executing ${name}:`, err.message);
        return { success: false, message: `Execution failed: ${err.message}`, audit };
    }
}
