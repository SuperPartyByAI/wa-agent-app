# Reply Quality Calibration — Criterii și Exemple

## Criteriile de calitate pentru reply-uri AI

### Ce înseamnă un reply BUN

- **Scurt**: max 2-3 propoziții
- **Natural**: sună ca un operator bun de WhatsApp
- **Concret**: menționează serviciile detectate pe nume
- **Service-aware**: confirmă ce a înțeles din cererea clientului
- **Una la un moment**: pune maxim 1 întrebare critică
- **Memory-aware**: nu re-întreabă ce știm deja
- **Cald dar nu fals**: 1-2 emoji, ton prietenos dar autentic

### Ce înseamnă un reply SLAB

- **Generic**: "vă putem ajuta cu ce aveți în minte" (nu confirmă nimic concret)
- **Robotic**: "avem nevoie de următoarele informații" (ton corporate)
- **Checklist**: enumerare de 4-5 câmpuri lipsă într-un singur mesaj
- **Vag**: "spuneți-ne mai multe detalii" (nu direcționează conversația)
- **Prea lung**: mini-email cu paragrafe și explicații
- **Memory-blind**: re-întreabă locația când o știm deja

---

## Exemple de calibrare

### A. Client nou — serviciu simplu, lipsește data

**Context**: animator detectat, data lipsește

✅ **BUN**: "Buna! Sigur, va putem ajuta cu animator 😊 Pentru ce data aveti petrecerea?"

- Label: `good` | Flags: `good_service_specificity, good_next_question, good_length`

❌ **SLAB**: "Buna! Va multumim pentru mesaj. Sigur, va putem ajuta cu ce aveti in minte astazi?"

- Label: `weak` | Flags: `not_service_specific, too_generic, no_question_asked`

❌ **ROBOTIC**: "Buna! Pentru animator avem nevoie de data, locatia, ora si numarul de copii."

- Label: `weak` | Flags: `too_many_questions, checklist_like`

---

### B. Client nou — servicii multiple, lipsește data

**Context**: animator + vata_zahar detectate, data lipseste

✅ **BUN**: "Salut! Da, avem animator si vata de zahar. Cam pe ce data va ganditi? 😊"

- Label: `good` | Flags: `good_service_specificity, good_next_question`

❌ **SLAB**: "Buna! Suntem la dispozitie sa va ajutam cu orice aveti nevoie."

- Label: `weak` | Flags: `not_service_specific, too_generic`

---

### C. Client recurent — locație cunoscută

**Context**: entity_memory: locatie=Kiddo Fun, servicii_uzuale=[animator], petrecere noua

✅ **BUN**: "Buna! Ne bucuram ca reveniti 😊 Petrecerea e tot la Kiddo Fun sau de data asta in alta parte?"

- Label: `good` | Flags: `memory_used_well, good_next_question`

❌ **SLAB**: "Buna! Sigur, va ajutam cu drag. Care este locatia evenimentului?"

- Label: `okay` | Flags: `poor_memory_use`

---

### D. Colaborator

**Context**: entity_type=collaborator, animator detectat

✅ **BUN**: "Salut! Da, putem acoperi animatorul. Ce data exact?"

- Label: `good` | Flags: `good_service_specificity, good_next_question, good_length`

---

### E. Follow-up operativ

**Context**: stage=coordination, data și locatia знам

✅ **BUN**: "Am notat. Va confirmam disponibilitatea in scurt timp."

- Label: `good` | Flags: `good_length`

---

## Dimensiuni evaluate automat

| Dimensiune          | Ce verifică                                | Penalizare                  |
| ------------------- | ------------------------------------------ | --------------------------- |
| Service specificity | Reply-ul menționează serviciile detectate? | -20 dacă nu                 |
| Question count      | Câte întrebări pune? (ideal: 1)            | -10 daca 0, -15 daca >2     |
| Length              | 15-200 chars ideal                         | -15 dacă >300, -20 dacă <15 |
| Robotic patterns    | Detectează formulări corporate             | -10 per pattern             |
| Generic vagueness   | "vă putem ajuta cu ce aveți în minte" etc. | -15 per pattern             |
| Memory reuse        | Folosește memoria sau re-întreabă?         | -10 per miss                |
| Checklist detection | 4+ virgule = probabil enumerare            | -10                         |
| Composer fallback   | A căzut pe draft analysis?                 | -20                         |
| Emoji count         | 1-2 OK, >3 prea mult                       | -5 dacă >3                  |

## Score → Label

| Score  | Label  |
| ------ | ------ |
| 80-100 | `good` |
| 50-79  | `okay` |
| 0-49   | `weak` |
