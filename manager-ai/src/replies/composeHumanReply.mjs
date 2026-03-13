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
    serviceConfidence,
    progression,
    kbGrounding,
    learnedContext,
    latestQuote
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
        draftReply,
        progression
    });

    // Inject KB grounding or learned context into conversation text
    let enrichedText = conversationText;

    if (latestQuote && ['draft', 'ready'].includes(latestQuote.status)) {
        const items = (latestQuote.line_items || []).map(i => i.title).join(', ');
        const notes = (latestQuote.missing_info_notes || []).join(' | ');
        enrichedText = `--- OFERTĂ GENERATĂ ACUM PENTRU CLIENT (PREZINT-O) ---
Total: ${latestQuote.grand_total} RON (din care ${latestQuote.transport_cost} transport)
Pachet: ${items}
${notes ? '\nLipsesc detalii: ' + notes : ''}
INSTRUCȚIUNE: Ești un coordonator prietenos. Prezintă-i oferta de mai sus pe scurt. Dă-i prețul total și întreabă-l dacă e ok și dacă vrea să mergem mai departe cu o factură/avans. NU te comporta ca un robot care așteaptă omul.
---

` + enrichedText;
    }

    if (kbGrounding) {
        const isPackages = kbGrounding.category === 'packages';

        const strictHeader = kbGrounding.sensitive
            ? `CATEGORIE SENSIBILĂ (${kbGrounding.category.toUpperCase()}) — MOD STRICT
NU adăuga: ${(kbGrounding.constraints?.forbiddenExtrapolations || []).join(', ')}.
DOAR reformulează informația de mai jos. NU inventa prețuri, pachete, garanții sau condiții noi.`
            : '';

        let instruction;
        if (isPackages) {
            // Special contextual instruction for packages
            instruction = `PACHETE ANIMAȚIE — COMPOSER CONTEXTUAL
Prezintă pachetele de mai jos clientului, DAR:
1. Citește TOATĂ conversația și observă ce detalii a dat clientul (dată, număr copii, tip eveniment, locație)
2. Dacă clientul a menționat o dată → confirmă data (ex: "Pe 24 martie, perfect!")
3. Dacă clientul a menționat detalii → recunoaște-le și recomandă un pachet potrivit
4. Prezintă pachetele numerotate (1️⃣ Pachet 1, 2️⃣ Pachet 2, etc.) cu preț, durată și ce face special fiecare
5. La final, întreabă ce lipsește (dată, nr copii, locație, tip event) sau dacă s-a hotărât la unul
6. NU inventa prețuri, NU adăuga pachete care nu sunt mai jos
7. Fii SCURT și la obiect, maxim 4 pachete, nu lista tot
8. Ton cald, prietenos, ca un om real, nu ca un robot`;
        } else {
            instruction = kbGrounding.constraints?.composerInstruction || 'Formulează natural și scurt.';
        }

        // Use pre-formatted packages if available
        const factualContent = kbGrounding.formattedPackages || kbGrounding.factualAnswer;

        enrichedText = `--- KNOWLEDGE BASE (SURSĂ DE ADEVĂR FACTUALĂ) ---
Informație verificată pentru: ${kbGrounding.knowledgeKey}
Categorie: ${kbGrounding.category}
${strictHeader ? '\n' + strictHeader : ''}

${factualContent}

INSTRUCȚIUNE COMPOSER: ${instruction}
---

${enrichedText}`;
    } else if (learnedContext && learnedContext.length > 0) {
        const examples = learnedContext.map(c =>
            `- Context: "${c.questionContext}" → Răspuns bun: "${c.correctedReply}" (scope: ${c.scope})`
        ).join('\n');
        enrichedText = `--- EXEMPLE CORECTE ANTERIOARE (GHID, NU SURSĂ ABSOLUTĂ) ---
${examples}
---

${enrichedText}`;
    }

    try {
        const composedReply = await callLocalLLMText(
            composerPrompt,
            enrichedText
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
        const maxLen = kbGrounding ? 800 : 500;
        if (finalReply && finalReply.length > 5 && finalReply.length < maxLen) {
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

