import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <title>Superparty AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #0b141a; color: #e9edef; height: 100vh; display: flex; flex-direction: column; }
    .header { padding: 10px 16px; background: #1f2c34; display: flex; align-items: center; gap: 10px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #ec4899); display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .header-info h2 { font-size: 16px; font-weight: 500; }
    .header-info p { font-size: 12px; color: #8696a0; }
    .chat { flex: 1; overflow-y: auto; padding: 12px 60px; background: #0b141a url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 5 L35 15 L30 12 L25 15Z' fill='%23ffffff' opacity='0.02'/%3E%3C/svg%3E") repeat; display: flex; flex-direction: column; gap: 4px; }
    .msg { max-width: 65%; padding: 6px 8px 6px 9px; border-radius: 8px; font-size: 14.2px; line-height: 19px; position: relative; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); }
    .msg .time { font-size: 11px; color: rgba(255,255,255,0.45); float: right; margin: 4px 0 -4px 8px; }
    .msg.user { background: #005c4b; align-self: flex-end; border-top-right-radius: 0; }
    .msg.ai { background: #1f2c34; align-self: flex-start; border-top-left-radius: 0; }
    .msg.system { background: rgba(139,92,246,0.12); align-self: center; font-size: 12px; color: #8696a0; border-radius: 8px; max-width: 80%; text-align: center; padding: 5px 12px; }
    .input-bar { padding: 8px 10px; background: #1f2c34; display: flex; gap: 8px; align-items: center; }
    .input-bar input { flex: 1; background: #2a3942; border: none; color: #d1d7db; padding: 9px 12px; border-radius: 8px; font-size: 15px; outline: none; }
    .input-bar button { background: #00a884; color: white; border: none; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .input-bar button:disabled { opacity: 0.5; }
    .typing { align-self: flex-start; background: #1f2c34; border-radius: 8px; padding: 8px 14px; font-size: 13px; color: #8696a0; }
    .dots span { animation: blink 1.4s infinite; }
    .dots span:nth-child(2) { animation-delay: .2s; }
    .dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%,100% { opacity:.2; } 50% { opacity:1; } }
    @keyframes slideIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
    .msg { animation: slideIn .2s ease-out; }
    .check { color: #53bdeb; font-size: 12px; margin-left: 2px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="avatar">🤖</div>
    <div class="header-info">
      <h2>Superparty AI Agent</h2>
      <p id="status">online</p>
    </div>
  </div>
  <div class="chat" id="chat"></div>
  <div class="input-bar">
    <input id="input" placeholder="Scrie un mesaj..." autofocus />
    <button id="btn" onclick="sendMsg()">➤</button>
  </div>
  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const btn = document.getElementById('btn');
    const statusEl = document.getElementById('status');
    
    function now() {
      return new Date().toLocaleTimeString('ro-RO', {hour:'2-digit', minute:'2-digit'});
    }
    
    function addMsg(type, text) {
      const div = document.createElement('div');
      div.className = 'msg ' + type;
      if (type === 'system') {
        div.textContent = text;
      } else {
        div.innerHTML = text + '<span class="time">' + now() + (type==='user'?' <span class="check">✓✓</span>':'') + '</span>';
      }
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }
    
    input.addEventListener('keydown', e => { if(e.key==='Enter' && !btn.disabled) sendMsg(); });

    async function sendMsg() {
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      btn.disabled = true;
      
      addMsg('user', msg);
      
      statusEl.textContent = 'se gândește...';
      statusEl.style.color = '#00a884';

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();

        if (data.functionCalls && data.functionCalls.length > 0) {
          data.functionCalls.forEach(fc => {
            let label = '';
            if (fc.name === 'noteaza_petrecere') label = '📋 Petrecere notată în sistem';
            else if (fc.name === 'cauta_petreceri') label = '🔍 Am căutat în sistem';
            else if (fc.name === 'actualizeaza_petrecere') label = '✏️ Detalii actualizate';
            else if (fc.name === 'anuleaza_petrecere') label = '❌ Eveniment anulat';
            else if (fc.name === 'restaureaza_petrecere') label = '♻️ Eveniment restaurat';
            else label = '🔧 ' + fc.name;
            addMsg('system', label + (fc.result?.success ? ' ✅' : ''));
          });
        }

        addMsg('ai', data.reply || 'Eroare');
      } catch(e) {
        addMsg('ai', '❌ ' + e.message);
      }
      statusEl.textContent = 'online';
      statusEl.style.color = '#8696a0';
      btn.disabled = false;
      input.focus();
    }
  </script>
</body>
</html>`);
});

app.post('/chat', async (req, res) => {
  try {
    const result = await processWithVertexAI('+40700FIX02', req.body.message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3333, () => console.log('🧪 AI Chat running on http://localhost:3333'));
