import { askNotebookLM } from './notebookLmAdapter.mjs';
import fs from 'fs';
import path from 'path';

/**
 * Evaluates the NotebookLM adapter in shadow mode.
 * Safe to call, will not throw and break the main execution pipeline.
 */
export async function runShadowPipeline(contextPayload) {
    try {
        // Try to load knowledge base from an external text file if it exists, otherwise use a placeholder
        let kbText = "Reguli Interne Superparty: 1. Confirmam datele. 2. Oferta depinde de zona. (Acest KB este un placeholder temporar)";
        const kbPath = path.resolve(process.cwd(), 'docs/notebook_knowledge.md');
        if (fs.existsSync(kbPath)) {
            kbText = fs.readFileSync(kbPath, 'utf8');
        }
        
        // Inject KB into context payload
        const payloadWithKb = { ...contextPayload, knowledgeBase: kbText };

        const startTime = Date.now();
        console.log(`[Shadow Evaluator] Starting NotebookLM evaluation for client ${contextPayload.profile?.id || 'unknown'}...`);
        
        // Timeout wrapper: 15 seconds to ensure we do not hang up
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Shadow execution timeout')), 15000));
        
        const result = await Promise.race([
            askNotebookLM(payloadWithKb),
            timeoutPromise
        ]);
        
        const ellapsed = Date.now() - startTime;
        
        console.log(`\n=== [SHADOW MODE] NotebookLM Evaluation (${ellapsed}ms) ===`);
        console.log(`Intent: ${result.intent}`);
        console.log(`Action: ${result.recommendedAction}`);
        console.log(`Draft:  ${result.replyDraft}`);
        console.log(`Conf.:  ${result.confidence}%`);
        console.log(`Needs Clarification: ${result.needsClarification}`);
        console.log(`Needs Confirmation:  ${result.needsConfirmation}`);
        console.log(`Citations: ${JSON.stringify(result.citations)}`);
        console.log(`=====================================================\n`);
        
        return result;
    } catch (err) {
        console.error(`[Shadow Evaluator] Failed or timed out gracefully. Reason:`, err.message);
        // Fallback elegantly by returning null and not throwing
        return null;
    }
}
