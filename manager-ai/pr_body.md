## Description

Acest PR implementează o tranziție completă a sistemului de **"Roluri & Logică"** (Admin UI -> AI Composer) de la un format nesigur de free-text, la o arhitectură strictă de **Commercial Policy Engine** validată prin `JSONB`.

### Modificări Arhitecturale

1. **Registry Centralizat (`approvedRoleRegistry.mjs`)**: Whitelist hardcodat cu cele 10 roluri comerciale oficiale. Niciun rol "inventat" nu poate intra în pipeline.
2. **Schema Validată (`roleConfigSchema.mjs`)**: Formularul UI este compilat într-un obiect strict (1. Identitate, 2. Declanșatori, 3. Prețuri, 4. Transport, 5. Constrângeri, 6. Copy Blocks).
3. **Admin UI Refactored (`admin-suite.html`)**: Eliminarea `<textarea>`-ului capcană. Fiecare variabilă ("Activ", "Prioritate", "Tags", "Bază", "Oră Extra") are acum input/checkbox explicit conform noii scheme JSON.
4. **Activare Structurată (`knowledgeMatcher.mjs`)**: Injectarea logică se face bazată pe `active: true/false`, folosind string match pe `service_tags`, fallback pe regex cu încredere pe `keywords`, și rezolvare de conflicte prin sortare după `priority`.
5. **Prompt Injection (`buildActiveCommercialPoliciesBlock.mjs`)**: Injectează în `systemPrompt` doar un bloc standardizat de prețuri numerice citibile de LLM și enforcează strict `replyComposerPrompt.mjs` să nu devieze de la numere.

---

## Testing Examples (Live Behavior)

### Exemplu 1: Activare Prioritară (Conflict Handled)

- **Mesaj**: "Vreau vată de zahăr."
- **Condiții UI setate**: Rol 'Vata de zahar' setat la `priority: 150`, Rol fallback setat la `priority: 100`.
- **Rezultat**: `knowledgeMatcher.mjs` selectează ambele dacă triggerează, dar sortează descrescător. Promptul primește logică prioritară pentru vata de zahăr la vârful `activeRoles`, dominând atenția modelului AI.

### Exemplu 2: Respectarea Prețului OBLIGATORIU

- **Mesaj**: "Cât mă costă Vata de zahăr 1 oră? Poți face o preț mai bun?"
- **Condiții UI setate**: `base_price: 600`, `allow_discounts: false`.
- **Rezultat**: Prin regulile din composer, AI-ul **NU** aplică discount și răspunde ferm: _"Buna! Pretul pentru vata de zahar este de 600 RON._", protejând baza comercială oficială.

### Exemplu 3: Blocare Conversație fără Date Obligatorii

- **Mesaj**: "Vreau vată de zahăr."
- **Condiții UI setate**: `must_collect_fields: ["date", "location"]`, `must_not_confirm_availability: true`.
- **Rezultat**: În loc de _"Sigur, e liber!"_, AI-ul este forțat să ceară datele: _"Vă putem oferi serviciul. Pentru a verifica mașina, îmi puteți spune Data și Locația evenimentului?"_
