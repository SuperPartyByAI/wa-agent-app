# Superparty Event Operations System (wa-agent-app)

A full-stack, AI-orchestrated modular architecture designed to unify WhatsApp business messaging, 3CX Telephony, and a complete Client & Event CRM.

## Architectural Topology

1. **`backend/` (Open-WA Node.js & AI Worker)**: Multi-session WhatsApp Web manager bridging message sockets and pushing Webhooks to the 3CX PBX and the central Database. Features an intelligent background extractor for auto-drafting Events dynamically.
2. **`app/` & `features/` (Android Native, Kotlin)**: The Jetpack Compose application empowering Staff/Agents on the field with live WhatsApp inboxes, AI Event assignments, and 3CX call tracking natively synchronised via Supabase PostgREST Realtime hooks.
3. **Database (`supabase_schema_system.sql`)**: The master Postgres intelligence hub (live on Supabase Cloud) containing `events`, `clients`, `conversations`, `employees`, `tasks`, and the `ai_extractions`.

---

## Technical Delivery: 100% Core CRM Infrastructure Complete

### 1. Google Login Real (Supabase Auth)

- Integrated `androidx.credentials` natively routing Google tokens.
- Bound Supabase GoTrue backend client directly into `AuthScreen` discarding mock loops.
- Set up automated Postgres triggers `on_auth_user_created` bridging Auth to `profiles`.

### 2. Inbox WhatsApp Real

- Re-architected Node.js Open-WA bridge to auto-provision `clients` and `conversations`.
- Hooked `InboxScreen.kt` and `ConversationScreen.kt` deeply into Supabase PostgREST for true two-way Android sync of WhatsApp payloads.

### 3. Calls Screen Real

- Bound the 3CX PBX `/3cx/event` Webhooks into local Postgres inserts.
- Wired Android Jetpack Compose List `CallsScreen` accurately parsing real Caller states.

### 4. Event Draft Automat

- Injected backend regex patterns scanning inbound text strings to passively capture intention.
- Implemented Supabase direct-insertion mapping these queries to new `draft` elements traversing immediately across the entire operations mesh.

### 5. Android Event Screen

- Fully prototyped the AI Events GUI into Android UI state-machines natively retrieving joined Client details from the PostgREST plugin mappings. Added to Main router.

### 6. Structură AI Agent Node

- Scaffolded `ai-worker.js`, creating persistent websockets querying `messages` and `call_events` PostgreSQL mutations natively.
- Auto-extracts LLM structured context bridging `messages` to real-time `ai_extractions` & generates smart-reply structures inside `ai_actions` logic pools continuously.

## Setup & Execution

### Android

Requirements: Pull down `google-services.json` from the Firebase Dashboard (tied to `com.superpartybyai.waagentapp`) into root `app/` environment or Credentials API will decline launch.

### Backend (`/backend/`)

Requirements: Deploy using Node >= 18. Provide actual API string mappings inside `.env` matching your live Hetzner architecture and Supabase Service Role identities to bootstrap background processes securely.
