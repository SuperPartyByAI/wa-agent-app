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
    const { conversationId, clientId, goalState, eventPlan } = context;

    console.log(`[Executor] Received Action: ${name}`);

    // 1. Validate Schema
    const schemaValidation = validateToolActionSchema(name, args);
    if (!schemaValidation.valid) {
        console.warn(`[Executor] Action Schema Invalid:`, schemaValidation.error);
        return { success: false, message: schemaValidation.error };
    }

    // 2. Validate Execution Policy (Goal State Match)
    if (!isActionAllowedInState(name, goalState.current_state)) {
        console.warn(`[Executor] Action '${name}' not permitted in state '${goalState.current_state}'`);
        return { success: false, message: `Action '${name}' not permitted in current stage.` };
    }

    // 3. Execute Registry Hooks
    try {
        switch (name) {
            case 'reply_only':
                return { success: true, message: 'Reply only.', data: { reason: args.reason } };

            case 'update_event_plan':
                if (!eventPlan) {
                    return { success: false, message: 'No active event plan found to update.' };
                }
                if (eventPlan.operator_locked) {
                    return { success: false, message: 'Event plan is locked by an operator.' };
                }
                
                await updateEventPlan(eventPlan.id, conversationId, args, 'ai', 'action_executor');
                return { success: true, message: 'Event plan updated safely.' };

            case 'generate_quote_draft':
                if (!eventPlan) {
                    return { success: false, message: 'No active event plan to quote.' };
                }
                const newQuote = await buildQuoteDraft(eventPlan, { packageCode: args.target_package });
                if (newQuote && !newQuote.error) {
                    const savedQuote = await saveQuoteDraft(newQuote);
                    return { success: true, message: 'Quote draft generated.', data: { quote_id: savedQuote.id } };
                }
                return { success: false, message: 'Quote builder failed.' };

            case 'confirm_booking_from_ai_plan':
                if (!args.ai_event_plan_id) {
                    return { success: false, message: 'Missing ai_event_plan_id.' };
                }
                const dispatchResult = await dispatchBookingToCore({
                    ai_event_plan_id: args.ai_event_plan_id,
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
                return { success: dispatchResult.success, message: 'Booking confirmed via API.', data: dispatchResult };

            case 'archive_plan':
                if (!eventPlan) return { success: false, message: 'No plan to archive.' };
                await archiveEventPlan({
                    planId: eventPlan.id,
                    archivedBy: 'ai',
                    archiveReason: args.reason
                });
                return { success: true, message: 'Plan archived softly.' };

            case 'handoff_to_operator':
                return { success: true, message: 'Handoff initiated.', data: { reason: args.reason } };

            default:
                return { success: false, message: `Unknown action logic: ${name}` };
        }
    } catch (err) {
        console.error(`[Executor] Critical failure executing ${name}:`, err.message);
        return { success: false, message: `Execution failed: ${err.message}` };
    }
}
