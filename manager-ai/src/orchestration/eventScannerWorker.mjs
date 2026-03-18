/**
 * eventScannerWorker.mjs — Scanează TOATE conversațiile recente 
 * și notează/actualizează/anulează petrecerile detectate de AI.
 * 
 * Funcționalități:
 *   - CREEAZĂ petreceri noi din conversații
 *   - ACTUALIZEAZĂ petreceri existente cu detalii noi
 *   - ANULEAZĂ petreceri dacă clientul renunță (cu motiv)
 *   - Detectează MOTIVUL anulării din conversație
 * 
 * Usage:
 *   node eventScannerWorker.mjs           # loop la fiecare 24h
 *   node eventScannerWorker.mjs --once    # o singură scanare
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// ─── Config ───
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERTEX_SUPABASE_URL = process.env.VERTEX_SUPABASE_URL;
const VERTEX_SUPABASE_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const vertexDb = VERTEX_SUPABASE_URL && VERTEX_SUPABASE_KEY
    ? createClient(VERTEX_SUPABASE_URL, VERTEX_SUPABASE_KEY)
    : null;

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const LOOKBACK_HOURS = 48;
const MAX_CONVS_PER_SCAN = 50;

const log = (msg) => console.log(`[EventScanner] ${msg}`);
const logErr = (msg, err) => console.error(`[EventScanner] ${msg}`, err?.message || err);

// Filter out test/fake phone numbers
const isTestPhone = (phone) => {
    if (!phone) return true;
    if (phone.startsWith('+40700')) return true;
    if (/FIX|PROOF|LIVE|TEST|DEMO/i.test(phone)) return true;
    return false;
};

// ─── Gemini Tools (Multi-Role CRM) ───
const SCANNER_TOOLS = [{
    functionDeclarations: [
        {
            name: 'noteaza_roluri',
            description: 'Creează TOATE rolurile/serviciile detectate în conversație. Fiecare personaj, fiecare serviciu separat = un rol separat. Returnează un array cu TOATE rolurile din petrecere.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    detalii_comune: {
                        type: 'OBJECT',
                        description: 'Detalii comune întregii petreceri',
                        properties: {
                            'Data Evenimentului': { type: 'STRING' },
                            'Ora de Început': { type: 'STRING' },
                            'Locația': { type: 'STRING' },
                            'Nume Sărbătorit': { type: 'STRING' },
                            'Vârstă Sărbătorit': { type: 'STRING' },
                            'Număr Copii': { type: 'STRING' }
                        }
                    },
                    roluri: {
                        type: 'ARRAY',
                        description: 'Lista cu TOATE rolurile/serviciile. FIECARE personaj separat = un element. FIECARE serviciu separat = un element.',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                tip_serviciu: { type: 'STRING', description: 'Tipul: Animație, Vată de Zahăr, Popcorn, Candy Bar, Tort de Dulciuri, Decorațiuni, Fotograf, DJ, Ursitoare etc' },
                                personaj: { type: 'STRING', description: 'Numele personajului dacă e animație (Peppa Pig, Elsa, Mickey etc). Gol pentru vată/popcorn/etc.' },
                                durata_ore: { type: 'NUMBER', description: 'Durata în ore. Ursitoare = 1 oră AUTOMAT. Dacă nu e specificat, lasă 0.' },
                                pret: { type: 'NUMBER', description: 'Preț individual dacă s-a menționat, altfel 0' },
                                note: { type: 'STRING', description: 'Note: dacă e ambiguu (ex: simultan sau consecutiv?), scrie aici explicit' }
                            },
                            required: ['tip_serviciu']
                        }
                    },
                    total_amount: { type: 'NUMBER', description: 'Preț TOTAL petrecere dacă s-a menționat' },
                    notes: { type: 'STRING', description: 'Note generale petrecere' }
                },
                required: ['roluri']
            }
        },
        {
            name: 'actualizeaza_petrecere',
            description: 'Actualizează detaliile unei petreceri EXISTENTE. Folosește când clientul schimbă data, ora, locația, personajul, sau alte detalii ale unei petreceri deja notate.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    updated_fields: {
                        type: 'OBJECT',
                        description: 'Câmpurile actualizate',
                        properties: {
                            'Data Evenimentului': { type: 'STRING' },
                            'Ora de Început': { type: 'STRING' },
                            'Locația': { type: 'STRING' },
                            'Personajul Dorit': { type: 'STRING' },
                            'Număr Copii': { type: 'STRING' },
                            'Durata (ore)': { type: 'STRING' },
                            'Nume Sărbătorit': { type: 'STRING' },
                            'Vârstă Sărbătorit': { type: 'STRING' }
                        }
                    },
                    total_amount: { type: 'NUMBER', description: 'Preț nou dacă s-a schimbat' },
                    notes: { type: 'STRING', description: 'Ce s-a schimbat și de ce' }
                },
                required: ['updated_fields']
            }
        },
        {
            name: 'anuleaza_petrecere',
            description: 'Anulează o petrecere existentă. Folosește când clientul RENUNȚĂ la petrecere.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    motiv_anulare: { type: 'STRING', description: 'Motivul EXACT pentru care clientul anulează.' },
                    notes: { type: 'STRING', description: 'Context suplimentar' }
                },
                required: ['motiv_anulare']
            }
        },
        {
            name: 'nu_este_petrecere',
            description: 'Conversația NU conține o cerere de petrecere/eveniment.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    motiv: { type: 'STRING', description: 'De ce nu e petrecere' }
                },
                required: ['motiv']
            }
        },
        {
            name: 'petrecere_ok',
            description: 'Petrecerea existentă e corect notată, nu trebuie schimbat nimic.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    observatii: { type: 'STRING', description: 'Observații opționale' }
                }
            }
        }
    ]
}];

// ─── System Prompt ───
function buildSystemPrompt(existingEvents) {
    const base = `Ești un analist CRM pentru firma Superparty (servicii de petreceri: animatori, candy bar, decorațiuni, fotografi, DJ etc).

SARCINA TA: Citește conversația și extrage TOATE serviciile/rolurile cerute.

═══════════════════════════════════════
REGULI FUNDAMENTALE PENTRU ROLURI:
═══════════════════════════════════════

1. FIECARE PERSONAJ = UN ROL SEPARAT
   - "Vreau Elsa și Anna" → 2 roluri de Animație (Elsa + Anna)
   - "3 ursitoare bune și 1 rea" → 4 roluri de Animație
   
2. FIECARE SERVICIU = UN ROL SEPARAT
   - "Vreau animație, vată de zahăr și popcorn" → minim 3 roluri
   - Animație, Vată de Zahăr, Popcorn = 3 roluri diferite

3. URSITOARE = UN SINGUR SPECTACOL (mereu 1 oră)
   - Ursitoarele sunt un SHOW COMPLET, nu animatori individuali
   - "3 ursitoare bune" = 1 SINGUR ROL: tip_serviciu="Ursitoare", personaj="3 Ursitoare Bune", durata_ore=1
   - "3 ursitoare bune + 1 rea" = 1 SINGUR ROL: tip_serviciu="Ursitoare", personaj="3 Bune + 1 Rea", durata_ore=1
   - NU crea roluri separate per ursitoare! E un singur spectacol.

4. VATĂ + POPCORN — ATENȚIE LA OPERATORI:
   - Dacă clientul vrea 2h vată ȘI 2h popcorn pe ACELAȘI interval → 2 operatori separați → 2 roluri separate
   - Dacă vată și popcorn sunt CONSECUTIVE (ex: 1h vată apoi 1h popcorn) → 1 operator → 1 rol combinat "Vată + Popcorn"
   - Dacă e AMBIGUU (clientul zice "2 ore cu vată și popcorn" fără a preciza) → creează rolurile SEPARATE dar adaugă notă: "⚠️ De clarificat: simultan (2 operatori) sau consecutiv (1 operator)?"

5. EXTRAGE TOATE DETALIILE MENȚIONATE
   - Dată, oră, locație, sărbătorit, vârstă, copii = COMUNE întregii petreceri
   - Personaj, durată = SPECIFICE fiecărui rol
   - Dacă un detaliu nu e menționat, NU-l inventa`;  

    if (existingEvents && existingEvents.length > 0) {
        const evtList = existingEvents.map((e, i) => 
            `${i+1}. ${e.role_title} | ${e.event_details?.['Personajul Dorit'] || '?'} | ${e.event_details?.['Durata (ore)'] || '?'}h | ${e.status}`
        ).join('\n');
        
        return `${base}

═══════════════════════════════════════
EVENIMENTE DEJA NOTATE PENTRU ACEST CLIENT:
═══════════════════════════════════════
${evtList}

REGULI SUPLIMENTARE:
1. Dacă clientul ANULEAZĂ → anuleaza_petrecere cu MOTIVUL EXACT
2. Dacă clientul SCHIMBĂ detalii → actualizeaza_petrecere
3. Dacă totul e OK → petrecere_ok
4. Dacă clientul cere SERVICII NOI care NU sunt în lista de mai sus → noteaza_roluri cu rolurile NOI
5. APELEAZĂ OBLIGATORIU o funcție. Nu răspunde cu text.`;
    }

    return `${base}

═══════════════════════════════════════
CE TREBUIE SĂ FACI:
═══════════════════════════════════════
1. Dacă clientul vrea petrecere → apelează noteaza_roluri cu TOATE rolurile din conversație
2. Dacă NU e petrecere → apelează nu_este_petrecere
3. APELEAZĂ OBLIGATORIU o funcție. Nu răspunde cu text.

EXEMPLE:

"Vreau 2 animatori Peppa și Mickey, 2h vată de zahăr" →
noteaza_roluri cu 3 roluri:
  - Animație: Peppa Pig (durată din conversație)
  - Animație: Mickey Mouse (durată din conversație)  
  - Vată de Zahăr: 2 ore

"Vreau 3 ursitoare bune, 1 rea, și popcorn 2 ore" →
noteaza_roluri cu 2 roluri:
  - Ursitoare: 3 Bune + 1 Rea (1 oră auto — e un singur spectacol)
  - Popcorn: 2 ore`;
}

// ─── Gemini Call ───
async function callGeminiForScan(transcript, existingEvents) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const body = {
        contents: [{ role: 'user', parts: [{ text: transcript }] }],
        systemInstruction: { role: 'system', parts: [{ text: buildSystemPrompt(existingEvents) }] },
        tools: SCANNER_TOOLS,
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeout);
        
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini HTTP ${res.status}: ${errText.substring(0, 200)}`);
        }
        
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const fc = parts.find(p => p.functionCall);
        return fc?.functionCall || null;
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// ─── DB Actions ───
async function saveEvent(phoneE164, args) {
    if (!vertexDb) { log('No Vertex DB!'); return false; }
    
    // DEDUP CHECK: Don't create if same phone + role_title + personaj already exists as active
    const personaj = args.event_details?.['Personajul Dorit'] || '';
    const roleTitle = args.role_title || 'Animație';
    
    let query = vertexDb.from('client_events')
        .select('id, event_details')
        .eq('client_phone', phoneE164)
        .eq('role_title', roleTitle)
        .eq('status', 'active');
    
    const { data: existing } = await query;
    
    // Check for matching personaj (character) too
    const match = (existing || []).find(e => {
        const existingPersonaj = e.event_details?.['Personajul Dorit'] || '';
        return existingPersonaj === personaj;
    });
    
    if (match) {
        // Update existing instead of creating duplicate
        const mergedDetails = { ...(match.event_details || {}), ...(args.event_details || {}) };
        const updateObj = { event_details: mergedDetails, updated_at: new Date().toISOString() };
        if (args.total_amount) updateObj.total_amount = args.total_amount;
        if (args.notes) updateObj.notes = args.notes;
        
        const { error } = await vertexDb.from('client_events')
            .update(updateObj).eq('id', match.id);
        
        if (error) { logErr('Dedup update error', error); return false; }
        log(`♻️ DEDUP: ${roleTitle}${personaj ? ' → ' + personaj : ''} deja există (${match.id.substring(0,8)}), actualizat`);
        return true;
    }
    
    const { data, error } = await vertexDb.from('client_events').insert({
        client_phone: phoneE164,
        role_title: roleTitle,
        event_details: args.event_details || {},
        total_amount: args.total_amount || 0,
        notes: args.notes || '',
        status: 'active',
        event_status: 'new'
    }).select().single();
    
    if (error) { logErr('Insert error', error); return false; }
    log(`✅ CREAT: ${data.id} (${roleTitle}) pentru ${phoneE164}`);
    return true;
}

async function updateEvent(eventId, phoneE164, args) {
    if (!vertexDb) return false;
    
    // Merge existing event_details with updated fields
    const { data: existing } = await vertexDb.from('client_events')
        .select('event_details').eq('id', eventId).single();
    
    const mergedDetails = { ...(existing?.event_details || {}), ...(args.updated_fields || {}) };
    
    const updateObj = {
        event_details: mergedDetails,
        updated_at: new Date().toISOString()
    };
    if (args.total_amount) updateObj.total_amount = args.total_amount;
    if (args.notes) updateObj.notes = args.notes;
    
    const { error } = await vertexDb.from('client_events')
        .update(updateObj).eq('id', eventId);
    
    if (error) { logErr('Update error', error); return false; }
    log(`📝 ACTUALIZAT: ${eventId} pentru ${phoneE164} — ${args.notes || 'câmpuri actualizate'}`);
    return true;
}

async function cancelEvent(eventId, phoneE164, args) {
    if (!vertexDb) return false;
    
    const { error } = await vertexDb.from('client_events').update({
        status: 'cancelled',
        event_status: 'cancelled',
        notes: `ANULAT: ${args.motiv_anulare}${args.notes ? '\n' + args.notes : ''}`,
        updated_at: new Date().toISOString()
    }).eq('id', eventId);
    
    if (error) { logErr('Cancel error', error); return false; }
    log(`❌ ANULAT: ${eventId} pentru ${phoneE164} — Motiv: ${args.motiv_anulare}`);
    return true;
}

// ─── Main Scan Logic ───
async function scanConversations() {
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600000).toISOString();
    log(`Scanare conversații din ultimele ${LOOKBACK_HOURS}h (din ${cutoff})...`);
    
    // 1. Get recent conversations
    const { data: recentConvs, error: convErr } = await supabase
        .from('conversations')
        .select('id, client_id, session_id, updated_at')
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: false })
        .limit(MAX_CONVS_PER_SCAN);
    
    if (convErr) { logErr('Conversations query error', convErr); return; }
    if (!recentConvs || recentConvs.length === 0) { log('Nicio conversație recentă.'); return; }
    log(`Găsite ${recentConvs.length} conversații recente.`);
    
    // 2. Get client phones
    const clientIds = [...new Set(recentConvs.map(c => c.client_id).filter(Boolean))];
    const { data: clients } = await supabase
        .from('clients')
        .select('id, real_phone_e164')
        .in('id', clientIds);
    const phoneMap = {};
    (clients || []).forEach(c => { phoneMap[c.id] = c.real_phone_e164; });
    
    // 3. Get ALL events (active AND cancelled) for these phones
    const knownPhones = Object.values(phoneMap).filter(Boolean);
    const eventsByPhone = {};
    if (vertexDb && knownPhones.length > 0) {
        const { data: events } = await vertexDb.from('client_events')
            .select('*')
            .in('client_phone', knownPhones)
            .order('created_at', { ascending: false });
        (events || []).forEach(e => {
            if (!eventsByPhone[e.client_phone]) eventsByPhone[e.client_phone] = [];
            eventsByPhone[e.client_phone].push(e);
        });
    }
    
    let stats = { scanned: 0, created: 0, updated: 0, cancelled: 0, noParty: 0, ok: 0, skipped: 0 };
    
    for (const conv of recentConvs) {
        const phone = phoneMap[conv.client_id];
        if (!phone || isTestPhone(phone)) { stats.skipped++; continue; }
        
        // Get ALL events for this phone (not just first active)
        const clientEvents = eventsByPhone[phone] || [];
        const activeEvents = clientEvents.filter(e => e.status === 'active');
        
        // 4. Load messages
        const { data: msgs } = await supabase
            .from('messages')
            .select('content, direction, sender_type, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true })
            .limit(60);
        
        if (!msgs || msgs.length < 2) { stats.skipped++; continue; }
        
        // Build transcript
        const transcript = msgs.map(m => 
            `[${m.sender_type === 'agent' ? 'Superparty' : 'Client'}]: ${m.content || ''}`
        ).join('\n');
        
        // 5. Call Gemini
        try {
            stats.scanned++;
            const hasEvents = activeEvents.length > 0 ? `(${activeEvents.length} roluri notate)` : '(fără evenimente)';
            log(`Analizez conv ${conv.id.substring(0, 8)}... (${msgs.length} msg, ${phone.substring(0, 6)}*** ${hasEvents})`);
            
            const result = await callGeminiForScan(transcript, activeEvents.length > 0 ? activeEvents : null);
            
            if (!result) {
                log(`  → Gemini nu a returnat function call`);
                continue;
            }
            
            switch (result.name) {
                case 'noteaza_roluri': {
                    const args = result.args || {};
                    const roluri = args.roluri || [];
                    const detaliiComune = args.detalii_comune || {};
                    
                    if (roluri.length === 0) {
                        log(`  → noteaza_roluri fără roluri`);
                        break;
                    }
                    
                    log(`  → ${roluri.length} rol(uri) detectat(e)`);
                    
                    for (const rol of roluri) {
                        const eventDetails = {
                            ...detaliiComune,
                            'Personajul Dorit': rol.personaj || '',
                            'Durata (ore)': rol.durata_ore ? String(rol.durata_ore) : ''
                        };
                        
                        const saved = await saveEvent(phone, {
                            role_title: rol.tip_serviciu || 'Animație',
                            event_details: eventDetails,
                            total_amount: rol.pret || 0,
                            notes: rol.note || args.notes || ''
                        });
                        if (saved) {
                            stats.created++;
                            log(`    ✅ Rol: ${rol.tip_serviciu} ${rol.personaj ? '→ ' + rol.personaj : ''} (${rol.durata_ore || '?'}h)`);
                        }
                    }
                    break;
                }
                    
                case 'actualizeaza_petrecere':
                    if (activeEvents.length > 0) {
                        const updated = await updateEvent(activeEvents[0].id, phone, result.args || {});
                        if (updated) stats.updated++;
                    } else {
                        log(`  → Nu există eveniment de actualizat`);
                    }
                    break;
                    
                case 'anuleaza_petrecere':
                    if (activeEvents.length > 0) {
                        for (const evt of activeEvents) {
                            const cancelled = await cancelEvent(evt.id, phone, result.args || {});
                            if (cancelled) stats.cancelled++;
                        }
                    } else {
                        log(`  → Nu există eveniment de anulat`);
                    }
                    break;
                    
                case 'nu_este_petrecere':
                    stats.noParty++;
                    log(`  → Nu e petrecere: ${result.args?.motiv || 'fără motiv'}`);
                    break;
                    
                case 'petrecere_ok':
                    stats.ok++;
                    log(`  → Petrecere OK: ${result.args?.observatii || 'totul e corect'}`);
                    break;
            }
            
            // Rate limit
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            logErr(`  → Eroare la conv ${conv.id.substring(0, 8)}`, err);
        }
    }
    
    log(`📊 Scanare completă: ${stats.scanned} analizate, ${stats.created} create, ${stats.updated} actualizate, ${stats.cancelled} anulate, ${stats.ok} OK, ${stats.noParty} non-petreceri, ${stats.skipped} skip`);
}

// ─── Runner ───
const isOnce = process.argv.includes('--once');

async function run() {
    log(`Pornit (mode=${isOnce ? 'once' : 'loop'}, interval=${SCAN_INTERVAL_MS / 1000}s)`);
    
    if (isOnce) {
        await scanConversations();
        return;
    }
    
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await scanConversations();
        } catch (err) {
            logErr('Loop error', err);
        }
        await new Promise(r => setTimeout(r, SCAN_INTERVAL_MS));
    }
}

run().catch(err => { logErr('Fatal', err); process.exit(1); });
