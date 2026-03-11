# Plan de Implementare Android: Creier AI (Schema-Driven UI)

Aceasta este planificarea tehnică strictă pentru aducerea componentelor din Server 2 (ManagerAi) nativ în aplicația de Android Jetpack Compose (`wa-agent-app`).

## 1. Unde intră tabul în `ConversationScreen.kt`

- Vom adăuga un `TabRow` cu 2 segmente ("Chat" și "Creier AI") sub `TopAppBar` al layout-ului curent.
- View-ul tradițional bazat pe `LazyColumn` (pentru mesaje live via WebSocket) va rămâne complet intact și va rula la selectarea tabului "Chat".
- Când selectăm "Creier AI", o corutină de UI va face un HTTP GET către ManagerAi (`/api/ai/conversation/:id/schema`) pentru a randa UI-ul dorit de inteligența artificială.
- Formularele operatorului vor fi susținute de `Tab AI Prompt` poziționat inferior, ca alternativă pentru bara clasică de scriere a mesajelor.

## 2. Arhitectura HTTP, Repo și ViewModel

- **Client HTTP:** Vom folosi stiva nativă corutiniată bazată pe `HttpURLConnection` izolată într-un `AiRepository.kt` pentru a nu polua build-ul existent cu Retrofit if not present, sau Retrofit complet izolat la nivel de `features/chat/ai`.
- **Repository:** Metode simple: `fetchAiSchema(convId)` și `submitAiAction(payload)`.
- **ViewModel:** Vom integra `val aiSchema = mutableStateOf<List<AiSchemaNode>>` și loading states. Rulăm request-ul folosind `Dispatchers.IO`.

## 3. Modele DTO (Kotlin Data Classes)

- **Locație**: `features/chat/src/main/java/com/superpartybyai/features/chat/ai/AiSchemaModels.kt`
- Vor fi marcate `@Serializable` folosind `kotlinx.serialization` pentru JSON deserialization.

```kotlin
@Serializable
data class AiSchemaNode(
    val type: String,
    val title: String? = null,
    val text: String? = null,
    val children: List<AiSchemaNode>? = null,
    val fields: List<AiFormField>? = null,
    val items: List<AiSchemaItem>? = null,
    val submitAction: String? = null,
    val submitLabel: String? = null
)
```

## 4. Renderer Schema-Driven

- Se va crea un component Compose `AiSchemaRenderer(nodes: List<AiSchemaNode>)`.
- Rendererul va itera peste arborii de JSON și va folosi `when (node.type)` pentru a transpune în native Compose.

## 5. Suport Minin pentru Blocuri UI

Aplicația Android trebuie să onoreze perfect (fără coduri hardocate specifice business-ului) minim 6 tipuri fundamentale cerute de ManagerAi (Server 2):

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
