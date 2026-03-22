import fs from 'fs';
import crypto from 'crypto';

const policyPath = 'runtime_rules/policy.json';
const data = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

for(let rule of data.rules || []) {
  rule.trigger = (rule.query_type || "any").toUpperCase();
  rule.stage = (rule.trigger_stage || "any").toUpperCase();
  
  if(rule.behavior === 'use_kb') rule.behavior = 'USE_KB';
  if(rule.behavior === 'clarify_first') rule.behavior = 'CLARIFY_FIRST';
  if(rule.behavior === 'use_memory') rule.behavior = 'AUTO_REPLY';
  if(rule.behavior === 'handoff') rule.behavior = 'HANDOFF';
  rule.behavior = rule.behavior.toUpperCase();
}

for(let cov of data.coverage || []) {
  cov.allowed_mode = cov.autoreply_mode || 'operator_review';
  if(cov.allowed_mode === 'operator_review_only') cov.allowed_mode = 'operator_review';
}

data.rules.push({
  id: crypto.randomUUID(),
  name: "Complaint Handling",
  description: "Stop auto-reply if complaints",
  trigger: "COMPLAINT",
  stage: "ANY",
  behavior: "HANDOFF",
  priority: 100,
  status: "active"
});

const contentToHash = JSON.stringify({ rules: data.rules, coverage: data.coverage, policies: data.policies || [] });
data.checksum = crypto.createHash('sha256').update(contentToHash).digest('hex');

fs.writeFileSync(policyPath, JSON.stringify(data, null, 2));
console.log("Patched policy.json");
