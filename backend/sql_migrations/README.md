# AI SQL Migrations

These migration files create the foundational AI schema for Server-Driven UI in the Superparty app.

## Execution Order and Dependencies

1. **`002_ai_schema_baselines.sql`**: Creates the base AI tables (`ai_conversation_state`, `ai_client_memory`, `ai_event_drafts`, `ai_operator_prompts`, `ai_ui_schemas`). Depends on existing `conversations` and `clients` tables.
2. **`003_collaborator_onboarding_schema.sql`**: Extends collaborator and staff schemas (optional for the core text pipeline).
3. **`004_ai_schema_policies_and_triggers.sql`**: (NEW) Adds PostgreSQL triggers for strictly updating the `updated_at` timestamps on row modifications. Applies necessary RLS policies to allow the Android client to read elements (like `ai_ui_schemas`) directly if bypassing the ManagerAi Node endpoint. Depends on 002.

## How to Apply

To apply these migrations safely on the live Supabase instance:

1. Navigate to your Supabase Dashboard -> SQL Editor.
2. Open each file (`002`, `003`, `004`) in sequential order.
3. Click "Run" on each file and verify that the success message appears. Do not proceed to the next script if the previous one fails.
