import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString(); // For body parser if needed elsewhere, but we handled it in the route
    }
}));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Webhook inside from whts-up (WhatsApp transport)
app.post('/webhook/whts-up', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature'];
        const webhookSecret = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';
        
        if (!signature) {
            console.warn('[Webhook security] Missing signature');
            return res.status(401).json({ error: 'Missing signature' });
        }
        
        const hash = `sha256=${crypto.createHmac('sha256', webhookSecret).update(req.body).digest('hex')}`;
        
        if (hash !== signature) {
            console.warn('[Webhook security] Invalid signature');
            return res.status(403).json({ error: 'Invalid signature' });
        }
        
        const payload = JSON.parse(req.body.toString());
        const { message_id, conversation_id, content, sender_type } = payload;
        console.log(`[Webhook MSG] Received verified msg ${message_id} for conv ${conversation_id} from ${sender_type}`);
        
        // Idempotency check: see if we already have this message processed
        const { data: stateData } = await supabase
            .from('ai_conversation_state')
            .select('last_processed_message_id')
            .eq('conversation_id', conversation_id)
            .maybeSingle();
            
        if (stateData && stateData.last_processed_message_id === message_id) {
             console.log(`[Webhook MSG] Idempotency catch: Msg ${message_id} already processed. Skipping.`);
             return res.status(200).json({ status: 'already_processed' });
        }
        
        // Return 200 immediately to not block WhatsApp
        res.status(200).json({ status: 'queued' });
        
        // Abstracting to Worker logic with message_id to track last processed
        processConversation(conversation_id, message_id).catch(console.error);
    } catch (e) {
        console.error('[Webhook error]', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint for Android app to fetch dynamic UI schema (Brain AI tab)
app.get('/api/ai/conversation/:conversation_id/schema', async (req, res) => {
    const { conversation_id } = req.params;
    
    // Fetch the latest generated schema for this conversation
    const { data: schemaRow, error } = await supabase
        .from('ai_ui_schemas')
        .select('*')
        .eq('conversation_id', conversation_id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
        
    if (error) {
        console.error("Error fetching schema:", error);
        return res.status(500).json({ error: error.message });
    }
    
    if (!schemaRow || !schemaRow.layout_json) {
        // Fallback generic layout if AI hasn't processed it yet
        return res.json({
            layout: [
                {
                    type: "card",
                    title: "Status AI",
                    items: [
                        { label: "Analiză", value: "În desfășurare..." }
                    ]
                }
            ]
        });
    }

    // Android app blindly renders this array
    res.json({ layout: schemaRow.layout_json });
});

// Endpoint for Android app to send an operator note/prompt
app.post('/api/ai/prompt', async (req, res) => {
    const { conversation_id, prompt_text, created_by } = req.body;
    
    const { error } = await supabase.from('ai_operator_prompts').insert({
        conversation_id,
        prompt_text,
        prompt_type: 'note',
        created_by: created_by || 'operator'
    });
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(200).json({ status: 'ok' });
    
    // Trigger re-processing
    processConversation(conversation_id).catch(console.error);
});

import { processConversation } from './manager-ai-worker.mjs';

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ManagerAi API is running on port ${PORT}`);
});
