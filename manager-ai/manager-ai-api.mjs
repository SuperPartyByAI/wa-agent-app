import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Webhook inside from whts-up (WhatsApp transport)
app.post('/webhook/whts-up', async (req, res) => {
    const { message_id, conversation_id, content, sender_type } = req.body;
    console.log(`[Webhook MSG] Received msg ${message_id} for conv ${conversation_id} from ${sender_type}`);
    
    // In V1, we just fire an async process and return 200 immediately to not block WhatsApp
    res.status(200).json({ status: 'queued' });
    
    // Abstracting to Worker logic
    processConversation(conversation_id).catch(console.error);
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
