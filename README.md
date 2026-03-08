# WhatsApp Agent Integration - Android Native App

This is a modular Android client built purely in Kotlin + Jetpack Compose. It connects to the overarching Node.js Hetzner backend for Open-WA routing and directly to Supabase for User Auth, Roles, and Real-Time Chat synchronization.

## Architecture Layering
- **app**: The main entry point integrating all features.
- **core**: Fundamental networking, Supabase SDK configurations, and DI.
- **features**: Feature modules (Auth, Chat, Calls) allowing for fast, isolated compilation.

### Running the App
1. Open this directory in **Android Studio Minimum Iguana | 2023.2.1+**.
2. Run gradle sync.
3. Apply your `google-services.json` config to `app/` when connecting Firebase/Google Login.
4. Execute via Debug or `./gradlew assembleDebug`.
