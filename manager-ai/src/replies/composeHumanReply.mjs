import { callLocalLLMText } from '../llm/client.mjs';
import { buildReplyComposerPrompt, detectReplyStyle } from '../prompts/replyComposerPrompt.mjs';

/**
 * Composes a humanized WhatsApp reply from structured analysis data.
 * Uses a dedicated LLM call with a composer-specific prompt.
 *
 * Falls back to the analysis draft if the composer LLM call fails.
 *
 * @param {object} params
 * @param {object} params.analysis      - full LLM analysis output
 * @param {object} params.entityMemory  - entity memory context
 * @param {object} params.salesCycle    - cycle reasoning
 * @param {string} params.conversationStage - current stage
 * @param {string} params.conversationText  - original conversation text for context
 * @returns {object} { reply: string, replyStyle: string, composerUsed: boolean }
 */
export async function composeHumanReply({
    analysis,
    entityMemory,
    salesCycle,
    conversationStage,
    conversationText
}) {
    const draftReply = analysis.suggested_reply || 'Nu am putut genera un raspuns.';

    // Detect style mode
    const replyStyle = detectReplyStyle({
        entityMemory,
        salesCycle,
        conversationStage
    });

    // Build composer prompt
    const composerPrompt = buildReplyComposerPrompt({
        analysis,
        entityMemory,
        salesCycle,
        replyStyle
    });

    try {
        // Use a shorter, focused LLM call just for reply composition
        const composedReply = await callLocalLLMText(
            composerPrompt,
            conversationText
        );

        // The composer should return just text, not JSON
        // Clean up any potential JSON wrapping or extra formatting
        let finalReply = composedReply;

        if (typeof composedReply === 'object') {
            // If LLM returned JSON instead of plain text, extract the reply
            finalReply = composedReply.reply || composedReply.suggested_reply || composedReply.text || JSON.stringify(composedReply);
        }

        // Remove any surrounding quotes
        if (typeof finalReply === 'string') {
            finalReply = finalReply.trim();
            if ((finalReply.startsWith('"') && finalReply.endsWith('"')) ||
                (finalReply.startsWith("'") && finalReply.endsWith("'"))) {
                finalReply = finalReply.slice(1, -1);
            }
        }

        // Validate — must be actual text, not empty or too short
        if (finalReply && finalReply.length > 5 && finalReply.length < 500) {
            console.log(`[Composer] Humanized reply (${replyStyle}): ${finalReply.substring(0, 80)}...`);
            return { reply: finalReply, replyStyle, composerUsed: true };
        }

        // Fallback to draft if composer output is bad
        console.warn('[Composer] Output invalid, falling back to analysis draft.');
        return { reply: draftReply, replyStyle, composerUsed: false };

    } catch (err) {
        console.warn('[Composer] LLM call failed, falling back to analysis draft:', err.message);
        return { reply: draftReply, replyStyle, composerUsed: false };
    }
}
