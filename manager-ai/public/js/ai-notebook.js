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
        const res = await fetch('/api/admin/notebook-templates');
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
        const res = await fetch('/api/admin/client-notebooks');
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
            const filledData = n.extracted_data || {};
            
            let slotsHtml = '';
            tplProps.forEach(p => {
                const isFilled = filledData.hasOwnProperty(p.nume) && filledData[p.nume] !== null;
                const val = isFilled ? filledData[p.nume] : 'Lipstă din discuție...';
                const classBadge = isFilled ? 'slot-filled' : 'slot-empty';
                const icon = isFilled ? 'fa-check-circle' : 'fa-circle-xmark';
                
                slotsHtml += `
                    <div class="mb-2">
                        <span class="slot-badge ${classBadge}"><i class="fa-solid ${icon} me-1"></i>${p.nume}</span>
                        <div class="ms-3 small fw-semibold">${val}</div>
                    </div>
                `;
            });

            const card = document.createElement('div');
            card.className = 'col-md-4 mb-4';
            card.innerHTML = `
                <div class="card h-100 border">
                    <div class="card-header bg-white d-flex justify-content-between align-items-center">
                        <h6 class="mb-0 fw-bold text-success"><i class="fa-brands fa-whatsapp me-2"></i> ${n.phone_number}</h6>
                        <span class="badge bg-primary">${n.template_key}</span>
                    </div>
                    <div class="card-body">
                        ${slotsHtml}
                    </div>
                    <div class="card-footer bg-white text-muted small text-end border-top-0">
                        Ultima bifare: ${new Date(n.updated_at).toLocaleString()}
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } catch(e) {
        container.innerHTML = `<div class="col-12 text-danger">Error fetching WhatsApp data: ${e.message}</div>`;
    }
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
        const res = await fetch('/api/admin/notebook-templates', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
