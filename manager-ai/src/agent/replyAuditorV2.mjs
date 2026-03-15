import { callLocalLLM } from '../llm/client.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogPath = path.resolve(__dirname, '../../service-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

/**
 * Validates the generated reply for hallucinations, unauthorized offers, and logic breaks.
 * @param {Object} context - { replyText, activeService, draft, nextBestAction }
 * @returns {Promise<{ is_safe: boolean, reason: string, handoff_recommended: boolean }>}
 */
export async function auditReplyV2(context) {
    const { replyText, activeService, draft, nextBestAction } = context;

    const safeDraft = draft ? JSON.stringify(draft) : '{}';
    const serviceContext = activeService && catalog.services[activeService] ? catalog.services[activeService] : null;
    const allowedPriceInfo = serviceContext ? JSON.stringify(serviceContext.base_pricing) : 'Niciun preț sau serviciu fixat momentan.';

    const systemPrompt = `
Ești un Auditor Strict de Siguranță AI pentru un agent de vânzări (Superparty).
Trebuie să verifici dacă DRAFT-UL DE RĂSPUNS PROPUS respectă TOATE regulile comerciale și nu inventează date.

DRAFT-UL DE RĂSPUNS PROPUS SPRE EVALUARE:
"""${replyText}"""

CONTEXT CURENT AL LEAD-ULUI:
- Serviciu Discutat: ${activeService || 'Nesetat / Generic'}
- Party Draft (Datele extrase din conversație): ${safeDraft}
- Costuri Oficiale Permise / Catalog: ${allowedPriceInfo}
- Acțiune Generică Setată V1: ${nextBestAction}

REGULI CRITICE (TOLERANȚĂ ZERO):
1. INVENTARE PREȚURI: Dacă mesajul menționează un preț clar (ex. 500 RON, 400 lei) sau face o "ofertă", acesta TREBUIE să fie justificat fie de 'Costuri Oficiale', fie de cantitățile din Party Draft. Nu are voie să inventeze reduceri (ex. '10% discount'). 
2. INVENTARE SERVICII: Nu promite servicii inexistente, gratuități inventate, sau disponibilitate garantată (se folosesc formule ca "verific disponibilitatea", "suntem liberi de principiu", nu "gata, am rezervat", dacă draft-ul e imatur).
3. IGNORARE DATE LIPSĂ: Dacă se observă o tentativă clară de a ignora lipsa de date esențiale oferind un preț din imaginație, pici auditul.
4. TON EXTREM SAU NEPOLITICOS: Trebuie să fie cald, politicos.

TREBUIE să returnezi STRICT un obiect JSON (fără alte explicații Markdown):
{
  "is_safe": true/false,
  "reason": "Explicație Scurtă DE CE a picat sau de ce a trecut.",
  "handoff_recommended": true/false
}
    `;

    try {
        const auditResult = await callLocalLLM(systemPrompt, "Evaluează DRAFT-UL DE RĂSPUNS PROPUS și returnează decizia în JSON conform schemei cerute.");
        
        if (!auditResult) {
            // Failsafe: if LLM fails, we block to be safe.
             return { is_safe: false, reason: "LLM Audit API Timeout/Error. Failsafe Block.", handoff_recommended: false };
        }

        return {
            is_safe: auditResult.is_safe ?? false,
            reason: auditResult.reason || 'No specific explanation provided by Auditor.',
            handoff_recommended: auditResult.handoff_recommended ?? false
        };
    } catch (e) {
        console.error('[ReplyAuditorV2] Error:', e.message);
        return { is_safe: false, reason: "Error auditing structure: " + e.message, handoff_recommended: false };
    }
}
