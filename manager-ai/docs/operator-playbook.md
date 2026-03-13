# Operator Playbook — AI Agent

## 1. Cum funcționează agentul

### Ce vede operatorul

- Replies AI propuse în panel-ul de review
- Safety class: `safe` / `needs_review` / `blocked`
- Status: `shadow` (nu s-a trimis) / `pending_review` / `sent` (trimis automat)

### Moduri de operare

| Mod                | Ce se întâmplă                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| **Shadow**         | AI analizează, compune reply, dar NU trimite. Operatorul vede propunerea.                        |
| **Wave 1 Live**    | AI trimite automat DOAR pentru `reply_only` pe `new_lead`/`greeting`/`discovery`. Rest → review. |
| **Wave 2 Live**    | AI trimite automat și `update_event_plan` dacă trece toate verificările. Rest → review.          |
| **Pending Review** | AI a propus un reply dar nu l-a trimis. Operatorul trebuie să decidă.                            |

---

## 2. Cum interpretezi un reply AI

### Când APROBI (approved_as_is)

- Reply-ul este corect, natural, adecvat
- Tool-ul ales este cel potrivit
- Nu inventează servicii sau prețuri
- Ton potrivit pentru client

### Când EDITEZI (approved_with_edits)

- Reply-ul este OK ca intenție dar formularea trebuie ajustată
- Prețul sau detaliul trebuie corectat
- Tonul trebuie adaptat

### Când RESPINGI (rejected)

- Reply-ul nu ar fi potrivit
- Informația este greșită
- Nu ar trebui trimis deloc

### Verdicts speciale

| Verdict                   | Când îl folosești                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **dangerous**             | Reply-ul ar cauza probleme reale: promisiune falsă, preț greșit, confirmare neautorizată |
| **wrong_tool**            | AI-ul a ales tool-ul greșit (ex: update_event_plan când nu era cazul)                    |
| **misunderstood_client**  | AI-ul nu a înțeles ce voia clientul                                                      |
| **should_have_clarified** | AI-ul a răspuns dar ar fi trebuit să ceară clarificare                                   |
| **wrong_memory_usage**    | AI-ul a folosit memorie/context greșit (alt client, alt plan)                            |
| **unnecessary_question**  | AI-ul a pus o întrebare la care deja avea răspunsul                                      |

---

## 3. Cazuri sensibile

### Client nervos

- **Nu lăsa AI-ul să răspundă automat**
- Preia manual cu empatie
- Marchează conversația cu escalation flag

### Client recurent cu conflict

- Verifică memory/relationship data
- Dacă AI-ul confundă planuri → marchează `wrong_memory_usage`
- Preia manual

### Booking deja existent

- AI-ul NU trebuie să confirme/modifice booking-ul
- Orice reply pe conversații cu booking activ → review manual
- Marchează `dangerous` dacă AI-ul a încercat modificare

### Cerere de anulare

- NU se anulează automat
- Preia manual, confirmă cu clientul
- Marchează `dangerous` dacă AI-ul a anulat ceva

### Cerere juridică / financiară

- NU se răspunde automat
- Preia operatorul sau admin-ul
- Marchează `dangerous` dacă AI-ul a răspuns

### Mesaj pe care agentul nu l-a înțeles

- Marchează `misunderstood_client`
- Răspunde manual
- Notează ce a mers greșit (ajută la îmbunătățire)

---

## 4. Reguli

### Când preiei MANUAL

- Client nervos sau nemulțumit
- Conversație cu booking activ
- Cerere de anulare/confirmare finală
- Mesaj juridic/financiar
- AI-ul a dat reply de 2 ori (duplicate)
- Safety class = `blocked_autoreply`

### Când lași AI-ul

- Mesaj simplu de salut
- Cerere nouă clară
- Discovery/colectare informații
- Safety class = `safe` sau `needs_review` cu reply corect

### Când raportezi incident

- Duplicate outbound (2 reply-uri la același mesaj)
- Reply trimis automat greșit
- Confirmare booking neautorizată
- Wrong client / wrong plan
- Orice `dangerous`

### Când ceri blocarea rollout-ului

- 2+ incidente Sev1 în 24h
- Orice dangerous autoreply care a ajuns la client
- Duplicate outbound multiple
- AI răspunde haotic / fără sens
