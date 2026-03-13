# Incident Response — AI Agent

## Escalation Matrix

| Severity | Descriere                                                                   | Cine acționează   | Rollback?         |
| -------- | --------------------------------------------------------------------------- | ----------------- | ----------------- |
| **Sev1** | Duplicate outbound, dangerous autoreply sent, wrong client, double dispatch | Admin + Operator  | DA — imediat      |
| **Sev2** | Wrong memory usage, wrong plan target, persistence mismatch                 | Admin             | DA — dacă repetat |
| **Sev3** | Clarification miss, wrong tool (fără damage), unnecessary question          | Operator          | NU — monitorizare |
| **Sev4** | LLM timeout transient, latency spike, low confidence single                 | Auto-monitorizare | NU                |

---

## Runbook: Duplicate Outbound

**Simptome:** Client primește 2+ mesaje identice sau similare la același mesaj inbound.

**Impact:** Sev1 — confuzie client, comportament haotic.

**Detectare:**

- `GET /api/ai/scorecard` → `duplicate_outbound > 0`
- PM2 logs: `[Pipeline] Done` apare de 2+ ori pentru aceeași conversație

**Acțiune:**

1. `POST /api/ai/rollout/pause` — oprește rollout
2. Verifică `ai_reply_decisions` pentru conversația afectată
3. Verifică `messages` outbound duplicate
4. Identifică cauza: BullMQ retry? Transport retry? Pipeline double call?
5. Fix și test înainte de reluare

**Remediere:** Fix tehnic → smoke test → `POST /api/ai/rollout/resume`

---

## Runbook: Double Dispatch

**Simptome:** Core API primește 2 cereri de booking pentru același plan.

**Impact:** Sev1 — booking duplicat, date corupte.

**Detectare:** `GET /api/ai/analytics/shadow` → `double_dispatch > 0`

**Acțiune:**

1. Pause rollout imediat
2. Verifică `ai_reply_decisions` cu `tool_action_suggested = confirm_booking`
3. Verifică Core API logs

---

## Runbook: Wrong Client Memory

**Simptome:** AI răspunde cu informații de la alt client.

**Impact:** Sev1 — breach de confidențialitate.

**Detectare:** Operator marchează `wrong_memory_usage`

**Acțiune:**

1. Pause rollout imediat
2. Verifică `entity_memories` pentru clientul afectat
3. Verifică `relationship_memory` cross-contamination
4. Marchează `dangerous` pe decizia respectivă

---

## Runbook: Wrong Plan Target

**Simptome:** AI actualizează un plan care nu este cel vizat de client.

**Impact:** Sev2 — date greșite în plan.

**Detectare:** Operator marchează `wrong_tool` sau `misunderstood_client`

**Acțiune:**

1. Verifică `ai_event_plans` pentru conversație (multiple plans?)
2. Corectează manual planul afectat
3. Dacă repetat → pause rollout

---

## Runbook: Wrong Field Update

**Simptome:** AI scrie date greșite în event plan.

**Impact:** Sev2 — informații incorecte.

**Detectare:** Post-write verification mismatch, operator review

**Acțiune:**

1. Verifică `ai_event_plans` → compare requested vs persisted
2. Corectează manual
3. Dacă patterned → verifică LLM extraction quality

---

## Runbook: Dangerous Autoreply Sent

**Simptome:** Reply periculos ajunge la client (confirmare falsă, preț greșit, promisiune).

**Impact:** Sev1 — damage real la business.

**Acțiune:**

1. **OPREȘTE tot:** `POST /api/ai/rollout/pause` + forțează `shadow_only`
2. Contactează clientul manual pentru corecție
3. Marchează `dangerous` pe decizie
4. Analizează cauza: safety classifier fail? wave guard bypass?
5. Fix înainte de orice reluare

---

## Runbook: Agent Failed to Clarify

**Simptome:** AI a răspuns cu certitudine la ceva ambiguu.

**Impact:** Sev3 — inconfort client, date potențial greșite.

**Acțiune:**

1. Marchează `should_have_clarified`
2. Răspunde manual cu clarificarea corectă
3. Monitorizează rata — dacă > 10% → review clarification layer

---

## Runbook: Rollout Metrics Degrade

**Simptome:** Approval rate scade, dangerous/wrong_tool cresc.

**Impact:** Sev2 — degradare calitate.

**Detectare:** `GET /api/ai/scorecard` → KPIs sub prag

**Acțiune:**

1. `GET /api/ai/rollback/check` — verifică dacă auto-rollback ar trebui activat
2. Dacă da → `POST /api/ai/rollback/trigger`
3. Dacă nu → monitorizează 24h, dacă nu se îmbunătățește → pause manual

---

## Runbook: Context Pack Drift

**Simptome:** AI execută tool-uri care nu mai sunt în registry.

**Impact:** Sev2 — comportament nepredictibil.

**Detectare:** PM2 logs: `[Executor] drift_detected`

**Acțiune:**

1. `node src/grounding/generateContextPack.mjs` — republicare
2. `pm2 restart manager-ai-api`
3. Verifică `GET /api/ai/readiness`

---

## Runbook: Supabase Schema Mismatch

**Simptome:** API returnează erori, decisions nu se salvează.

**Detectare:** `GET /api/ai/health` → `schema_ok: false`

**Acțiune:**

1. Pause rollout
2. Verifică migrations: `ai_reply_decisions` columns
3. Aplică missingmigration
4. Verifică readiness

---

## Runbook: LLM Outage (Gemini)

**Simptome:** Pipeline timeout, replies goale.

**Impact:** Sev3 — nu se procesează mesaje, dar no outbound damage.

**Detectare:** PM2 logs: `[LLM] timeout`, `GET /api/ai/health` → `llm_reachable: false`

**Acțiune:**

1. AI-ul NU trimite în outage → safe
2. Operatorii preiau manual
3. Monitorizare auto-recovery

---

## Runbook: WhatsApp Transport / Core API / PM2 Outage

**Transport:** Mesajele nu pleacă → BullMQ le reține → se trimit la recovery. Monitor: PM2 logs + redis queue.

**Core API:** Bookinguri nu se confirmă → manual pe backend. AI replies funcționează normal.

**PM2 crash:** Auto-restart. Verifică: `pm2 status`. Dacă loop → `pm2 logs --lines 100`, fix, restart.
