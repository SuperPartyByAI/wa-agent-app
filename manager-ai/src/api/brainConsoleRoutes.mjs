/**
 * Brain Console API Routes
 * 
 * Provides endpoints for the AI Brain Console:
 * - Inbox: view real WhatsApp messages + AI responses
 * - Corrections: save/promote corrections
 * - Brain Rules: CRUD + approval workflow
 * - Patterns: observed patterns from corrections
 * - Policies: aggregated active policies
 * - Coverage: zone-based autoreply control
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { recordCorrection, approveCandidate } from '../knowledge/learningLoop.mjs';

const router = Router();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ═══════════════════════════════════════════
// 1. INBOX — Real WhatsApp messages + AI decisions
// ═══════════════════════════════════════════

router.get('/inbox', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const offset = parseInt(req.query.offset || '0', 10);
        const filter = req.query.filter; // unanswered, needs_review, corrected, dangerous, etc.
        const stage = req.query.stage;
        const verdict = req.query.verdict;
        const safety = req.query.safety;
        const kb_key = req.query.kb_key;

        let query = supabase
            .from('ai_reply_decisions')
            .select(`
                id, conversation_id, suggested_reply, confidence_score, 
                safety_class, safety_class_reasons, conversation_stage,
                reply_status, reply_quality_score, reply_quality_label,
                operator_verdict, operator_edited_reply, operator_feedback_reason,
                tool_action_suggested, tool_action_executed,
                reply_style, composer_used, next_step, progression_status,
                autonomy_level, escalation_type, memory_context_used,
                operational_mode, created_at
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // Apply filters
        if (filter === 'unanswered') query = query.is('operator_verdict', null).eq('reply_status', 'shadow');
        if (filter === 'needs_review') query = query.eq('safety_class', 'needs_operator_review');
        if (filter === 'corrected') query = query.not('operator_edited_reply', 'is', null);
        if (filter === 'dangerous') query = query.eq('safety_class', 'blocked_autoreply');
        if (filter === 'should_have_clarified') query = query.eq('operator_verdict', 'should_have_clarified');
        if (filter === 'wrong_memory') query = query.eq('operator_verdict', 'wrong_memory_usage');
        if (stage) query = query.eq('conversation_stage', stage);
        if (verdict) query = query.eq('operator_verdict', verdict);
        if (safety) query = query.eq('safety_class', safety);

        const { data, error, count } = await query;
        if (error) throw error;

        // Enrich with latest client message for each conversation
        const convIds = [...new Set(data.map(d => d.conversation_id).filter(Boolean))];
        let messageMap = {};
        if (convIds.length > 0) {
            const { data: msgs } = await supabase
                .from('messages')
                .select('conversation_id, content, sender_type, created_at')
                .in('conversation_id', convIds.slice(0, 50))
                .eq('sender_type', 'client')
                .order('created_at', { ascending: false });

            if (msgs) {
                // Keep only the latest message per conversation
                for (const m of msgs) {
                    if (!messageMap[m.conversation_id]) {
                        messageMap[m.conversation_id] = m;
                    }
                }
            }
        }

        // Merge
        const enriched = data.map(d => ({
            ...d,
            client_message: messageMap[d.conversation_id]?.content || null,
            client_message_at: messageMap[d.conversation_id]?.created_at || null
        }));

        res.json({ inbox: enriched, total: count, limit, offset });
    } catch (err) {
        console.error('[Brain] Inbox error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/inbox/:id', async (req, res) => {
    try {
        const { data: decision, error } = await supabase
            .from('ai_reply_decisions')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;

        // Get conversation messages
        const { data: messages } = await supabase
            .from('messages')
            .select('id, content, sender_type, created_at')
            .eq('conversation_id', decision.conversation_id)
            .order('created_at', { ascending: false })
            .limit(20);

        // Get any corrections for this conversation
        const { data: corrections } = await supabase
            .from('ai_learned_corrections')
            .select('*')
            .eq('conversation_id', decision.conversation_id);

        // Get event plan if exists
        const { data: eventPlan } = await supabase
            .from('ai_event_plans')
            .select('*')
            .eq('conversation_id', decision.conversation_id)
            .maybeSingle();

        res.json({
            decision,
            messages: messages?.reverse() || [],
            corrections: corrections || [],
            event_plan: eventPlan
        });
    } catch (err) {
        console.error('[Brain] Inbox detail error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 2. CORRECTIONS — Save and promote corrections
// ═══════════════════════════════════════════

router.post('/correct', async (req, res) => {
    try {
        const {
            conversation_id, decision_id,
            original_ai_reply, corrected_reply,
            question_context, correction_type,
            verdict, reason, flags
        } = req.body;

        if (!conversation_id || !corrected_reply) {
            return res.status(400).json({ error: 'conversation_id and corrected_reply required' });
        }

        // 1. Save correction via learningLoop
        const corrResult = await recordCorrection({
            conversationId: conversation_id,
            originalAiReply: original_ai_reply,
            correctedReply: corrected_reply,
            questionContext: question_context,
            correctionType: correction_type || 'edit'
        });

        // 2. Update verdict on the decision
        if (decision_id && verdict) {
            await supabase
                .from('ai_reply_decisions')
                .update({
                    operator_verdict: verdict,
                    operator_edited_reply: corrected_reply,
                    operator_feedback_reason: reason,
                    operator_feedback_at: new Date().toISOString()
                })
                .eq('id', decision_id);
        }

        res.json({
            status: 'saved',
            correction: corrResult,
            verdict: verdict || null
        });
    } catch (err) {
        console.error('[Brain] Correction error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/correct/:id/promote', async (req, res) => {
    try {
        const correctionId = req.params.id;
        const { target, kb_overrides } = req.body; // target: 'pattern' | 'rule' | 'kb'

        if (target === 'kb') {
            // Promote to KB entry
            const result = await approveCandidate(correctionId, kb_overrides || {});
            return res.json({ status: 'promoted_to_kb', result });
        }

        if (target === 'pattern') {
            // Create a pattern from this correction
            const { data: corr } = await supabase
                .from('ai_learned_corrections')
                .select('*')
                .eq('id', correctionId)
                .single();

            if (!corr) return res.status(404).json({ error: 'Correction not found' });

            const { data: pattern, error } = await supabase
                .from('ai_answer_patterns')
                .insert({
                    name: `Pattern from correction: ${corr.question_context?.substring(0, 50) || 'unknown'}`,
                    category: corr.correction_scope || 'general',
                    strategy: 'answer_direct',
                    template: corr.corrected_reply,
                    examples: [{
                        question: corr.question_context,
                        original_answer: corr.original_ai_reply,
                        corrected_answer: corr.corrected_reply
                    }],
                    status: 'candidate'
                })
                .select()
                .single();

            if (error) throw error;

            // Update correction status
            await supabase.from('ai_learned_corrections')
                .update({ kb_candidate_status: 'promoted_to_pattern' })
                .eq('id', correctionId);

            return res.json({ status: 'promoted_to_pattern', pattern });
        }

        res.status(400).json({ error: 'target must be "pattern", "rule", or "kb"' });
    } catch (err) {
        console.error('[Brain] Promote error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 3. BRAIN RULES — CRUD + approval workflow
// ═══════════════════════════════════════════

router.get('/rules', async (req, res) => {
    try {
        const status = req.query.status; // draft, candidate, approved, active, disabled, retired
        let query = supabase
            .from('ai_brain_rules')
            .select('*')
            .order('priority', { ascending: false });

        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;
        res.json({ rules: data, count: data.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/rules', async (req, res) => {
    try {
        const { name, description, query_type, trigger_stage, trigger_conditions,
            behavior, priority, examples } = req.body;

        if (!name || !behavior) {
            return res.status(400).json({ error: 'name and behavior required' });
        }

        const { data, error } = await supabase
            .from('ai_brain_rules')
            .insert({
                name, description, query_type, trigger_stage,
                trigger_conditions: trigger_conditions || {},
                behavior, priority: priority || 50,
                examples: examples || [], status: 'draft'
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'created', rule: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/rules/:id', async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id; // Don't update ID

        const { data, error } = await supabase
            .from('ai_brain_rules')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'updated', rule: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/rules/:id/approve', async (req, res) => {
    try {
        const { target_status, approved_by } = req.body;
        const validStatuses = ['candidate', 'approved', 'active', 'disabled', 'retired'];
        const newStatus = target_status || 'active';

        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` });
        }

        const { data, error } = await supabase
            .from('ai_brain_rules')
            .update({
                status: newStatus,
                approved_by: approved_by || 'operator',
                updated_at: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'approved', rule: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 4. PATTERNS — Observed answer patterns
// ═══════════════════════════════════════════

router.get('/patterns', async (req, res) => {
    try {
        const status = req.query.status;
        let query = supabase
            .from('ai_answer_patterns')
            .select('*')
            .order('frequency', { ascending: false });

        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;
        res.json({ patterns: data, count: data.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/patterns/:id/promote', async (req, res) => {
    try {
        const { data: pattern } = await supabase
            .from('ai_answer_patterns')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (!pattern) return res.status(404).json({ error: 'Pattern not found' });

        // Create a brain rule from this pattern
        const { data: rule, error } = await supabase
            .from('ai_brain_rules')
            .insert({
                name: `Rule from pattern: ${pattern.name}`,
                description: `Auto-generated from pattern ${pattern.id}`,
                query_type: pattern.category,
                behavior: pattern.strategy || 'answer_direct',
                priority: 40,
                status: 'candidate',
                examples: pattern.examples || []
            })
            .select()
            .single();

        if (error) throw error;

        // Link pattern to rule
        await supabase.from('ai_answer_patterns')
            .update({ linked_rule_id: rule.id, status: 'approved' })
            .eq('id', req.params.id);

        res.json({ status: 'promoted_to_rule', rule });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 5. POLICIES — Aggregated active policies  
// ═══════════════════════════════════════════

router.get('/policies', async (req, res) => {
    try {
        // Active brain rules = operational policies
        const { data: rules } = await supabase
            .from('ai_brain_rules')
            .select('*')
            .in('status', ['active', 'approved'])
            .order('priority', { ascending: false });

        // Active KB entries = knowledge policies
        const { data: kb } = await supabase
            .from('ai_knowledge_base')
            .select('id, knowledge_key, category, status, question_patterns, created_at, updated_at')
            .eq('status', 'approved');

        // Coverage settings = access policies
        const { data: coverage } = await supabase
            .from('ai_coverage_config')
            .select('*')
            .eq('active', true);

        res.json({
            brain_rules: rules || [],
            knowledge_entries: kb || [],
            coverage_zones: coverage || [],
            total_active: (rules?.length || 0) + (kb?.length || 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/policies/:id/activate', async (req, res) => {
    try {
        const { type } = req.body; // 'rule' or 'kb'
        const table = type === 'kb' ? 'ai_knowledge_base' : 'ai_brain_rules';
        const statusField = type === 'kb' ? 'approved' : 'active';

        const { data, error } = await supabase
            .from(table)
            .update({ status: statusField, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'activated', item: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/policies/:id/deactivate', async (req, res) => {
    try {
        const { type } = req.body;
        const table = type === 'kb' ? 'ai_knowledge_base' : 'ai_brain_rules';

        const { data, error } = await supabase
            .from(table)
            .update({ status: 'disabled', updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'deactivated', item: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 6. COVERAGE — Zone-based autoreply control
// ═══════════════════════════════════════════

router.get('/coverage', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('ai_coverage_config')
            .select('*')
            .order('coverage_level', { ascending: true });

        if (error) throw error;

        // Group by coverage level
        const grouped = {
            high: data.filter(d => d.coverage_level === 'high'),
            medium: data.filter(d => d.coverage_level === 'medium'),
            low: data.filter(d => d.coverage_level === 'low')
        };

        res.json({ coverage: data, grouped, total: data.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/coverage', async (req, res) => {
    try {
        const { zone, coverage_level, autoreply_mode, description, conditions, active, updated_by } = req.body;

        if (!zone) return res.status(400).json({ error: 'zone required' });

        const { data, error } = await supabase
            .from('ai_coverage_config')
            .upsert({
                zone,
                coverage_level: coverage_level || 'medium',
                autoreply_mode: autoreply_mode || 'shadow_only',
                description,
                conditions: conditions || {},
                active: active !== false,
                updated_by: updated_by || 'operator',
                updated_at: new Date().toISOString()
            }, { onConflict: 'zone' })
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'saved', coverage: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════
// 7. STATS — Aggregated brain console stats
// ═══════════════════════════════════════════

router.get('/stats', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours || '24', 10);
        const since = new Date(Date.now() - hours * 3600000).toISOString();

        // Recent decisions
        const { count: totalDecisions } = await supabase
            .from('ai_reply_decisions').select('*', { count: 'exact', head: true })
            .gte('created_at', since);

        // With feedback
        const { count: withFeedback } = await supabase
            .from('ai_reply_decisions').select('*', { count: 'exact', head: true })
            .gte('created_at', since).not('operator_verdict', 'is', null);

        // Corrections
        const { count: totalCorrections } = await supabase
            .from('ai_learned_corrections').select('*', { count: 'exact', head: true });

        // Active rules
        const { count: activeRules } = await supabase
            .from('ai_brain_rules').select('*', { count: 'exact', head: true })
            .eq('status', 'active');

        // Patterns
        const { count: totalPatterns } = await supabase
            .from('ai_answer_patterns').select('*', { count: 'exact', head: true });

        // KB entries
        const { count: kbEntries } = await supabase
            .from('ai_knowledge_base').select('*', { count: 'exact', head: true })
            .eq('status', 'approved');

        // Coverage zones
        const { data: coverageData } = await supabase
            .from('ai_coverage_config').select('coverage_level, autoreply_mode, active');

        const coverageStats = {
            total_zones: coverageData?.length || 0,
            high: coverageData?.filter(c => c.coverage_level === 'high').length || 0,
            medium: coverageData?.filter(c => c.coverage_level === 'medium').length || 0,
            low: coverageData?.filter(c => c.coverage_level === 'low').length || 0,
            autoreply_enabled: coverageData?.filter(c => c.autoreply_mode === 'allow_autoreply').length || 0,
            blocked: coverageData?.filter(c => c.autoreply_mode === 'blocked').length || 0
        };

        res.json({
            period_hours: hours,
            decisions: { total: totalDecisions, with_feedback: withFeedback },
            corrections: totalCorrections,
            active_rules: activeRules,
            patterns: totalPatterns,
            kb_entries: kbEntries,
            coverage: coverageStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
