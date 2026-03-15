/**
 * NEXT BEST ACTION PLANNER
 * 
 * The deterministic brain of the Autonomous Commercial Agent.
 * Evaluates the current Lead State and Missing Fields to explicitly instruct
 * the LLM on exactly which tool action to use and what content to focus on.
 */
import { evaluatePlaybook } from './businessPlaybook.mjs';

export const NBA_ACTIONS = {
    REPLY_GREETING: 'reply_greeting',
    IDENTIFY_SERVICE: 'identify_service',
    ASK_MISSING_FIELDS: 'ask_missing_fields',
    CONFIRM_DETECTED_SERVICE: 'confirm_detected_service',
    PREPARE_QUOTE: 'prepare_quote',
    SEND_QUOTE: 'send_quote',
    HANDLE_OBJECTION: 'handle_objection',
    SCHEDULE_FOLLOWUP: 'schedule_followup',
    STAY_SILENT: 'stay_silent',
    ESCALATE_TO_HUMAN: 'escalate_to_human'
};

/**
 * Determines the Next Best Action (NBA) for the agent.
 *
 * @param {object} context 
 * @param {object} context.runtimeState The current state from ai_lead_runtime_states
 * @param {object} context.missingMetrics Result from computeMissingFields
 * @param {boolean} context.humanTakeover Active human intervention
 * @param {boolean} context.isAcknowledgment True if the client message is just 'ok', 'da', etc.
 * @param {boolean} context.isGreeting True if the client message is just 'buna', 'salut'
 * @returns {object} { action: string, instruction: string, nextState: string }
 */
export function computeNextBestAction(context) {
    const { runtimeState, missingMetrics, humanTakeover, isAcknowledgment, isGreeting, clientMessageText } = context;

    // Evaluate Business Playbook rules to find tactical approach
    const playbookStrategy = evaluatePlaybook(context);
    let playbookInjection = '';
    const playbookKey = playbookStrategy ? playbookStrategy.playbook_key : null;
    if (playbookStrategy) {
        playbookInjection = `\n[PLAYBOOK OVERRIDE - TONE: ${playbookStrategy.tone}] -> ${playbookStrategy.strategy}`;
    }

    // 1. Absolute blocks
    if (humanTakeover || runtimeState.human_takeover) {
        return {
            action: NBA_ACTIONS.STAY_SILENT,
            instruction: 'Human operator is engaged. Do not reply.',
            nextState: 'escaladare_operator',
            playbookKey
        };
    }

    if (isAcknowledgment) {
        return {
            action: NBA_ACTIONS.STAY_SILENT,
            instruction: 'Client acknowledged. Waiting for further input.',
            nextState: runtimeState.lead_state, // retain state
            playbookKey
        };
    }

    // 2. Greeting
    if (isGreeting && !runtimeState.primary_service) {
        return {
            action: NBA_ACTIONS.REPLY_GREETING,
            instruction: 'Greet the user warmly and ask how Superparty can help them today. Do not assume any services yet.' + playbookInjection,
            nextState: 'salut_initial',
            playbookKey
        };
    }

    // 3. No Service Detected Yet
    if (!runtimeState.primary_service) {
        return {
            action: NBA_ACTIONS.IDENTIFY_SERVICE,
            instruction: 'Acknowledge the user but clarify exactly which services they are interested in (e.g. animators, cotton candy, balloons).' + playbookInjection,
            nextState: 'identificare_serviciu',
            playbookKey
        };
    }

    // 4. Service Detected, Data Missing
    if (missingMetrics && !missingMetrics.readyForQuote) {
        const nextField = missingMetrics.nextFieldToAsk || 'details';
        return {
            action: NBA_ACTIONS.ASK_MISSING_FIELDS,
            instruction: `The client wants ${runtimeState.primary_service}. You must ask ONLY for "${nextField}". Do NOT ask for any other missing fields right now. Take it strictly step-by-step.` + playbookInjection,
            nextState: 'colectare_date',
            playbookKey
        };
    }

    // 5. Data Collected, Ready for Quote
    if (missingMetrics && missingMetrics.readyForQuote) {
        if (runtimeState.lead_state !== 'oferta_trimisa') {
            return {
                action: NBA_ACTIONS.PREPARE_QUOTE,
                instruction: `All required data is collected for ${runtimeState.primary_service}. Generate a clear, structured pricing offer based strictly on the Commercial Policies.` + playbookInjection,
                nextState: 'gata_de_oferta',
                playbookKey
            };
        } else {
            // Already sent the quote, client is doing something else
            const actionPath = playbookStrategy && playbookStrategy.playbook_key === 'upsell_ready' ? NBA_ACTIONS.PREPARE_QUOTE : NBA_ACTIONS.HANDLE_OBJECTION;
            
            return {
                action: actionPath,
                instruction: 'The quote was already sent. Address any questions or objections the client has. If they agree to book, proceed with confirmation.' + playbookInjection,
                nextState: 'asteapta_raspuns_client',
                playbookKey
            };
        }
    }

    // Fallback
    return {
        action: NBA_ACTIONS.IDENTIFY_SERVICE,
        instruction: 'Answer the client politely and keep the conversation moving towards identifying their event needs.',
        nextState: runtimeState.lead_state,
        playbookKey
    };
}
