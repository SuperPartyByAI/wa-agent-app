# Superparty Event Operations System (wa-agent-app)

A full-stack, AI-orchestrated modular architecture designed to unify WhatsApp business messaging, 3CX Telephony, and a complete Client & Event CRM.

## Architectural Topology

1. **`backend/` (Open-WA Node.js)**: Multi-session WhatsApp Web manager bridging message sockets and pushing Webhooks to the 3CX PBX and the central Database.
2. **`app/` & `features/` (Android Native, Kotlin)**: The Jetpack Compose application empowering Staff/Agents on the field with live WhatsApp inboxes, Event assignments, and 3CX call tracking via Supabase sync.
3. **Database (`supabase_schema_system.sql`)**: The master Postgres intelligence hub (live on Supabase Cloud) containing `events`, `clients`, `conversations`, `employees`, `tasks`, and the `ai_extractions`.

---

## What is Complete (Milestones 1-3)

### ✅ Fully Implemented

- **WhatsApp Core (`backend/`)**: Robust auto-recovering multi-session node engine, isolated disk storage, dynamic connection health API, and protected sender endpoint.
- **3CX PBX Hook**: Implemented `/3cx/event` receiving payloads for PBX inbound tracking routing logic.
- **Supabase Cloud Infrastructure**: 100% deployed and verified. 17 scalable relational tables mapping the full Event Operations CRM, including Auth Users, Roles logic, Call Events, and RLS policies.
- **Android Client Shell**: Jetpack Compose multi-module architecture (`auth`, `chat`, `calls`) built exactly as a scalable enterprise app cleanly mapped to dependencies.

### 🟨 Demo / Mocked Work-in-Progress

- **Android UI Data Binding**: `InboxScreen`, `ConversationScreen`, and `CallsScreen` currently render perfectly but use mocked mock-ups (not yet hooked to Realtime Supabase).
- **Google Login Activity**: Front-end identity components are active but simulate login success, awaiting `google-services`.
- **Event Management Interfaces**: Wait-listed, schema exists, but `EmployeeList` and `TaskBoard` are next for Android.

### ⏳ Pending

- Integration of the Python/Node **AI Extractor Agent** taking inbound calls/messages and producing draft JSON structures in `ai_extractions`.
- Active Jetpack Compose bindings to Postgres (Supabase PostgREST) to populate the Inbox dynamically.
- Final Hetzner deployment scripts for Node.js production.

---

## Setup & Missing Dependencies

### Backend (`/backend/`)

You need a local `.env` block based on `.env.example`.
**Missing:** Real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the backend to log messages securely. Active 3CX internal API keys if direct 3CX softphone call control is extended.

### Android

**Missing:** The `google-services.json` metadata file (Firebase/Google Cloud) is required inside `app/` so the Android OS knows how to authenticate the Google Identity token with Supabase Auth GoTrue.
