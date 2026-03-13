# Admin Runbook — AI Agent

## Daily Checks

```bash
# Health
curl http://localhost:3000/api/ai/health | jq .

# Rollout status
curl http://localhost:3000/api/ai/rollout/status | jq .

# Scorecard (last 24h)
curl http://localhost:3000/api/ai/scorecard?hours=24 | jq '{total_decisions, auto_sent: .total_replies_auto_sent, shadowed: .total_replies_shadowed, approval_rate, dangerous_rate, wrong_tool_rate, duplicate_outbound}'

# Rollback check
curl http://localhost:3000/api/ai/rollback/check | jq .

# Incidents
curl http://localhost:3000/api/ai/rollout/incidents | jq '.[0:5]'
```

## Key KPI Thresholds

| KPI                | Wave 1 OK | Wave 2 OK | Alert |
| ------------------ | --------- | --------- | ----- |
| Approval rate      | ≥ 80%     | ≥ 90%     | < 70% |
| Dangerous rate     | ≤ 2%      | 0%        | > 5%  |
| Wrong tool         | ≤ 5%      | ≤ 3%      | > 10% |
| Duplicate outbound | 0         | 0         | > 0   |
| Edit rate          | —         | ≤ 15%     | > 25% |
| Avg confidence     | ≥ 75      | ≥ 80      | < 60  |

## Admin Actions Reference

| Action              | Command                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Check readiness** | `curl /api/ai/readiness`                                                                |
| **Check health**    | `curl /api/ai/health`                                                                   |
| **View scorecard**  | `curl /api/ai/scorecard?hours=24`                                                       |
| **View incidents**  | `curl /api/ai/rollout/incidents`                                                        |
| **Pause rollout**   | `curl -X POST /api/ai/rollout/pause -d '{"reason":"..."}'`                              |
| **Resume rollout**  | `curl -X POST /api/ai/rollout/resume -d '{"target":"wave1_candidate","reason":"..."}'`  |
| **Force shadow**    | `curl -X POST /api/ai/rollout/force -d '{"target_state":"shadow_only","reason":"..."}'` |
| **Manual rollback** | `curl -X POST /api/ai/rollback/trigger`                                                 |
| **Check rollback**  | `curl /api/ai/rollback/check`                                                           |
| **Rollout history** | `curl /api/ai/rollout/history`                                                          |
| **Wave 2 status**   | `curl /api/ai/wave2/status`                                                             |

## Quick Decision Tree

```
Q: Is there a Sev1 incident?
  YES → Emergency rollback (see rollout-runbook.md)
  NO  → Continue

Q: Are KPIs degrading?
  YES → Check /rollback/check. If should_rollback → trigger. If not → monitor 24h.
  NO  → Continue

Q: Is gate passing for next wave?
  YES → Plan transition with operator team
  NO  → Stay at current wave, collect more data
```
