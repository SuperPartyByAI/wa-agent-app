// ai-notebook.js

document.addEventListener('DOMContentLoaded', () => {
    // Navigation Simple Router
    const navTpl = document.getElementById('nav-templates');
    const navNb = document.getElementById('nav-notebooks');
    const secTpl = document.getElementById('section-templates');
    const secNb = document.getElementById('section-notebooks');

    navTpl.addEventListener('click', (e) => {
        e.preventDefault();
        navTpl.classList.add('active'); navNb.classList.remove('active');
        secTpl.classList.remove('d-none'); secNb.classList.add('d-none');
        loadTemplates();
    });

    navNb.addEventListener('click', (e) => {
        e.preventDefault();
        navNb.classList.add('active'); navTpl.classList.remove('active');
        secNb.classList.remove('d-none'); secTpl.classList.add('d-none');
        loadNotebooks();
    });

    // Initial Load
    loadTemplates();

    document.getElementById('btn-save-template').addEventListener('click', saveTemplate);
});

// Dynamic Field Builder
function addFieldRow() {
    const list = document.getElementById('fields-list');
    const tmpl = document.getElementById('field-row-template').content.cloneNode(true);
    const row = tmpl.querySelector('.field-row');
    
    row.querySelector('.delete-field').addEventListener('click', () => {
        row.remove();
    });
    
    list.appendChild(row);
}

// Ensure at least one empty row on load
addFieldRow();

async function loadTemplates() {
    const container = document.getElementById('templates-container');
    container.innerHTML = '<div class="col-12 text-center text-muted"><div class="spinner-border spinner-border-sm me-2"></div> Încărcare...</div>';
    
    try {
        const token = localStorage.getItem('sp_session_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/admin/notebook-templates', { headers });
        if (!res.ok) throw new Error('Failed to load templates');
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.templates.length === 0) {
            container.innerHTML = '<div class="col-12"><div class="alert alert-light">Niciun șablon definit încă.</div></div>';
            return;
        }

        data.templates.forEach(t => {
            const props = t.json_schema?.proprietati_cerute || [];
            let fieldsHtml = props.map(p => `<span class="slot-badge border"><i class="fa-regular fa-square me-1"></i>${p.nume}</span> `).join('');
            
            const card = document.createElement('div');
            card.className = 'col-md-6 mb-3';
            card.innerHTML = `
                <div class="card h-100 border-start border-primary border-4 p-3">
                    <h5 class="fw-bold mb-1">${t.name} <span class="badge bg-secondary ms-2">${t.key}</span></h5>
                    <p class="text-muted small mb-3">${t.system_prompt_instruction || 'Fără instrucțiuni avansate'}</p>
                    <div class="mb-2"><strong>Căsuțe / Câmpuri de extras:</strong></div>
                    <div>${fieldsHtml}</div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch(e) {
        container.innerHTML = `<div class="col-12 text-danger">Error: ${e.message}</div>`;
    }
}

async function loadNotebooks() {
    const container = document.getElementById('notebooks-container');
    container.innerHTML = '<div class="col-12 text-center text-muted"><div class="spinner-border spinner-border-sm me-2"></div> Se aduc datele de pe WhatsApp...</div>';
    
    try {
        const token = localStorage.getItem('sp_session_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/admin/client-notebooks', { headers });
        if (!res.ok) throw new Error('Failed to load notebooks');
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.notebooks.length === 0) {
            container.innerHTML = '<div class="col-12"><div class="alert alert-light border">Niciun caiet de client activ. Când un client scrie referitor la un Șablon, va apărea aici.</div></div>';
            return;
        }

        data.notebooks.forEach(n => {
            // Merge template schema with filled data to show checkmarks
            const tplProps = n.template?.json_schema?.proprietati_cerute || [];
            
            // Handle array or object from Gemini
            let filledData = n.extracted_data || {};
            if (Array.isArray(filledData) && filledData.length > 0) {
                filledData = filledData[0];
            } else if (Array.isArray(filledData)) {
                filledData = {};
            }
            
            let slotsHtml = '';
            tplProps.forEach(p => {
                const isFilled = filledData.hasOwnProperty(p.nume) && filledData[p.nume] !== null && filledData[p.nume] !== '';
                let val = isFilled ? filledData[p.nume] : '<span class="text-muted italic">Lipsă...</span>';
                
                // If value is somehow an object (e.g. nested budget), stringify it
                if (typeof val === 'object' && val !== null && !val._is_html) {
                    val = JSON.stringify(val);
                }

                const classBadge = isFilled ? 'slot-filled' : 'slot-empty';
                const icon = isFilled ? 'fa-check-circle' : 'fa-circle-question';
                
                slotsHtml += `
                    <div class="mb-2">
                        <span class="slot-badge ${classBadge}"><i class="fa-solid ${icon} me-1"></i>${p.nume}</span>
                        <div class="ms-3 small fw-semibold text-wrap">${val}</div>
                    </div>
                `;
            });

            // If no slots filled but we have transcript, show a note
            if (slotsHtml === '' && n.last_transcript) {
                slotsHtml = '<div class="alert alert-info py-1 small">Conversație activă (fără date extrase încă)</div>';
            }

            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4 mb-4';
            card.innerHTML = `
                <div class="card h-100 border shadow-sm client-card">
                    <div class="card-header bg-white d-flex justify-content-between align-items-center py-2">
                        <h6 class="mb-0 fw-bold text-primary"><i class="fa-solid fa-user-circle me-2"></i> ${n.phone_number}</h6>
                        <span class="badge bg-light text-dark border">${n.brand_key || 'Global'}</span>
                    </div>
                    <div class="card-body p-3">
                        <div class="mb-3">${slotsHtml}</div>
                        
                        ${n.last_transcript ? `
                            <button class="btn btn-outline-secondary btn-sm w-100 mt-2 btn-transcript" data-transcript="${encodeURIComponent(n.last_transcript)}">
                                <i class="fa-solid fa-comments me-1"></i> Vezi Conversația Full
                            </button>
                        ` : ''}
                    </div>
                    <div class="card-footer bg-light text-muted x-small text-end border-top-0 py-1">
                        Sincronizat: ${new Date(n.updated_at).toLocaleString('ro-RO')}
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        // Add event listeners for transcript buttons
        document.querySelectorAll('.btn-transcript').forEach(btn => {
            btn.addEventListener('click', () => {
                const transcript = decodeURIComponent(btn.getAttribute('data-transcript'));
                showTranscriptModal(transcript);
            });
        });

    } catch(e) {
        container.innerHTML = `<div class="col-12 text-center py-5"><div class="alert alert-danger d-inline-block">Eroare la încărcarea datele: ${e.message}</div></div>`;
    }
}

function showTranscriptModal(text) {
    // Create or find modal
    let modalEl = document.getElementById('transcriptModal');
    if (!modalEl) {
        const div = document.createElement('div');
        div.id = 'transcriptModal';
        div.className = 'modal fade';
        div.innerHTML = `
            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title fw-bold">Istoric Conversație</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body bg-light">
                        <pre id="transcript-content" class="p-3 text-wrap" style="font-family: inherit; font-size: 0.9rem; white-space: pre-wrap; line-height: 1.5;"></pre>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(div);
        modalEl = div;
    }
    
    document.getElementById('transcript-content').innerText = text;
    new bootstrap.Modal(modalEl).show();
}

async function saveTemplate() {
    const key = document.getElementById('tpl-key').value.trim();
    const name = document.getElementById('tpl-name').value.trim();
    const instr = document.getElementById('tpl-instruction').value.trim();
    
    if(!key || !name) return alert('Key și Name obligatorii');

    const fields = [];
    document.querySelectorAll('.field-row').forEach(row => {
        const fn = row.querySelector('.field-name').value.trim();
        const fd = row.querySelector('.field-desc').value.trim();
        if(fn) {
            fields.push({ nume: fn, descriere: fd });
        }
    });

    const payload = {
        key, name, 
        system_prompt_instruction: instr,
        json_schema: { tip: "object", proprietati_cerute: fields }
    };

    const btn = document.getElementById('btn-save-template');
    btn.disabled = true;
    btn.innerHTML = 'Se salvează...';

    try {
        const token = localStorage.getItem('sp_session_token');
        const res = await fetch('/api/admin/notebook-templates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify(payload)
        });
        
        if(!res.ok) throw new Error(await res.text());
        
        bootstrap.Modal.getInstance(document.getElementById('newTemplateModal')).hide();
        loadTemplates(); // refresh
    } catch(e) {
        alert("Eroare: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Salvează Șablon';
    }
}
