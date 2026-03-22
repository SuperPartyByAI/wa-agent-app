// Global Network Interceptor to strictly enforce gemini-2.5-flash-lite usage
// This monkey-patches the global fetch function to intercept any outbound requests to Google GenAI APIs.

const originalFetch = globalThis.fetch;

globalThis.fetch = async function(url, options) {
    const urlString = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));
    
    // Check if the request is going to Google AI Studio / Gemini API
    if (urlString.includes('generativelanguage.googleapis.com')) {
        // Allow embeddings since they use different models (e.g. text-embedding-004)
        if (urlString.includes('models/gemini-') || urlString.includes('models/gemini-2.0')) {
            // Block anything that is NOT gemini-2.5-flash-lite
            if (!urlString.includes('gemini-2.5-flash-lite')) {
                const errMsg = `🛑 SECURITY BAN: Încercare de utilizare a unui model neautorizat! S-a detectat un apel interzis către: ${urlString}. 
SINGURUL model de text acceptat în platformă este 'gemini-2.5-flash-lite' pentru optimizarea costurilor. Modifică parametrul 'model' în cod!`;
                console.error(errMsg);
                throw new Error(errMsg);
            }
        }
    }
    
    // If body contains a different model string for Google SDK payloads
    if (options && options.body && typeof options.body === 'string') {
        const bodyStr = options.body;
        if (bodyStr.includes('"model":"models/gemini-') || bodyStr.includes('"model": "models/gemini-')) {
             if (!bodyStr.includes('gemini-2.5-flash-lite')) {
                const errMsg = `🛑 SECURITY BAN: Încercare de utilizare a modelului greșit în corpul request-ului Google SDK! 
Corpul conține modelul interzis. Permis doar: gemini-2.5-flash-lite`;
                console.error(errMsg);
                throw new Error(errMsg);
             }
        }
    }

    // Call the original fetch if everything is clean
    return originalFetch.apply(this, arguments);
};

console.log("🔒 [Security] Global Gemini Model BAN enforced! Only 'gemini-2.5-flash-lite' is permitted.");
