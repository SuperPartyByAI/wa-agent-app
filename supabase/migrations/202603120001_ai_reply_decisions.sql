-- AI Reply Decisions — audit trail for every AI decision on a conversation
-- Stores: suggested reply text, classification decision, send status

CREATE TABLE IF NOT EXISTS ai_reply_decisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  suggested_reply TEXT NOT NULL,
  can_auto_reply BOOLEAN DEFAULT false,
  needs_human_review BOOLEAN DEFAULT true,
  escalation_reason TEXT,
  confidence_score INTEGER DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  conversation_stage TEXT DEFAULT 'lead',
  reply_status TEXT DEFAULT 'pending' CHECK (reply_status IN ('pending', 'approved', 'sent', 'rejected')),
  sent_by TEXT DEFAULT 'pending' CHECK (sent_by IN ('ai', 'operator', 'pending')),
  sent_at TIMESTAMPTZ,
  operator_edit TEXT,
  operator_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_reply_decisions_conv ON ai_reply_decisions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_reply_decisions_status ON ai_reply_decisions(reply_status);

-- Enable RLS
ALTER TABLE ai_reply_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON ai_reply_decisions FOR ALL USING (true) WITH CHECK (true);
