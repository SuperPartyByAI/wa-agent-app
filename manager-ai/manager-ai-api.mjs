/**
 * Manager AI — Vertex AI Edition
 * 
 * Server Express simplu care primește mesaje de pe WhatsApp (via whts-up)
 * și le procesează prin Vertex AI (Gemini + Function Calling).
 * 
 * Toate regulile AI sunt în Supabase (tabelul vertex_config) — editabile din dashboard.
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { processWithVertexAI, loadSystemPrompt, vertexDb } from './src/vertex/vertexClient.mjs';

dotenv.config();

const app = express();

const upload = multer({ storage: multer.memoryStorage() });

// ── Debounce: combină mesajele rapide într-un singur apel AI ──
const DEBOUNCE_MS = parseInt(process.env.AI_DEBOUNCE_MS || '8000', 10);
const debounceTimers = new Map();

app.use(cors());

// Serve static files (login.html, auth-guard.js, etc.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'public')));

// Root redirect — go to login if not authenticated
app.get('/', (req, res) => res.redirect('/login.html'));
app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); }
}));

// Supabase principal (pentru citirea conversațiilor din whts-up)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Config WhatsApp transport
const WHTSUP_API_URL = process.env.WHTSUP_API_URL || 'http://5.161.179.132:3000';
const WHTSUP_API_KEY = process.env.WHTSUP_API_KEY || process.env.API_KEY;

// ═══════════════════════════════════════════════════
// WEBHOOK: Primește mesaje de pe WhatsApp
// ═══════════════════════════════════════════════════
app.post('/webhook/whts-up', async (req, res) => {
    try {
        // Verificare semnătură
        const signature = req.headers['x-hub-signature'];
        const webhookSecret = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';
        
        if (signature) {
            const bodyStr = req.rawBody || JSON.stringify(req.body);
            const hash = `sha256=${crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex')}`;
            if (hash !== signature) {
                return res.status(403).json({ error: 'Invalid signature' });
            }
        }
        
        const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { message_id, conversation_id, content, sender_type, sender_phone } = payload;
        
        // Ignoră mesajele trimise de noi (agent)
        if (sender_type === 'agent' || sender_type === 'system') {
            return res.status(200).json({ status: 'ignored_outbound' });
        }

        console.log(`[Webhook] 📩 Mesaj de la ${sender_phone || 'unknown'} (conv: ${conversation_id})`);
        
        // Răspundem imediat la webhook (nu blocăm WhatsApp)
        res.status(200).json({ status: 'processing' });
        
        // Debounce: așteptăm puțin în caz că vin mai multe mesaje rapid
        const phoneNumber = sender_phone || conversation_id;
        const existing = debounceTimers.get(phoneNumber);
        
        if (existing) {
            clearTimeout(existing.timer);
            existing.messages.push(content);
            existing.count += 1;
            console.log(`[Debounce] ⏳ ${existing.count} mesaje de la ${phoneNumber}`);
        }
        
        const entry = existing || { messages: [content], count: 1, conversation_id };
        
        entry.timer = setTimeout(async () => {
            debounceTimers.delete(phoneNumber);
            
            // Combinăm toate mesajele într-unul singur
            const combinedMessage = entry.messages.join('\n');
            console.log(`[Pipeline] 🚀 Procesez ${entry.count} mesaj(e) de la ${phoneNumber}`);
            
            try {
                // === VERTEX AI: procesăm mesajul ===
                const result = await processWithVertexAI(phoneNumber, combinedMessage);
                
                console.log(`[Pipeline] ✅ Răspuns generat în ${result.latencyMs}ms`);
                if (result.functionCall) {
                    console.log(`[Pipeline] 🔧 Funcție executată: ${result.functionCall.name}`);
                }
                
                // Trimitem răspunsul pe WhatsApp
                if (result.reply) {
                    await sendWhatsAppReply(entry.conversation_id, result.reply);
                }
            } catch (err) {
                console.error(`[Pipeline] ❌ Eroare:`, err.message);
            }
        }, DEBOUNCE_MS);
        
        if (!existing) debounceTimers.set(phoneNumber, entry);
        
    } catch (e) {
        console.error('[Webhook] ❌ Eroare:', e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
    }
});

// ═══════════════════════════════════════════════════
// SEND: Trimite răspuns pe WhatsApp prin whts-up
// ═══════════════════════════════════════════════════
async function sendWhatsAppReply(conversationId, text) {
    try {
        // Obținem session_id din Supabase principal
        const { data: conv } = await supabase
            .from('conversations')
            .select('session_id')
            .eq('id', conversationId)
            .single();
        
        if (!conv?.session_id) {
            console.error(`[Send] ❌ Nu am găsit session_id pentru conv ${conversationId}`);
            return false;
        }
        
        const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WHTSUP_API_KEY
            },
            body: JSON.stringify({
                sessionId: conv.session_id,
                conversationId: conversationId,
                text: text,
                message_type: 'text'
            })
        });
        
        if (!response.ok) {
            const err = await response.text();
            console.error(`[Send] ❌ WhatsApp send failed:`, err);
            return false;
        }
        
        console.log(`[Send] ✅ Răspuns trimis pe WhatsApp (${text.length} chars)`);
        return true;
    } catch (err) {
        console.error(`[Send] ❌ Eroare trimitere:`, err.message);
        return false;
    }
}

// ═══════════════════════════════════════════════════
// HEALTH & STATUS ENDPOINTS
// ═══════════════════════════════════════════════════
app.get('/health', async (_req, res) => {
    try {
        // Test Vertex AI Supabase
        let vertexDbOk = false;
        if (vertexDb) {
            const { error } = await vertexDb.from('vertex_config').select('config_key').limit(1);
            vertexDbOk = !error;
        }
        
        // Test Vertex AI API
        let vertexApiOk = false;
        try {
            const apiKey = process.env.VERTEX_AI_API_KEY;
            const resp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
                { signal: AbortSignal.timeout(5000) }
            );
            vertexApiOk = resp.ok;
        } catch { vertexApiOk = false; }
        
        // Test Supabase principal
        let mainDbOk = false;
        try {
            const { error } = await supabase.from('conversations').select('id').limit(1);
            mainDbOk = !error;
        } catch { mainDbOk = false; }
        
        const healthy = vertexDbOk && vertexApiOk;
        
        res.json({
            healthy,
            version: 'vertex-ai-v1',
            vertex_ai_api: vertexApiOk ? '✅' : '❌',
            vertex_supabase: vertexDbOk ? '✅' : '❌',
            main_supabase: mainDbOk ? '✅' : '❌',
            uptime_seconds: Math.round(process.uptime()),
            memory_mb: Math.round(process.memoryUsage().rss / 1048576),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ healthy: false, error: err.message });
    }
});

// Prompt-ul de sistem (editabil din Supabase)
app.get('/api/ai/config', async (_req, res) => {
    try {
        if (!vertexDb) return res.json({ config: [] });
        const { data, error } = await vertexDb.from('vertex_config').select('*');
        if (error) throw error;
        res.json({ config: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Actualizare config (ex: schimbă prompt-ul din API)
app.put('/api/ai/config/:key', express.json(), async (req, res) => {
    try {
        if (!vertexDb) return res.status(500).json({ error: 'No Vertex DB' });
        const { key } = req.params;
        const { value } = req.body;
        if (!value) return res.status(400).json({ error: 'value is required' });
        
        const { error } = await vertexDb.from('vertex_config')
            .update({ config_value: value, updated_at: new Date().toISOString(), updated_by: 'api' })
            .eq('config_key', key);
        
        if (error) throw error;
        res.json({ status: 'updated', key });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vizualizare sesiuni active
app.get('/api/ai/sessions', async (req, res) => {
    try {
        if (!vertexDb) return res.json({ sessions: [] });
        const limit = parseInt(req.query.limit || '20', 10);
        const { data, error } = await vertexDb.from('vertex_sessions')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ sessions: data, count: data?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Vizualizare evenimente/petreceri înregistrate
app.get('/api/ai/events', async (req, res) => {
    try {
        if (!vertexDb) return res.json({ events: [] });
        const limit = parseInt(req.query.limit || '20', 10);
        const { data, error } = await vertexDb.from('vertex_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ events: data, count: data?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Istoric mesaje pentru o sesiune
app.get('/api/ai/sessions/:sessionId/messages', async (req, res) => {
    try {
        if (!vertexDb) return res.json({ messages: [] });
        const { data, error } = await vertexDb.from('vertex_messages')
            .select('*')
            .eq('session_id', req.params.sessionId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ messages: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Audit trail (acțiuni executate)
app.get('/api/ai/actions', async (req, res) => {
    try {
        if (!vertexDb) return res.json({ actions: [] });
        const limit = parseInt(req.query.limit || '20', 10);
        const { data, error } = await vertexDb.from('vertex_action_logs')
            .select('*')
            .order('executed_at', { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ actions: data, count: data?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Test manual: trimite un mesaj direct la Vertex AI
app.post('/api/ai/test', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ error: 'phone and message are required' });
        }
        const result = await processWithVertexAI(phone, message);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════
// AUTH API — Autentificare angajați
// ═══════════════════════════════════════════════════

// Helper: get session from token
async function getSession(token) {
    if (!token || !vertexDb) return null;
    const { data } = await vertexDb.from('employee_sessions')
        .select('*, employees(*)')
        .eq('session_token', token)
        .gt('expires_at', new Date().toISOString())
        .single();
    return data;
}

// Helper: generate secure session token
function generateToken() {
    return crypto.randomBytes(48).toString('base64url');
}

// Check current session
app.get('/api/auth/check', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = await getSession(token);
        
        if (!session) {
            return res.json({ authenticated: false });
        }

        const emp = session.employees;
        res.json({
            authenticated: true,
            employee_id: session.employee_id,
            email: session.google_email,
            name: session.google_name || emp?.name || session.google_email,
            avatar: session.google_avatar,
            role: emp?.role || 'employee',
            onboarding_status: emp?.onboarding_status || 'pending'
        });
    } catch (err) {
        res.json({ authenticated: false, error: err.message });
    }
});

// Process Onboarding Form (Upload ID & Selfie)
app.post('/api/auth/onboarding', upload.fields([{ name: 'idDocument', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = await getSession(token);
        if (!session) return res.status(401).json({ success: false, error: 'Unauthorized' });

        const { contractSigned } = req.body;
        const idFile = req.files['idDocument']?.[0];
        const selfieFile = req.files['selfie']?.[0];

        if (!idFile || !selfieFile || contractSigned !== 'true') {
            return res.status(400).json({ success: false, error: 'Incomplete onboarding data' });
        }

        const eid = session.employee_id;
        const timestamp = Date.now();

        // Upload to Supabase Storage
        const extId = idFile.originalname.split('.').pop();
        const extSelfie = selfieFile.originalname.split('.').pop();
        
        const idPath = `${eid}/id_${timestamp}.${extId}`;
        const selfiePath = `${eid}/selfie_${timestamp}.${extSelfie}`;

        const { error: err1 } = await vertexDb.storage.from('employee_docs').upload(idPath, idFile.buffer, { contentType: idFile.mimetype });
        if (err1) throw new Error(`Upload ID failed: ${err1.message}`);

        const { error: err2 } = await vertexDb.storage.from('employee_docs').upload(selfiePath, selfieFile.buffer, { contentType: selfieFile.mimetype });
        if (err2) throw new Error(`Upload Selfie failed: ${err2.message}`);

        const { data: idUrlData } = vertexDb.storage.from('employee_docs').getPublicUrl(idPath);
        const { data: selfieUrlData } = vertexDb.storage.from('employee_docs').getPublicUrl(selfiePath);

        // TODO: Call Gemini AI for facial recognition 
        const aiMatch = true; // Placeholder until integrated
        const matchScore = 0.95;
        const status = aiMatch ? 'ai_verified' : 'pending_manual_review';

        // Update DB
        const { error: dbErr } = await vertexDb.from('employees')
            .update({
                id_photo_url: idUrlData.publicUrl,
                selfie_url: selfieUrlData.publicUrl,
                contract_signed_at: new Date().toISOString(),
                ai_face_match_score: matchScore,
                ai_face_match_result: aiMatch ? 'Match' : 'Mismatch',
                onboarding_status: status
            })
            .eq('id', eid);

        if (dbErr) throw new Error(`DB Update failed: ${dbErr.message}`);

        res.json({ success: true, aiMatch, status });
    } catch (err) {
        console.error('[Onboarding Error]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin login with token
app.post('/api/auth/admin-login', async (req, res) => {
    try {
        const { email, token } = req.body;
        const adminToken = process.env.ADMIN_API_TOKEN;
        
        if (!token || token !== adminToken) {
            return res.status(401).json({ success: false, error: 'Token invalid' });
        }

        if (!vertexDb) {
            return res.status(500).json({ success: false, error: 'Database not configured' });
        }

        // Find or create admin employee
        let { data: emp } = await vertexDb.from('employees')
            .select('*')
            .eq('google_email', email)
            .single();

        if (!emp) {
            const { data: newEmp, error } = await vertexDb.from('employees')
                .insert({
                    name: email.split('@')[0],
                    email: email,
                    google_email: email,
                    role: 'admin',
                    onboarding_status: 'admin_approved'
                })
                .select()
                .single();
            if (error) throw error;
            emp = newEmp;
        }

        // Create session
        const sessionToken = generateToken();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        await vertexDb.from('employee_sessions').insert({
            employee_id: emp.id,
            session_token: sessionToken,
            google_email: email,
            google_name: emp.name || 'Admin',
            expires_at: expiresAt.toISOString()
        });

        res.json({ success: true, session_token: sessionToken, role: 'admin' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Google OAuth — Auto-Login bypassing for Test (ursache.andrei1995@gmail.com)
app.get('/api/auth/google', async (req, res) => {
    try {
        const email = 'ursache.andrei1995@gmail.com';
        const name = 'Andrei Ursache';
        
        let { data: emp, error: userErr } = await vertexDb.from('employees')
            .select('id, role, onboarding_status')
            .eq('google_email', email)
            .single();
            
        if (userErr && userErr.code === 'PGRST116') { // Nu exista
            const { data: newEmp, error: insertErr } = await vertexDb.from('employees').insert({
                google_email: email,
                auth_user_id: crypto.randomUUID(),
                role: 'admin',
                onboarding_status: 'admin_approved',
                email: email,
                name: name
            }).select().single();
            
            if (insertErr) throw insertErr;
            emp = newEmp;
        }

        const token = crypto.randomBytes(32).toString('hex');
        const { error: sessionErr } = await vertexDb.from('employee_sessions').insert({
            employee_id: emp.id,
            session_token: token,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            google_email: email
        });

        if (sessionErr) throw sessionErr;

        res.redirect(`/login.html?session_token=${token}&onboarding_status=${emp.onboarding_status}`);
    } catch (err) {
        console.error('[Google Auto-Login Error]', err);
        res.redirect('/login.html?error=Eroare la auto-login Google bypass.');
    }
});

// Logout
app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token && vertexDb) {
            await vertexDb.from('employee_sessions')
                .delete()
                .eq('session_token', token);
        }
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true }); // Always succeed
    }
});

// ── Admin: Pending employees ──
app.get('/api/admin/pending-employees', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = await getSession(token);
        if (!session?.employees?.role || session.employees.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { data, error } = await vertexDb.from('employees')
            .select('*')
            .in('onboarding_status', ['pending', 'contract_signed', 'id_uploaded', 'selfie_done', 'ai_verified'])
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ employees: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Approve employee
app.post('/api/admin/approve-employee', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = await getSession(token);
        if (!session?.employees?.role || session.employees.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { employee_id } = req.body;
        const { error } = await vertexDb.from('employees')
            .update({ 
                onboarding_status: 'admin_approved',
                approved_by: session.google_email,
                approved_at: new Date().toISOString()
            })
            .eq('id', employee_id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Reject employee
app.post('/api/admin/reject-employee', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = await getSession(token);
        if (!session?.employees?.role || session.employees.role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { employee_id, reason } = req.body;
        const { error } = await vertexDb.from('employees')
            .update({ 
                onboarding_status: 'rejected',
                notes: reason || 'Respins de admin'
            })
            .eq('id', employee_id);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════
// ADMIN & OPERATOR ROUTES (Restored)
// ═══════════════════════════════════════════════════

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });
        
        // Fallback 1: Accept ADMIN_API_TOKEN for backward compatibility
        if (token === process.env.ADMIN_API_TOKEN) {
            req.user = { id: 'admin', email: 'admin@superparty.ro', role: 'admin', name: 'Admin' };
            return next();
        }
        
        // Fallback 2: Session-based auth (Google OAuth)
        const session = await getSession(token);
        if (!session) return res.status(401).json({ error: 'Invalid session' });
        
        req.user = {
            id: session.google_id || session.auth_user_id,
            email: session.google_email,
            role: session.employees?.role || 'user',
            employee_id: session.employee_id,
            name: session.google_name
        };
        
        next();
    } catch (e) {
        res.status(500).json({ error: 'Auth middleware error' });
    }
};

import brainConsoleRoutes from './src/api/brainConsoleRoutes.mjs';
app.use('/api/ai/brain', authMiddleware, brainConsoleRoutes);
app.use('/brain', express.static(path.join(__dirname, 'public')));

import adminSuiteRoutes from './src/api/adminSuiteRoutes.mjs';
import adminDebugRoutes from './src/api/adminDebugRoutes.mjs';
app.use('/api/admin', authMiddleware, adminSuiteRoutes);
app.use('/api/v1/admin', authMiddleware, adminDebugRoutes);
app.use('/admin', express.static(path.join(__dirname, 'public')));

import operatorDeskRoutes from './src/api/operatorDeskRoutes.mjs';
app.use('/api/operator', authMiddleware, operatorDeskRoutes);
app.get('/operator', (req, res) => res.redirect('/admin/operator-desk.html'));

import correctionsRoutes from './src/api/correctionsRoutes.mjs';
app.use('/api/admin/corrections', authMiddleware, correctionsRoutes);

import { startAutoReload, getCurrentPolicy } from './src/lib/ruleLoader.mjs';
startAutoReload(60000);

// ═══════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════
const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, '0.0.0.0', async () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║   🤖 Manager AI — Vertex AI Edition     ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log(`  🌐 Server:      http://localhost:${PORT}`);
    console.log(`  🔑 Vertex AI:   ${process.env.VERTEX_AI_API_KEY ? '✅ Configurat' : '❌ Lipsă cheie'}`);
    console.log(`  🗄️  Vertex DB:   ${process.env.VERTEX_SUPABASE_URL ? '✅ Configurat' : '❌ Lipsă'}`);
    console.log(`  📱 WhatsApp:    ${WHTSUP_API_URL}`);
    
    // Preîncarcă prompt-ul
    const prompt = await loadSystemPrompt();
    console.log(`  📝 Prompt:      ${prompt.substring(0, 60)}...`);
    console.log('');
    console.log('  Gata de lucru! Așteptăm mesaje pe /webhook/whts-up');
    console.log('');
});
