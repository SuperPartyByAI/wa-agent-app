# Rollout Runbook — AI Agent

## Pre-Rollout Checks

```bash
# 1. Verify Git
git branch --show-current    # must be: main
git rev-parse HEAD           # note SHA

# 2. Verify context pack
curl http://localhost:3000/api/ai/readiness | jq .

# 3. Verify health
curl http://localhost:3000/api/ai/health | jq .

# 4. Verify rollout state
curl http://localhost:3000/api/ai/rollout/status | jq .current_state
```

---

## Activate Shadow Mode

```bash
# .env
AI_SHADOW_MODE_ENABLED=true
AI_SAFE_AUTOREPLY_ENABLED=false
AI_WAVE1_ENABLED=false

# Restart
pm2 restart manager-ai-api

# Verify
curl http://localhost:3000/api/ai/health | jq .operational_mode
# Expected: shadow_mode
```

---

## Activate Wave 1

### Step 1: Check Gate

```bash
curl http://localhost:3000/api/ai/rollout/status | jq '.gate.wave1'
# eligible must be true
```

### Step 2: Transition to Candidate

```bash
curl -X POST http://localhost:3000/api/ai/rollout/transition \
  -H "Content-Type: application/json" \
  -d '{"target_state":"wave1_candidate","reason":"gate_passed","changed_by":"admin"}'
```

### Step 3: Enable in .env

```bash
AI_SHADOW_MODE_ENABLED=false
AI_SAFE_AUTOREPLY_ENABLED=true
AI_WAVE1_ENABLED=true
AI_WAVE1_TRAFFIC_PERCENT=5
```

### Step 4: Transition to Enabled

```bash
curl -X POST http://localhost:3000/api/ai/rollout/transition \
  -H "Content-Type: application/json" \
  -d '{"target_state":"wave1_enabled","reason":"operator_approved","changed_by":"admin"}'
```

### Step 5: Restart & Monitor

```bash
pm2 restart manager-ai-api
# Monitor for 1h:
watch -n 60 'curl -s http://localhost:3000/api/ai/scorecard?hours=1 | jq "{auto_sent,shadowed,approval_rate,dangerous_rate,duplicate_outbound}"'
```

### Traffic Ramp

```
5% → monitor 24h → 10% → monitor 24h → 25% → monitor 48h → 50% → monitor 48h → 100%
```

---

## Pause Rollout

```bash
curl -X POST http://localhost:3000/api/ai/rollout/pause \
  -H "Content-Type: application/json" \
  -d '{"reason":"manual_pause_by_admin"}'
```

---

## Resume Rollout

```bash
# Cannot resume from rollout_blocked — must force to shadow_only first
curl -X POST http://localhost:3000/api/ai/rollout/resume \
  -H "Content-Type: application/json" \
  -d '{"target":"wave1_candidate","reason":"metrics_stable"}'
```

---

## Emergency Rollback

```bash
# 1. Force shadow
curl -X POST http://localhost:3000/api/ai/rollout/force \
  -H "Content-Type: application/json" \
  -d '{"target_state":"shadow_only","reason":"emergency_rollback"}'

# 2. Disable flags
AI_WAVE1_ENABLED=false
AI_WAVE2_ENABLED=false
AI_SHADOW_MODE_ENABLED=true

# 3. Restart
pm2 restart manager-ai-api

# 4. Confirm 0 outbound
curl http://localhost:3000/api/ai/scorecard?hours=1 | jq .total_replies_auto_sent
# Expected: 0
```

---

## Reset from rollout_blocked

```bash
# Only after incident resolved:
curl -X POST http://localhost:3000/api/ai/rollout/force \
  -H "Content-Type: application/json" \
  -d '{"target_state":"shadow_only","reason":"incident_resolved_by_admin"}'
```
