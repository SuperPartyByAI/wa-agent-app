import { LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_MS } from '../config/env.mjs';

/**
 * Calls the local Ollama server via the OpenAI-compatible /v1/chat/completions endpoint.
 * Returns parsed JSON or null on failure.
 */
export async function callLocalLLM(systemPrompt, userMessage) {
    const url = `${LLM_BASE_URL}/v1/chat/completions`;
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) throw new Error('Empty LLM response');
        
        return JSON.parse(content);
    } catch (err) {
        console.error(`[LLM] Call failed:`, err.message);
        return null;
    }
}

/**
 * Calls the local Ollama server for plain text output (no JSON mode).
 * Used by the reply composer for natural text replies.
 * Returns raw text string or null on failure.
 */
export async function callLocalLLMText(systemPrompt, userMessage) {
    const url = `${LLM_BASE_URL}/v1/chat/completions`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.4
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) throw new Error('Empty LLM response');

        return content.trim();
    } catch (err) {
        console.error(`[LLM Text] Call failed:`, err.message);
        return null;
    }
}
