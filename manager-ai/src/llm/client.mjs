import {
    GEMINI_API_KEY, GEMINI_MODEL, GEMINI_BASE_URL, GEMINI_TIMEOUT_MS,
    LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_MS
} from '../config/env.mjs';

const useGemini = !!GEMINI_API_KEY;

/**
 * Generic OpenAI-compatible chat completion call.
 * @param {string} url — endpoint
 * @param {object} headers — request headers
 * @param {string} model — model name  
 * @param {Array} messages — chat messages
 * @param {object} options — temperature, response_format, timeout
 * @returns {string|null} content text
 */
async function chatCompletion(url, headers, model, messages, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);

    const body = {
        model,
        messages,
        temperature: options.temperature ?? 0.3
    };
    if (options.jsonMode) {
        body.response_format = { type: 'json_object' };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).substring(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
}

/**
 * Call Gemini API (OpenAI-compatible endpoint).
 */
async function callGemini(systemPrompt, userMessage, options = {}) {
    const url = `${GEMINI_BASE_URL}/chat/completions`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GEMINI_API_KEY}`
    };
    return chatCompletion(url, headers, GEMINI_MODEL, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ], { ...options, timeout: GEMINI_TIMEOUT_MS });
}

/**
 * Call local Ollama (OpenAI-compatible endpoint).
 */
async function callOllama(systemPrompt, userMessage, options = {}) {
    const url = `${LLM_BASE_URL}/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    return chatCompletion(url, headers, LLM_MODEL, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
    ], { ...options, timeout: LLM_TIMEOUT_MS });
}

/**
 * Calls the LLM for JSON output.
 * Primary: Gemini 2.0 Flash-Lite (fast, cloud)
 * Fallback: Local Ollama (slow, free)
 * Returns parsed JSON or null on failure.
 */
export async function callLocalLLM(systemPrompt, userMessage) {
    const t0 = Date.now();
    const provider = useGemini ? 'Gemini' : 'Ollama';

    try {
        let content;
        if (useGemini) {
            content = await callGemini(systemPrompt, userMessage, { temperature: 0.1, jsonMode: true });
        } else {
            content = await callOllama(systemPrompt, userMessage, { temperature: 0.1, jsonMode: true });
        }

        if (!content) throw new Error('Empty response');

        const ms = Date.now() - t0;
        console.log(`[LLM] ${provider} JSON OK in ${ms}ms`);
        return JSON.parse(content);
    } catch (err) {
        const ms = Date.now() - t0;
        console.error(`[LLM] ${provider} JSON failed (${ms}ms):`, err.message);

        // Fallback to Ollama if Gemini failed
        if (useGemini) {
            console.log('[LLM] Falling back to Ollama...');
            try {
                const content = await callOllama(systemPrompt, userMessage, { temperature: 0.1, jsonMode: true });
                if (!content) throw new Error('Empty fallback response');
                console.log(`[LLM] Ollama fallback OK in ${Date.now() - t0}ms`);
                return JSON.parse(content);
            } catch (fallbackErr) {
                console.error('[LLM] Ollama fallback also failed:', fallbackErr.message);
            }
        }
        return null;
    }
}

/**
 * Calls the LLM for plain text output.
 * Used by the reply composer for natural text replies.
 * Returns raw text string or null on failure.
 */
export async function callLocalLLMText(systemPrompt, userMessage) {
    const t0 = Date.now();
    const provider = useGemini ? 'Gemini' : 'Ollama';

    try {
        let content;
        if (useGemini) {
            content = await callGemini(systemPrompt, userMessage, { temperature: 0.4 });
        } else {
            content = await callOllama(systemPrompt, userMessage, { temperature: 0.4 });
        }

        if (!content) throw new Error('Empty response');

        const ms = Date.now() - t0;
        console.log(`[LLM] ${provider} Text OK in ${ms}ms`);
        return content.trim();
    } catch (err) {
        const ms = Date.now() - t0;
        console.error(`[LLM] ${provider} Text failed (${ms}ms):`, err.message);

        // Fallback to Ollama if Gemini failed
        if (useGemini) {
            console.log('[LLM] Falling back to Ollama for text...');
            try {
                const content = await callOllama(systemPrompt, userMessage, { temperature: 0.4 });
                if (!content) throw new Error('Empty fallback response');
                console.log(`[LLM] Ollama text fallback OK in ${Date.now() - t0}ms`);
                return content.trim();
            } catch (fallbackErr) {
                console.error('[LLM] Ollama text fallback also failed:', fallbackErr.message);
            }
        }
        return null;
    }
}
