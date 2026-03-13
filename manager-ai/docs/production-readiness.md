# Production Readiness — AI Agent

## System Overview

### Ce face agentul

- Primește mesaje WhatsApp de la clienți (inbound)
- Analizează mesajul cu Gemini LLM (intent, entity, confidence)
- Detectează servicii, extrage entități (dată, locație, nr copii)
- Alege un tool: `reply_only`, `update_event_plan`, `generate_quote_draft`, `confirm_booking_from_ai_plan`, `archive_plan`, `handoff_to_operator`
- Compune un reply natural în română
- Clasifică safety: `safe_autoreply_allowed`, `needs_operator_review`, `blocked_autoreply`
- În funcție de rollout state: trimite automat sau reține pentru review

### Ce NU face

- Nu confirmă booking-uri fără operator
- Nu trimite facturi sau contracte
- Nu gestionează plăți
- Nu accesează date bancare
- Nu răspunde la mesaje juridice/financiare
- Nu modifică booking-uri confirmate

### Componente sursa de adevăr

| Component              | Rol                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| **Git**                | Cod, registry acțiuni, context pack                                 |
| **Supabase**           | Date live: conversații, clienți, plans, quotes, bookings, decisions |
| **Gemini API**         | LLM analysis + composition                                          |
| **WhatsApp transport** | Trimitere/primire mesaje                                            |
| **Core API**           | Dispatch booking, KYC                                               |

### Rollout States

```
shadow_only → wave1_candidate → wave1_enabled → wave2_candidate → wave2_enabled
Any state → rollout_blocked → shadow_only (manual reset)
```

---

## Deployment Checklist

| #   | Check                 | Command / Verification                     |
| --- | --------------------- | ------------------------------------------ |
| 1   | Branch = `main`       | `git branch --show-current`                |
| 2   | SHA corect            | `git rev-parse HEAD`                       |
| 3   | Context pack activ    | `curl /api/ai/readiness`                   |
| 4   | Migrations aplicate   | `curl /api/ai/health`                      |
| 5   | Feature flags corecte | Verifică `.env`                            |
| 6   | PM2 online            | `pm2 status`                               |
| 7   | LLM connectivity      | `curl /api/ai/health` (llm_reachable)      |
| 8   | Supabase connectivity | `curl /api/ai/health` (supabase_reachable) |
| 9   | Transport outbound    | Test manual pe nr controlat                |
| 10  | Smoke tests pass      | `node tests/smoke_test_phase4.mjs`         |

---

## Rollout Checklist

### Shadow Mode

- [x] Migration SQL aplicată
- [x] `AI_SHADOW_MODE_ENABLED=true`
- [x] Context pack publicat
- [x] Safety class persistă
- [x] 0 outbound în shadow

### Wave 1 Candidate

- [ ] 30+ verdicts operator
- [ ] Approval rate ≥ 80%
- [ ] Dangerous rate ≤ 2%
- [ ] Wrong tool ≤ 5%
- [ ] 0 duplicates, 0 double dispatch
- [ ] `POST /api/ai/rollout/transition` → `wave1_candidate`

### Wave 1 Enabled

- [ ] Operator approves candidate
- [ ] `.env`: `AI_SAFE_AUTOREPLY_ENABLED=true`, `AI_SHADOW_MODE_ENABLED=false`, `AI_WAVE1_ENABLED=true`
- [ ] Traffic: start 5%
- [ ] `POST /api/ai/rollout/transition` → `wave1_enabled`
- [ ] Monitor scorecard 24h

### Wave 2 Candidate

- [ ] Wave 1 stable 72h+
- [ ] 50+ verdicts
- [ ] Approval ≥ 90%, Edit ≤ 15%
- [ ] 0 duplicates, 0 dangerous
- [ ] `POST /api/ai/rollout/transition` → `wave2_candidate`

### Când NU se activează

- LLM instabil / latență > 5s constant
- Supabase offline sau degradat
- Transport WhatsApp instabil
- Core API offline
- Orice Sev1 incident activ

---

## Rollback Checklist

### Oprire rapidă Wave 1

```bash
# 1. Pause rollout
curl -X POST http://localhost:3000/api/ai/rollout/pause \
  -H "Content-Type: application/json" -d '{"reason":"manual_pause"}'

# 2. Disable în .env
AI_WAVE1_ENABLED=false
AI_SHADOW_MODE_ENABLED=true

# 3. Restart
pm2 restart manager-ai-api

# 4. Confirmare 0 outbound
curl http://localhost:3000/api/ai/scorecard | jq .total_replies_auto_sent
```

### Confirmare post-rollback

1. `GET /api/ai/rollout/status` → `shadow_only`
2. `GET /api/ai/scorecard?hours=1` → `auto_sent: 0`
3. Verificare loguri PM2: `[Pipeline] Shadow mode: holding reply`

---

## Health Checklist

| Check             | Endpoint / Query                        |
| ----------------- | --------------------------------------- |
| API online        | `GET /api/ai/health`                    |
| Readiness         | `GET /api/ai/readiness`                 |
| Rollout state     | `GET /api/ai/rollout/status`            |
| Scorecard         | `GET /api/ai/scorecard?hours=24`        |
| Rollback triggers | `GET /api/ai/rollback/check`            |
| Incidents         | `GET /api/ai/rollout/incidents`         |
| Shadow analytics  | `GET /api/ai/analytics/shadow?hours=24` |

---

## Dependencies & Failure Modes

| Dependency         | Fallback              | Impact if Down              |
| ------------------ | --------------------- | --------------------------- |
| Gemini API         | Retry 3x, then skip   | No AI replies, shadow holds |
| Supabase           | None                  | Full stop — no data         |
| WhatsApp transport | Queue (BullMQ)        | Messages queued, not sent   |
| Core API           | Skip booking dispatch | Bookings not confirmed      |
| PM2                | Auto-restart          | Brief gap, auto-recovery    |

## Verdict

| Level                                  | Status                     |
| -------------------------------------- | -------------------------- |
| `production_ready_for_shadow`          | ✅                         |
| `production_ready_for_wave1`           | ✅ (pending 30+ verdicts)  |
| `production_ready_for_wave2_candidate` | ✅ (pending wave1_enabled) |
