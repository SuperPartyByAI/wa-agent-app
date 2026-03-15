import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const router = express.Router();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * GET /api/v1/admin/lead-debug/:conversation_id
 * Returns a 360-degree aggregated view of the Lead's current state.
 */
router.get('/lead-debug/:conversation_id', async (req, res) => {
    const { conversation_id } = req.params;
    
    if (!conversation_id) {
        return res.status(400).json({ error: 'Missing conversation_id' });
    }

    try {
        // Fetch Conversation Basic Info
        const { data: conv } = await supabase
            .from('conversations')
            .select('id, client_id, channel, status, created_at, updated_at')
            .eq('id', conversation_id)
            .single();

        // Fetch Lead Runtime State
        const { data: runtime } = await supabase
            .from('ai_lead_runtime_states')
            .select('*')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        // Fetch Party Draft
        const { data: draft } = await supabase
            .from('party_drafts')
            .select('party_data, updated_at')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        // Fetch Audit Trail (History of decisions)
        const { data: auditTrail } = await supabase
            .from('ai_lead_audit_trail')
            .select('*')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false });

        // Fetch Latest Messages
        const { data: messages } = await supabase
            .from('messages')
            .select('id, sender_type, content, created_at')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false })
            .limit(10);
            
        // Construct the 360 view    
        const summary = {
            conversation: conv || null,
            runtime_state: runtime || null,
            party_draft: draft?.party_data || null,
            audit_trail: auditTrail || [],
            recent_messages: messages || []
        };

        return res.json({ success: true, data: summary });

    } catch (err) {
        console.error(`[AdminDebug] Failed to fetch 360 view for ${conversation_id}:`, err);
        return res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

export default router;
