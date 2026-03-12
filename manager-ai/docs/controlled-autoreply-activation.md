# Controlled Auto-Reply Activation — Runbook

## Preconditions

Inainte de a porni AI auto-reply, verifica:

| Check                   | Comanda                                 | Asteptat                                    |
| ----------------------- | --------------------------------------- | ------------------------------------------- |
| PM2 running             | `pm2 status`                            | `manager-ai-api` = online                   |
| Catalog loaded          | PM2 logs                                | `[Service Catalog] Loaded 12 services`      |
| Eligibility guard activ | PM2 logs                                | `AI_AUTOREPLY_ENABLED: OFF` sau `ON`        |
| LLM responsive          | `curl http://localhost:11434/v1/models` | lista modele                                |
| Migration rulata        | `GET /api/ai/audit/summary`             | nu returneaza erori pe `eligibility_reason` |
| Cutoff setat            | `grep CUTOFF .env`                      | `AI_AUTOREPLY_CUTOFF=<ISO timestamp>`       |

---

## Pornire pilot

### Pas 1: Seteaza cutoff-ul = ACUM

```bash
# Pe server ManagerAi
cd /root/manager-ai

# Seteaza cutoff la momentul activarii
# Toate conv din trecut raman blocate
nano .env
# Adauga/modifica:
# AI_AUTOREPLY_CUTOFF=2026-03-12T16:00:00Z   (pune ora curenta UTC)
```

### Pas 2: Porneste auto-reply

```bash
# In .env:
# AI_AUTOREPLY_ENABLED=true

# Restart
pm2 restart manager-ai-api

# Verifica
pm2 logs manager-ai-api --lines 3 --nostream
# Trebuie sa vezi: AI_AUTOREPLY_ENABLED: ON
```

### Pas 3: Verifica imediat

```bash
# Summary audit (ar trebui sa fie 0 eligible la inceput)
curl -s http://localhost:3000/api/ai/audit/summary | python3 -m json.tool

# Recent decisions (ultimele intrari)
curl -s http://localhost:3000/api/ai/audit/recent?limit=5 | python3 -m json.tool
```

---

## Ce inseamna succes

Dupa activare, in urmatoarele 1-2h:

| Semnal                 | Valoare OK             | Valoare Problema         |
| ---------------------- | ---------------------- | ------------------------ |
| Conversatii vechi      | `blocked_below_cutoff` | `allowed` (nu ar trebui) |
| Conversatii booked     | `blocked_stage_booked` | `allowed`                |
| Conversatii noi simple | `allowed` + `sent`     | tot `blocked`            |
| Confidence pe sent     | >= 75                  | < 50                     |
| Escalari               | 0-2                    | > 5 in prima ora         |

---

## Monitorizare rapida

```bash
# Summary ultimele 24h
curl -s http://localhost:3000/api/ai/audit/summary

# Daca vezi conversatie suspecta
curl -s http://localhost:3000/api/ai/audit/conversation/<UUID>
```

---

## Rollback (oprire imediata)

```bash
# OPRESTE IMEDIAT auto-reply:
cd /root/manager-ai

# Metoda 1: Kill switch (cea mai rapida)
sed -i 's/AI_AUTOREPLY_ENABLED=true/AI_AUTOREPLY_ENABLED=false/' .env
pm2 restart manager-ai-api

# Metoda 2: Direct in .env
nano .env
# Schimba: AI_AUTOREPLY_ENABLED=false
pm2 restart manager-ai-api

# Verifica ca e OFF
pm2 logs manager-ai-api --lines 2 --nostream
# Trebuie sa vezi: AI_AUTOREPLY_ENABLED: OFF (safe mode)
```

Efectul rollback-ului:

- AI nu mai raspunde automat
- AI inca analizeaza si propune reply-uri (pending)
- Brain Tab functioneaza normal
- Nimic nu se pierde

---

## Reguli pilot

1. **NU** dezactiva cutoff-ul
2. **NU** seta cutoff in trecut
3. **NU** elimina `needs_human_review` check-ul
4. **NU** scade `MIN_AUTOREPLY_CONFIDENCE` sub 75
5. Monitoreaza audit summary la fiecare 2-3h in prima zi
6. Daca vezi > 3 reply-uri gresite, opreste imediat
