const fs = require('fs');
const filepath = '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/src/vertex/vertexClient.mjs';
let code = fs.readFileSync(filepath, 'utf-8');

// 1. Inlocuiesc VERTEX_TOOLS fix cu o functie dinamica
code = code.replace(/const VERTEX_TOOLS = \[\s*\{\s*functionDeclarations: \[[\s\S]*?\}\s*\];\n/m, `
function getVertexTools(cfg) {
    return [
        {
            functionDeclarations: [
                {
                    name: 'noteaza_petrecere',
                    description: cfg.tool_desc_noteaza_petrecere || 'Creează un serviciu nou pentru o petrecere.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            role_title: { type: 'STRING', description: 'Tipul serviciului: Animație, Ursitoare etc.' },
                            event_details: {
                                type: 'OBJECT',
                                description: 'Detaliile specifice',
                                properties: {
                                    'Data Evenimentului': { type: 'STRING', description: 'Data petrecerii. INCLUDE ANUL' },
                                    'Ora de Început': { type: 'STRING' },
                                    'Locația': { type: 'STRING' },
                                    'Personajul Dorit': { type: 'STRING' },
                                    'Număr Copii': { type: 'STRING' },
                                    'Durata (ore)': { type: 'STRING' },
                                    'Nume Sărbătorit': { type: 'STRING' },
                                    'Vârstă Sărbătorit': { type: 'STRING' }
                                }
                            },
                            data_rezervarii_iso: { type: 'STRING' },
                            total_amount: { type: 'NUMBER' },
                            notes: { type: 'STRING' }
                        },
                        required: ['role_title']
                    }
                },
                {
                    name: 'actualizeaza_petrecere',
                    description: cfg.tool_desc_actualizeaza_petrecere || 'Modifică detalii',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            event_id: { type: 'STRING' },
                            event_details: { type: 'OBJECT' },
                            total_amount: { type: 'NUMBER' },
                            notes: { type: 'STRING' }
                        },
                        required: ['event_id']
                    }
                },
                {
                    name: 'anuleaza_petrecere',
                    description: cfg.tool_desc_anuleaza_petrecere || 'Anulează un eveniment',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            event_id: { type: 'STRING' },
                            motiv: { type: 'STRING' }
                        },
                        required: ['event_id']
                    }
                },
                {
                    name: 'restaureaza_petrecere',
                    description: cfg.tool_desc_restaureaza_petrecere || 'Restaurează',
                    parameters: {
                        type: 'OBJECT',
                        properties: { event_id: { type: 'STRING' } },
                        required: ['event_id']
                    }
                },
                {
                    name: 'cauta_petreceri',
                    description: cfg.tool_desc_cauta_petreceri || 'Caută toate petrecerile',
                    parameters: {
                        type: 'OBJECT',
                        properties: { status_filter: { type: 'STRING' } }
                    }
                },
                {
                    name: 'escaleaza_la_operator',
                    description: cfg.tool_desc_escaleaza || 'Escaleaza la om',
                    parameters: {
                        type: 'OBJECT',
                        properties: { motiv: { type: 'STRING' } },
                        required: ['motiv']
                    }
                }
            ]
        }
    ];
}
`);

// 2. Inlocuiesc loadSystemPrompt cu loadVertexConfig
code = code.replace(/let cachedSystemPrompt[\s\S]*?return cachedSystemPrompt \|\| 'Ești asistentul virtual Superparty\.';\n    \}\n\}/m, `
let cachedConfig = {};
let configLastLoaded = 0;
const CONFIG_CACHE_MS = 60_000;

async function loadVertexConfig() {
    if (Date.now() - configLastLoaded < CONFIG_CACHE_MS && Object.keys(cachedConfig).length > 0) {
        return cachedConfig;
    }
    if (!vertexDb) return {};
    try {
        const { data } = await vertexDb.from('vertex_config').select('config_key, config_value').eq('brand_key', 'GLOBAL');
        const newCfg = {};
        (data || []).forEach(row => newCfg[row.config_key] = row.config_value);
        cachedConfig = newCfg;
        configLastLoaded = Date.now();
        return cachedConfig;
    } catch (e) {
        console.error('[VertexAI] Failed to load config:', e.message);
        return cachedConfig;
    }
}

async function loadSystemPrompt() {
    const cfg = await loadVertexConfig();
    return cfg.system_prompt || 'Ești asistentul virtual Superparty.';
}
`);

// 3. Injectez cfg in procesWithVertexAI
code = code.replace(/export async function processWithVertexAI\(phoneE164, userMessageText, options = \{\}\) \{/m, `
export async function processWithVertexAI(phoneE164, userMessageText, options = {}) {
    const cfg = await loadVertexConfig();
    options.cfg = cfg;
`);

// 4. Modific callVertexAI
code = code.replace(/async function callVertexAI\(sessionMessages, options = \{\}\) \{[\s\S]*?const systemPrompt = await loadSystemPrompt\(\);/m, `
async function callVertexAI(sessionMessages, options = {}) {
    const cfg = options.cfg || await loadVertexConfig();
    const systemPrompt = cfg.system_prompt || 'Ești asistentul virtual Superparty.';
`);

code = code.replace(/body\.tools = VERTEX_TOOLS;/g, 'body.tools = getVertexTools(cfg);');

code = code.replace(/REGULĂ CRITICĂ:[\s\S]*?confirmarea actualizării\./m, `\${cfg.prompt_rule_event_context || 'REGULĂ CRITICĂ: Evita duplicarea eventurilor anulate. Folosește actualizeaza_petrecere.'}`);

// 5. Continutarile (Continuation Prompts)
code = code.replace(/continuationPrompt = `IMPORTANT: Clientul vrea să ANULEZE\.[\s\S]*?`IMPORTANT: Clientul a cerut: "\$\{userMessageText\}"\. Petrecerea are event_id="\$\{eventId\}"\. Apelează ACUM actualizeaza_petrecere[\s\S]*?Fără tool!`\s*\}\s*\}/m, `
            if (msg.includes('anulez') || msg.includes('renunt')) {
                continuationPrompt = (cfg.prompt_continuation_anuleaza || '').replace('{EVENT_ID}', eventId);
            } else if (msg.includes('reactivez') || msg.includes('restaur') || msg.includes('razgandit')) {
                continuationPrompt = (cfg.prompt_continuation_reactivare || '').replace('{EVENT_ID}', eventId);
            } else {
                continuationPrompt = (cfg.prompt_continuation_actualizare || '').replace('{EVENT_ID}', eventId).replace('{USER_MSG}', userMessageText);
            }
        }`);

code = code.replace(/let continuationPrompt = 'Continuă\. Dacă trebuie altă acțiune, fă-o acum cu tool-ul corespunzător\. Dacă ai terminat, confirmă clientului\.';/m, `
        let continuationPrompt = cfg.prompt_continuation_default || 'Continuă apelurile';
`);

fs.writeFileSync(filepath, code);
console.log("Fișier rescris cu succes!");
