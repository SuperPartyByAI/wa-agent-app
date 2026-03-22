import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHTSUP_API_URL, WHTSUP_API_KEY } from '../config/env.mjs';
import { evaluateFollowUp, getFollowUpStrategy, FOLLOWUP_TYPES } from '../agent/followUpEngine.mjs';
import { callLocalLLMText } from '../llm/client.mjs';
import { saveLeadRuntimeState } from '../agent/saveLeadRuntimeState.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Send a message via WhatsApp (duplicating minimal logic from processConversation)
 */
async function sendViaWhatsApp(conversationId, text) {
    const { data: conv } = await supabase.from('conversations').select('session_id').eq('id', conversationId).single();
    if (!conv?.session_id) return false;

    let retries = 3;
    while (retries > 0) {
        try {
            const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': WHTSUP_API_KEY },
                body: JSON.stringify({
                    sessionId: conv.session_id,
                    conversationId: conversationId,
                    text: text,
                    message_type: 'text'
                })
            });
            if (response.ok) return true;
            console.error(`[FollowUpJob] Send attempt failed (${3 - retries + 1}/3) Server returned ${response.status}`);
        } catch(e) {
            console.error(`[FollowUpJob] Failed to send message for ${conversationId} (${3 - retries + 1}/3):`, e.message);
        }
        retries--;
        if (retries > 0) await new Promise(r => setTimeout(r, 2000));
    }
    return false;
}

/**
 * Generate Follow-up Text using LLM.
 */
async function generateFollowUpMessage(runtimeState, followUpType) {
    const strategyInstruction = getFollowUpStrategy(followUpType);
    
    // Fetch PartyDraft for context
    const { data: draftData } = await supabase.from('party_drafts').select('party_data').eq('conversation_id', runtimeState.conversation_id).maybeSingle();
    let draftContext = "No specific details known.";
    if (draftData?.party_data) {
        draftContext = JSON.stringify(draftData.party_data);
    }

    const systemPrompt = `
Ești agentul comercial autonom Superparty (vânzător de servicii pentru evenimente).
Rolul tău actual este STRICT să scrii un mesaj de FOLLOW-UP către un client.

CONTEXTUL CLIENTULUI:
- Stare Curentă: ${runtimeState.lead_state}
- Serviciu Principal: ${runtimeState.primary_service || 'Necunoscut'}
- Detalii Eveniment (Party Draft): ${draftContext}

DIRECTIVA DE FOLLOW-UP (Obligatorie):
${strategyInstruction}

REGULI CRITICE:
1. NU inventa reduceri de preț sau oferte care nu există.
2. NU confirma nicio rezervare și NU promite disponibilitate.
3. Fii extrem de concis (maxim 2-3 fraze).
4. Păstrează tonul cald și prietenos.
5. NU răspunde la întrebări (clientul tace, tu inițiezi). Doar aplică directiva.

Scrie doar textul final al mesajului, fără alte explicații sau metadate în răspuns.
`;

    try {
        const text = await callLocalLLMText(systemPrompt, "Te rog generează textul mesajului de follow-up conform directivei de mai sus.");
        return text || null;
    } catch(err) {
        console.error(`[FollowUpJob] LLM Generation failed:`, err);
        return null;
    }
}

/**
 * Main Run Definition
 */
export async function runFollowUpSweep() {
    console.log(`[FollowUpJob] Starting sweep at ${new Date().toISOString()}`);

    // Fetch eligible leads that have a past due_at
    const nowISO = new Date().toISOString();
    
    const { data: eligibleLeads, error } = await supabase
        .from('ai_lead_runtime_states')
        .select('*')
        .lte('follow_up_due_at', nowISO)
        .in('followup_status', ['pending', 'sent_1'])
        .in('closed_status', ['open'])
        .eq('handoff_to_operator', false)
        .eq('do_not_followup', false)
        .eq('human_takeover', false);

    if (error) {
        console.error(`[FollowUpJob] DB Error fetching leads:`, error.message);
        return;
    }

    if (!eligibleLeads || eligibleLeads.length === 0) {
        console.log(`[FollowUpJob] No pending follow-ups found.`);
        return;
    }

    console.log(`[FollowUpJob] Found ${eligibleLeads.length} leads potentially needing follow-up.`);

    for (const lead of eligibleLeads) {
        // Evaluate logic layer
        const followUpAction = evaluateFollowUp(lead);
        
        // Anti-double execution guard (Idempotency: Block sending if it was already sent in the last 60 minutes)
        if (lead.last_followup_sent_at && Date.now() - new Date(lead.last_followup_sent_at).getTime() < 60 * 60 * 1000) {
             console.log(`[FollowUpJob] Skip lead ${lead.conversation_id}: Follow-up already sent recently.`);
             continue;
        }

        if (!followUpAction) {
            console.log(`[FollowUpJob] Lead ${lead.conversation_id} skip: Logic evaluated as NULL.`);
            continue;
        }

        if (followUpAction === 'ABANDON_LEAD') {
            console.log(`[FollowUpJob] ABANDONING Lead ${lead.conversation_id} (max followups reached).`);
            await saveLeadRuntimeState(lead.conversation_id, {
                closed_status: 'abandoned',
                closed_at: new Date().toISOString(),
                followup_status: 'stopped'
            });
            continue;
        }

        console.log(`[FollowUpJob] Lead ${lead.conversation_id} -> Executing ${followUpAction}`);
        
        // Generate message
        const textToSend = await generateFollowUpMessage(lead, followUpAction);
        if (!textToSend) continue;

        // Send WhatsApp
        const sent = await sendViaWhatsApp(lead.conversation_id, textToSend);
        if (sent) {
            console.log(`[FollowUpJob] Sent successfully to ${lead.conversation_id}`);
            
            // Increment Count
            const newCount = (lead.followup_count || 0) + 1;
            
            // Re-schedule for 72h later if this was the first!
            let newDueAt = null;
            let newStatus = `sent_${newCount}`;
            
            if (newCount === 1) {
                const due = new Date();
                due.setHours(due.getHours() + 72);
                newDueAt = due.toISOString();
                newStatus = 'sent_1';
            } else {
                newStatus = 'sent_2'; // No further automatic followups planned, next sweep will ABANDON
                const dueFinal = new Date();
                dueFinal.setHours(dueFinal.getHours() + 24); // Give them 24h to answer before abandoning
                newDueAt = dueFinal.toISOString();
            }

            await saveLeadRuntimeState(lead.conversation_id, {
                followup_count: newCount,
                followup_status: newStatus,
                last_followup_sent_at: new Date().toISOString(),
                follow_up_due_at: newDueAt
            });
            
            // Insert audit into messages Table
            await supabase.from('messages').insert({
                conversation_id: lead.conversation_id,
                content: textToSend,
                direction: 'outbound',
                sender_type: 'ai',
                metadata: { is_followup: true, type: followUpAction }
            });

        } else {
            console.error(`[FollowUpJob] Failed sending API request for ${lead.conversation_id}`);
        }
    }
    
    console.log(`[FollowUpJob] Sweep complete.`);
}

// In case it's run via PM2 script standalone:
if (process.argv[1] && process.argv[1].endsWith('followUpJob.mjs')) {
    runFollowUpSweep().then(() => process.exit(0)).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
