require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function runAudit() {
  console.log("=== STARTING GLOBAL ALIAS AUDIT ===\n");

  const report = {
    timestamp: new Date().toISOString(),
    sessions_audited: [],
    violations: [],
    compliant: [],
    summary: {
      total_sessions: 0,
      total_conversations_scanned: 0,
      violations_found: 0,
      compliant_found: 0,
      all_public_aliases_follow_route_format: null,
      any_conversation_still_uses_real_phone_as_public_alias: null
    }
  };

  // 1. Get all sessions
  const { data: sessions, error: sessErr } = await supabase.from('whatsapp_sessions').select('session_key, label, brand_key, alias_prefix, status');
  if (sessErr) {
     console.error("Failed to fetch sessions:", sessErr);
     return;
  }
  
  report.sessions_audited = sessions;
  report.summary.total_sessions = sessions.length;
  
  // 2. Scan all summaries
  const { data: convs, error: convErr } = await supabase.from('v_inbox_summaries').select('*');
  if (convErr) {
     console.error("Failed to fetch inbox summaries:", convErr);
     return;
  }
  
  report.summary.total_conversations_scanned = convs.length;

  const phoneRegex = /[0-9]{8,}/; 

  convs.forEach(c => {
     let isBad = false;
     let expectedFormat = "Unknown";
     
     const route = sessions.find(s => s.session_key === c.session_id);
     if (route && route.alias_prefix) {
         expectedFormat = `${route.alias_prefix}-XX`;
         // Condition 1: Does it contain a raw phone number signature?
         if (phoneRegex.test(c.public_alias)) {
             isBad = true;
         }
         
         // Condition 2: Does it match the prefix strictly?
         const prefixClean = route.alias_prefix.toLowerCase().replace(/[^a-z0-9]/g, '');
         if (c.public_alias) {
            const aliasClean = c.public_alias.toLowerCase().replace(/[^a-z0-9-]/g, '');
            if (!aliasClean.startsWith(prefixClean)) {
               isBad = true;
            }
         } else {
            isBad = true; 
         }
     } else {
        if (c.public_alias && phoneRegex.test(c.public_alias)) {
            isBad = true;
            expectedFormat = "No Phone Numbers";
        }
     }
     
     const record = {
        conversation_id: c.conversation_id,
        session_id: c.session_id,
        session_label: c.session_label,
        public_alias: c.public_alias,
        last_message_content: c.last_message_content,
        last_message_at: c.last_message_at,
        uses_real_phone_as_public_alias: phoneRegex.test(c.public_alias),
        prefix_matches_route: !isBad,
        expected_alias_format: expectedFormat
     };

     if (isBad) {
        report.violations.push(record);
     } else {
        report.compliant.push(record);
     }
  });
  
  report.summary.violations_found = report.violations.length;
  report.summary.compliant_found = report.compliant.length;
  report.summary.all_public_aliases_follow_route_format = report.violations.length === 0;
  report.summary.any_conversation_still_uses_real_phone_as_public_alias = report.violations.some(v => v.uses_real_phone_as_public_alias);

  fs.writeFileSync('./audit_reports/alias_audit_latest.json', JSON.stringify(report, null, 2));
  console.log("Audit complete. Report generated at ./audit_reports/alias_audit_latest.json");
}

runAudit();
