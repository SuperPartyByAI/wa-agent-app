import dotenv from 'dotenv';
dotenv.config();

// ─── Supabase ───
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Gemini API (primary) ───
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GEMINI_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '30000', 10);

// ─── Local LLM (Ollama fallback) ───
export const LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434';
export const LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b';
export const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '180000', 10);

// ─── Auto-reply safety ───
export const AI_AUTOREPLY_ENABLED = process.env.AI_AUTOREPLY_ENABLED === 'true';
export const AI_AUTOREPLY_CUTOFF = process.env.AI_AUTOREPLY_CUTOFF || null;
// Stages that block auto-reply (conversation already managed)
export const BLOCKED_STAGES = ['booked', 'confirmed', 'paid', 'completed', 'coordination'];
// Minimum confidence for auto-reply
export const MIN_AUTOREPLY_CONFIDENCE = parseInt(process.env.MIN_AUTOREPLY_CONFIDENCE || '75', 10);

// ─── WhatsApp transport (whts-up) ───
export const WHTSUP_API_URL = process.env.WHTSUP_API_URL || 'http://5.161.179.132:3000';
export const WHTSUP_API_KEY = process.env.WHTSUP_API_KEY || process.env.API_KEY;

// ─── Feature flags ───
export const ENTITY_MEMORY_ENABLED = process.env.ENTITY_MEMORY_ENABLED !== 'false'; // default ON

// ─── Phase 2: Shadow Mode + Safe Autoreply ───
export const AI_SHADOW_MODE_ENABLED = process.env.AI_SHADOW_MODE_ENABLED === 'true'; // default OFF
export const AI_SAFE_AUTOREPLY_ENABLED = process.env.AI_SAFE_AUTOREPLY_ENABLED === 'true'; // default OFF
export const AI_FULL_AUTOREPLY_ENABLED = process.env.AI_FULL_AUTOREPLY_ENABLED === 'true'; // default OFF
export const AI_SAFE_AUTOREPLY_MIN_CONFIDENCE = parseInt(process.env.AI_SAFE_AUTOREPLY_MIN_CONFIDENCE || '75', 10);
export const AI_AUTOREPLY_ALLOWED_STAGES = (process.env.AI_AUTOREPLY_ALLOWED_STAGES || 'new_lead,greeting,discovery').split(',').map(s => s.trim());
export const AI_AUTOREPLY_ALLOWED_TOOLS = (process.env.AI_AUTOREPLY_ALLOWED_TOOLS || 'reply_only').split(',').map(s => s.trim());
