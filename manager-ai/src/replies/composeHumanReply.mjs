import { callLocalLLMText } from '../llm/client.mjs';
import { buildReplyComposerPrompt, detectReplyStyle } from '../prompts/replyComposerPrompt.mjs';
import { buildReplyContext } from './buildReplyContext.mjs';

/**
 * Composes a humanized, service-aware WhatsApp reply.
 * Uses buildReplyContext for concrete context, then a dedicated LLM call.
 *
 * Falls back to the analysis draft if the composer LLM call fails.
 *
 * @param {object} params
 * @returns {object} { reply, replyStyle, composerUsed, specificity, serviceDetectionStatus }
 */
export async function composeHumanReply({
    analysis,
    entityMemory,
    salesCycle,
    conversationStage,
    conversationText,
    serviceConfidence
}) {
    const draftReply = analysis.suggested_reply || 'Nu am putut genera un raspuns.';

    // Detect style mode
    const replyStyle = detectReplyStyle({
        entityMemory,
        salesCycle,
        conversationStage
    });

    // Build concrete reply context (now with service confidence guard)
    const replyContext = buildReplyContext({ analysis, entityMemory, serviceConfidence });

    // Build composer prompt with concrete context
    const composerPrompt = buildReplyComposerPrompt({
        replyContext,
        entityMemory,
        salesCycle,
        replyStyle,
        draftReply
    });

    try {
        const composedReply = await callLocalLLMText(
            composerPrompt,
            conversationText
        );

        // Clean up response
        let finalReply = composedReply;

        if (typeof composedReply === 'object') {
            finalReply = composedReply.reply || composedReply.suggested_reply || composedReply.text || JSON.stringify(composedReply);
        }

        if (typeof finalReply === 'string') {
            finalReply = finalReply.trim();
            // Remove surrounding quotes
            if ((finalReply.startsWith('"') && finalReply.endsWith('"')) ||
                (finalReply.startsWith("'") && finalReply.endsWith("'"))) {
                finalReply = finalReply.slice(1, -1);
            }
            // Remove any "Reply:" or "Mesaj:" prefixes
            finalReply = finalReply.replace(/^(Reply|Mesaj|Răspuns|Response)\s*:\s*/i, '');
        }

        // Validate
        if (finalReply && finalReply.length > 5 && finalReply.length < 500) {
            console.log(`[Composer] Humanized reply (${replyStyle}, ${replyContext.specificity}, svc_detection=${replyContext.serviceDetectionStatus}): ${finalReply.substring(0, 80)}...`);
            return {
                reply: finalReply,
                replyStyle,
                composerUsed: true,
                specificity: replyContext.specificity,
                serviceDetectionStatus: replyContext.serviceDetectionStatus
            };
        }

        console.warn('[Composer] Output invalid, falling back to analysis draft.');
        return { reply: draftReply, replyStyle, composerUsed: false, specificity: 'generic', serviceDetectionStatus: 'unknown' };

    } catch (err) {
        console.warn('[Composer] LLM call failed, falling back to analysis draft:', err.message);
        return { reply: draftReply, replyStyle, composerUsed: false, specificity: 'generic', serviceDetectionStatus: 'unknown' };
    }
}

