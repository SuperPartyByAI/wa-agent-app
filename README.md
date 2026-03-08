# SuperParty AI Agent App

The unified Hub for the AI Event Coordinator, bridging Google Authentication, full WhatsApp QR injection, 3CX Telephony, and Supabase synchronization.

## Features

- **Native Google Login**: Natively powered by the Android 14+ Credential Manager. Automatically syncs JWT identities with Supabase Edge Postgres.
- **WhatsApp Web Injection**: Connects to the Baileys worker over REST (`POST /api/sessions/start`) securely using `X-API-KEY`. Generates dynamic QR matrices strictly inside the application.
- **AI Worker Processing**: The background backend runs `ai-worker.js`, auto-drafting event proposals with event dates, themes, and guest counts based on real-time LLM entity extraction from Supabase Tables (`call_events` and `messages`).
- **Complete Feature Flags**: Live synchronization for `InboxScreen`, `ConversationScreen`, `CallsScreen`, and `EventsListScreen`. All components leverage reactive Supabase Compose Listeners.

## Installation & Deployment

1. Clone repository.
2. Ensure you have the secure tokens. Copy `local.properties.example` into `local.properties` and populate:
   - `WEB_CLIENT_ID` (Your exact Google Web Application Client ID)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (Supabase publishable key `sb_publishable...` or `anon_key` JWT)
   - `BACKEND_URL` (IP of the active Open-WA API Server)
   - `API_KEY` (Symmetric Security Token matched with Backend)
3. Ensure the Backend environment (.env based on `backend/.env.example`) matches the App configuration exactly.
4. From the root directory, compile via the daemon: `./gradlew assembleDebug`
5. Connect your device via ADB and execute: `adb install -r app/build/outputs/apk/debug/app-debug.apk`

_Note: Native Android Login strictly requires an `Android Client ID` footprint dynamically mapped in Google Console using your local machine's `debug.keystore` SHA-1 fingerprint._
