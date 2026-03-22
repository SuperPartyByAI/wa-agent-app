# Plan de Implementare Android: Creier AI (Schema-Driven UI)

# Arhitectura: Detecția Automată a Serviciilor (Ex: Spiderman -> Animator)

## Goal Description

Clientul ne scrie adesea direct personajul (ex: "Aveți Spiderman?", "Vreau 2 prințese") sau obiectul dorit (ex: "Vreau și aparat de floricele"). AI-ul trebuie să facă legătura automat între limbajul natural al clientului și cheile noastre tehnice de servicii (ex: `animator`, `popcorn`, `ursitoare`).

Vrem să implementăm un sistem stabil și ușor de antrenat pentru recunoașterea acestor tipare, începând cu serviciul `animator` (și personajele aferente).

## Recomandarea Arhitecturală

Analizând codul actual din `manager-ai`, sistemul folosește deja un fișier foarte curat numit `manager-ai/src/services/catalog.json` care este injectat direct în creierul (promptul) AI-ului. Aici există deja `animator`, cu detalii despre el.

Avem două direcții mari. Recomandarea mea fermă este **Varianta 1 (Dicționarul în Catalog)**.

### Varianta 1: Extinderea `catalog.json` cu Vocabular/Cuvinte Cheie (RECOMANDAT 🥇)

**Cum funcționează:**
Adăugăm un câmp nou `keywords` (sau `vocabulary`) pentru fiecare serviciu direct în `catalog.json`.
Când populăm promptul AI-ului, îi dăm pe lângă nume și descriere, și aceste cuvinte cheie.

- Ex `animator`: `["spiderman", "batman", "elsa", "printese", "mascote", "clovn", "animatie"]`
- Ex `popcorn`: `["floricele", "aparat de floricele", "stand popcorn"]`

**Avantaje:**

- Foarte ieftin ca procesare (consumă puține token-uri).
- Rapid de implementat tehnic (doar modificăm JSON-ul și funcția care generează promptul).
- Precis și strict.

### Varianta 2: Folosirea Tabelului `ai_brain_rules` din Baza de Date

**Cum funcționează:**
Adăugăm reguli scrise în limbaj natural direct în baza de date pe care o controlezi din panoul de Admin: _"Dacă clientul cere detalii despre Spiderman, Batman sau Elsa, selectează serviciul 'animator'"_.

**Avantaje:**

- Le poți modifica tu direct dintr-o interfață (fără să umblăm în codul sursă `catalog.json`).
- Permite reguli complexe de derivare (ex: "Dacă cere Spiderman DAR e botez, întreabă dacă e sigur, că de obicei la botez se iau ursitoare").

## Proposed Changes (Pentru Varianta 1)

Dacă mergem pe Varianta 1:

### 1. `manager-ai/src/services/catalog.json`

- [MODIFY] Adăugăm un array `"keywords"` la serviciul `animator` cu cele mai comune personaje/termeni folosiți de clienți.

### 2. `manager-ai/src/services/postProcessServices.mjs`

- [MODIFY] Funcția `buildCatalogPromptBlock()` va fi actualizată pentru a injecta `s.keywords.join(', ')` în textul care pleacă spre AI, dându-i instrucțiunea clară: _"Dacă clientul folosește oricare din aceste cuvinte, asociază-l cu acest serviciu."_

### 3. Modificare Bază Date (Opțional pentru viitor)

- Dacă te hotărăști pe viitor că vrei să schimbi mereu aceste keywords din UI, le putem stoca într-un tool din Superparty Admin. Momentan, pentru stabilitate, hardcodarea în JSON este ideală.

## Aprobare Necesară

Ce variantă preferi?
Mergem pe **Varianta 1 (Rapidă și curată în Codul Catalogului)** sau vrei **Varianta 2 (Dinamică din Baza de date, dar puțin mai grea pentru AI)**?tale cerute de ManagerAi (Server 2):

1. **`card`**: Redat ca un `ElevatedCard` curat conținând un titlu opțional și children recurisvi în body.
2. **`section`**: Redat ca un `Column` lat, distinctiv, folosit la gruparea de conținut.
3. **`form_card`**: Combină layout-ul standardizat cu inputuri `OutlinedTextField` readonly pentru afișarea metadatelor necesare, bazat pe o listă `items`.
4. **`actions`**: Un grup de taste primare. Redat ca un `Row` uniform cu `Button` Compose pentru flow-uri critice. Toate trimit funcții callback via `onAction`.
5. **`chips`**: Layout compact pentru status sau atingeri rapide (`AssistChip` Compose API).
6. **`collapsible_group`**: Permite gruparea de date ascunse default pentru curățenia vizuală. Extensibil on/off cu stocare locală bazată pe `remember { mutableStateOf(false) }`.

## 6. Mecanica Fallback

Nu există date lipsă pe Android dacă AI-ul nu a generat un JSON valid la timp.

- Nodurile de Backend: Dacă `/schema` întoarce 404/Empty, Node.js va întoarce o structură curată de analiză neutră (un "card" care afișează "Analiza în desfășurare...").
- Fallback in Compose: Dacă randatorul dă peste un node type neașteptat din backend, folosește clauza `else -> Text("Unknown Component")` pentru a preveni crash-ul View-ului.
