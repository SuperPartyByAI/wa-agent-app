// ai-copilot.js

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3001/api/admin' : '/api/admin';
let currentPhone = null;
let currentClientId = null;
let pollTimeout = null;

// DOM Elements
const selectSession = document.getElementById('activeSessionSelect');
const chatMessages = document.getElementById('chatMessages');
const nbDate = document.querySelector('#nb-date .data-val');
const nbLocation = document.querySelector('#nb-location .data-val');
const nbOccasion = document.querySelector('#nb-occasion .data-val');
const nbKids = document.querySelector('#nb-kids .data-val');
const rolesList = document.getElementById('rolesList');
const rolesCount = document.getElementById('rolesCount');
const extractionStatus = document.getElementById('extractionStatus');

// Visual Board Elements
const vbSummary = document.getElementById('vb-summary');
const vbTitle = document.getElementById('vb-title');
const vbSubtitle = document.getElementById('vb-subtitle');
const vbColorsSection = document.getElementById('vb-colors-section');
const vbColorsContainer = document.getElementById('vb-colors-container');
const vbComponents = document.getElementById('vb-components');
const vbEmpty = document.getElementById('vb-empty');
const vbTotalEstimate = document.getElementById('vb-total-estimate');
const boardAmbientGlow = document.getElementById('boardAmbientGlow');

// Fetch utility (reusing token pattern from admin-suite if available)
async function api(path, opts = {}) {
    const token = new URLSearchParams(window.location.search).get('token') || localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(path, { headers, ...opts });
    if (!r.ok) throw new Error(`API Error: ${r.status}`);
    return await r.json();
}

// 1. Initialize & Fetch Sessions
async function init() {
    await fetchActiveSessions();
    setInterval(fetchActiveSessions, 10000); // refresh list every 10s

    selectSession.addEventListener('change', async (e) => {
        currentPhone = e.target.value;
        currentClientId = null;
        chatMessages.innerHTML = '<div class="text-center p-4 text-gray-500">Se încarcă chat-ul...</div>';
        clearTimeout(pollTimeout);
        
        if (currentPhone) {
            // Find client ID for this phone
            try {
                const res = await api(`${API_BASE}/crm/clients?search=${encodeURIComponent(currentPhone)}`);
                if (res.clients && res.clients.length > 0) {
                    currentClientId = res.clients[0].id;
                }
            } catch (err) {
                console.error('Eroare gasire client UUID:', err);
            }
            pollSessionData();
        } else {
            resetUI();
        }
    });
}

// 2. Fetch Active Sessions for Dropdown
async function fetchActiveSessions() {
    try {
        const data = await api(`${API_BASE}/client-notebooks`);
        const notebooks = data.notebooks || [];
        
        // Preserve selection
        const selected = selectSession.value;
        
        let html = '<option value="">Alege o sesiune activă...</option>';
        notebooks.forEach(n => {
            const label = `${n.phone_number} (${n.template_key})`;
            const isSelected = selected === n.phone_number ? 'selected' : '';
            html += `<option value="${n.phone_number}" ${isSelected}>${label}</option>`;
        });
        
        selectSession.innerHTML = html;
        
        // Auto-select first if none selected
        if (!selected && notebooks.length > 0 && window.location.hash === '#auto') {
            selectSession.value = notebooks[0].phone_number;
            selectSession.dispatchEvent(new Event('change'));
        }
    } catch (err) {
        console.error('Failed to fetch sessions:', err);
    }
}

// 3. Poll Data for the Active Session
async function pollSessionData() {
    if (!currentPhone) return;
    
    extractionStatus.classList.remove('hidden');
    
    try {
        // Fetch AI Notebook (for Middle & Right columns)
        const nbData = await api(`${API_BASE}/client-notebooks`);
        const notebook = (nbData.notebooks || []).find(n => n.phone_number === currentPhone);
        
        if (notebook) updateNotebookUI(notebook);

        // Fetch Messages (for Left Column) if we have the client ID
        if (currentClientId) {
            const clientData = await api(`${API_BASE}/crm/clients/${currentClientId}`);
            updateChatUI(clientData.latest_messages || []);
        }

    } catch (err) {
        console.error('Polling error:', err);
    } finally {
        setTimeout(() => extractionStatus.classList.add('hidden'), 500);
        pollTimeout = setTimeout(pollSessionData, 3000); // Very fast 3s polling for "Realtime" feel
    }
}

// 4. Update Chat Column
let lastMessageCount = 0;
function updateChatUI(messages) {
    if (messages.length === 0) {
        chatMessages.innerHTML = '<div class="text-center p-4 text-gray-500">Niciun mesaj găsit in istoricul recent.</div>';
        return;
    }

    // Messages sorted ascending (oldest first) - API returns chronological order
    const sorted = [...messages];

    if (sorted.length !== lastMessageCount) {
        chatMessages.innerHTML = '';
        sorted.forEach(m => {
            const isClient = m.sender_type === 'client';
            const time = new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const div = document.createElement('div');
            div.className = `msg-bubble ${isClient ? 'msg-client' : 'msg-ai'} fade-in`;
            div.innerHTML = `
                <div class="${isClient ? 'text-[10px] text-gray-400 mb-1' : 'text-[10px] text-purple-400 mb-1 font-bold'}">
                    ${isClient ? 'Client' : 'AI Copilot'} <span class="float-right ml-3 font-normal opacity-50">${time}</span>
                </div>
                <div>${escapeHTML(m.content)}</div>
            `;
            chatMessages.appendChild(div);
        });
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
        lastMessageCount = sorted.length;
    }
}

// Cache object to track changes and animate
let lastExtractedText = {};

// 5. Update Notebook Column
function updateNotebookUI(notebook) {
    const ext = notebook.extracted_data || {};
    
    // Quick UI updater with highlight effect
    const updateField = (el, key, fallbacks) => {
        const val = ext[key] || getFallback(ext, fallbacks) || '—';
        if (el.innerText !== val && val !== '—') {
            el.innerText = val;
            el.parentElement.classList.add('updated');
            setTimeout(() => el.parentElement.classList.remove('updated'), 2000);
        } else if (val === '—') {
            el.innerText = val;
        }
    };

    updateField(nbDate, 'data_evenimentului', ['data', 'data_eveniment']);
    updateField(nbLocation, 'locatia', ['localitatea', 'judetul', 'locatie']);
    updateField(nbOccasion, 'ocazia', ['tipul_petrecerii']);
    
    // Combine kids info
    const numKids = ext['numar_copii'] || ext['numarul_de_copii'] || '?';
    const ageKids = ext['varsta_copiilor'] || '?';
    const kidsStr = (numKids !== '?' || ageKids !== '?') ? `${numKids} copii (~${ageKids} ani)` : '—';
    if (nbKids.innerText !== kidsStr && kidsStr !== '—') {
        nbKids.innerText = kidsStr;
        nbKids.parentElement.classList.add('updated');
        setTimeout(() => nbKids.parentElement.classList.remove('updated'), 2000);
    }

    // Dynamic Services / Roles
    let servicesFound = 0;
    let rolesHtml = '';
    const ignoreKeys = ['data_evenimentului', 'data', 'locatia', 'localitatea', 'judetul', 'ocazia', 'tipul_petrecerii', 'numar_copii', 'varsta_copiilor'];
    
    for (const [key, value] of Object.entries(ext)) {
        if (!ignoreKeys.includes(key) && value && value.toString().trim() !== '' && value.toString().toLowerCase() !== 'null') {
            servicesFound++;
            rolesHtml += `
                <div class="nb-field fade-in p-2">
                    <div class="text-[10px] uppercase opacity-70 mb-1 text-purple-400 font-bold">${formatKeyTitle(key)}</div>
                    <div class="text-sm font-medium">${value}</div>
                </div>
            `;
        }
    }

    if (servicesFound > 0) {
        rolesList.innerHTML = rolesHtml;
        rolesCount.innerText = servicesFound;
    } else {
        rolesList.innerHTML = `<div class="text-center py-6 text-xs text-gray-500 italic border border-dashed border-gray-700 rounded-lg">Fără servicii detectate încă.</div>`;
        rolesCount.innerText = '0';
    }

    // Build Visual Board based on these findings
    updateVisualBoard(ext, servicesFound);
}

// 6. Visual Board Engine
function updateVisualBoard(ext, servicesFound) {
    if (Object.keys(ext).length === 0) {
        vbEmpty.classList.remove('hidden');
        vbSummary.classList.add('hidden');
        vbComponents.innerHTML = '';
        vbColorsSection.classList.add('hidden');
        return;
    }

    vbEmpty.classList.add('hidden');
    vbSummary.classList.remove('hidden');
    
    // Title
    const occ = (ext['ocazia'] || ext['tipul_petrecerii'] || 'Eveniment').toUpperCase();
    vbTitle.innerText = occ;
    vbSubtitle.innerText = (ext['data_evenimentului'] || 'Data necunoscută') + ' • ' + (ext['locatia'] || ext['localitatea'] || 'Locație neclară');

    // Determine colors
    const foundColors = extractColorsFromStrings(Object.values(ext).join(' '));
    if (foundColors.length > 0) {
        vbColorsSection.classList.remove('hidden');
        vbColorsContainer.innerHTML = foundColors.map(c => `
            <div class="w-8 h-8 rounded-full border border-gray-600 shadow-lg" style="background-color: ${c.hex};" title="${c.name}"></div>
        `).join('');
        
        // Change ambient glow
        boardAmbientGlow.style.background = `radial-gradient(circle at center, ${foundColors[0].hex}40 0%, transparent 70%)`;
    }

    // Determine visual cards
    let cardsHtml = '';
    let totalEst = 0;

    // Logic 1: Animatori
    if (Object.keys(ext).some(k => k.includes('animator') || k.includes('personaje'))) {
        cardsHtml += `
            <div class="visual-card fade-in">
                <div class="visual-icon">🦸‍♂️</div>
                <h4 class="font-bold text-sm mb-1">Animatori</h4>
                <div class="text-[10px] text-gray-400">Activ și Energie</div>
            </div>`;
        totalEst += 350;
    }

    // Logic 2: Baloane / Arcada
    if (Object.keys(ext).some(k => k.includes('baloa') || k.includes('arcada'))) {
        cardsHtml += `
             <div class="visual-card fade-in">
                <div class="visual-icon">🎈</div>
                <h4 class="font-bold text-sm mb-1">Decor Baloane</h4>
                <div class="text-[10px] text-gray-400">Atmosferă Magică</div>
            </div>`;
        totalEst += 450;
    }
    
    // Logic 3: Ursitoare
    if (Object.keys(ext).some(k => k.includes('ursitoare'))) {
        cardsHtml += `
             <div class="visual-card fade-in">
                <div class="visual-icon">🧚‍♀️</div>
                <h4 class="font-bold text-sm mb-1">Ursitoare</h4>
                <div class="text-[10px] text-gray-400">Tradiție și Emoție</div>
            </div>`;
        totalEst += 400;
    }

     // Logic 4: Vata/Popcorn
     if (Object.keys(ext).some(k => k.includes('vata') || k.includes('popcorn') || k.includes('dulce'))) {
        cardsHtml += `
             <div class="visual-card fade-in">
                <div class="visual-icon">🍭</div>
                <h4 class="font-bold text-sm mb-1">Fun Food</h4>
                <div class="text-[10px] text-gray-400">Vată de Zahăr & Popcorn</div>
            </div>`;
        totalEst += 300;
    }

    // Default card if services found but not matched to icons
    if (cardsHtml === '' && servicesFound > 0) {
        cardsHtml = `
            <div class="visual-card fade-in col-span-2">
                <div class="visual-icon">✨</div>
                <h4 class="font-bold text-sm mb-1">Servicii Personalizate</h4>
                <div class="text-[10px] text-gray-400">Detectate în discuție</div>
            </div>`;
    }

    vbComponents.innerHTML = cardsHtml;
    
    // Estimate
    if (totalEst > 0) {
        vbTotalEstimate.innerText = `~${totalEst} RON`;
    } else {
        vbTotalEstimate.innerText = `Se calculează...`;
    }
}

// Reset UI when no session
function resetUI() {
    chatMessages.innerHTML = '';
    
    // reset notebook
    document.querySelectorAll('.data-val').forEach(el => el.innerText = '—');
    rolesList.innerHTML = `<div class="text-center py-6 text-xs text-gray-500 italic border border-dashed border-gray-700 rounded-lg">Alege o sesiune...</div>`;
    rolesCount.innerText = '0';
    
    // reset visual
    vbEmpty.classList.remove('hidden');
    vbSummary.classList.add('hidden');
    vbColorsSection.classList.add('hidden');
    vbComponents.innerHTML = '';
    vbTotalEstimate.innerText = '--- RON';
    boardAmbientGlow.style.background = '';
}

// Helpers
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

function getFallback(obj, keys) {
    for (let k of keys) {
        if (obj[k]) return obj[k];
    }
    return null;
}

function formatKeyTitle(key) {
    return key.replace(/_/g, ' ');
}

// Mini Color Extractor based on Romanian keywords
function extractColorsFromStrings(text) {
    text = text.toLowerCase();
    const map = [
        {name: 'Roz', kw: ['roz', 'pink'], hex: '#ec4899'},
        {name: 'Albastru', kw: ['albastru', 'albastra', 'bleu', 'blue'], hex: '#3b82f6'},
        {name: 'Auriu', kw: ['auriu', 'gold', 'aurie'], hex: '#fbbf24'},
        {name: 'Argintiu', kw: ['argintiu', 'silver', 'argintie'], hex: '#d1d5db'},
        {name: 'Verde', kw: ['verde', 'green'], hex: '#10b981'},
        {name: 'Roșu', kw: ['rosu', 'red', 'rosie'], hex: '#ef4444'},
        {name: 'Mov', kw: ['mov', 'violet', 'purple'], hex: '#8b5cf6'}
    ];
    let found = [];
    map.forEach(c => {
        if (c.kw.some(k => text.includes(k))) found.push(c);
    });
    return found;
}

// Boot
init();
