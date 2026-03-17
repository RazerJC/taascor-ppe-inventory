/* ============================================================
   TAASCOR PPE Inventory Management System - Frontend Logic
   ============================================================ */

// ============ PIN LOCK ============
let currentPin = '';
const PIN_LENGTH = 6;

function pinInput(digit) {
    if (currentPin.length >= PIN_LENGTH) return;
    currentPin += digit;
    updatePinDots();
    if (currentPin.length === PIN_LENGTH) {
        verifyPin();
    }
}

function pinDelete() {
    currentPin = currentPin.slice(0, -1);
    updatePinDots();
    document.getElementById('pinError').textContent = '';
}

function pinClear() {
    currentPin = '';
    updatePinDots();
    document.getElementById('pinError').textContent = '';
}

function updatePinDots() {
    const dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < currentPin.length);
    });
}

async function verifyPin() {
    try {
        const res = await fetch('/api/pin/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: currentPin })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('pinLock').style.display = 'none';
            document.getElementById('mainApp').style.display = 'flex';
            loadDashboard();
        } else {
            document.getElementById('pinError').textContent = 'Invalid PIN. Try again.';
            currentPin = '';
            updatePinDots();
            document.querySelector('.pin-container').style.animation = 'shake 0.4s ease';
            setTimeout(() => document.querySelector('.pin-container').style.animation = '', 400);
        }
    } catch (e) {
        document.getElementById('pinError').textContent = 'Connection error';
        currentPin = '';
        updatePinDots();
    }
}

// Keyboard input for PIN
document.addEventListener('keydown', (e) => {
    if (document.getElementById('pinLock').style.display !== 'none') {
        if (/^\d$/.test(e.key)) pinInput(e.key);
        else if (e.key === 'Backspace') pinDelete();
        else if (e.key === 'Escape') pinClear();
    }
});

function lockApp() {
    currentPin = '';
    updatePinDots();
    document.getElementById('pinError').textContent = '';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('pinLock').style.display = 'flex';
}

// ============ NAVIGATION ============
function navigate(page, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay').classList.remove('show');

    // Load data for the page
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'inventory': loadPPE(); break;
        case 'incoming': loadIncoming(); break;
        case 'distribution': loadDistribution(); break;
        case 'clients': loadClients(); break;
        case 'transactions': loadTransactions(); break;
        case 'reports': break;
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.querySelector('.sidebar-overlay').classList.toggle('show');
}

// ============ TOAST NOTIFICATIONS ============
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ============ MODAL ============
function openModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modal').classList.add('show');
}

function closeModal() {
    document.getElementById('modal').classList.remove('show');
}

// ============ API HELPER ============
async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        return await res.json();
    } catch (e) {
        showToast('Connection error: ' + e.message, 'error');
        return null;
    }
}

// ============ DASHBOARD ============
let stockChart = null;
let activityChart = null;

async function loadDashboard() {
    const data = await api('/api/dashboard');
    if (!data) return;

    document.getElementById('statTotalItems').textContent = data.totalItems;
    document.getElementById('statTotalStock').textContent = data.totalStock.toLocaleString();
    document.getElementById('statLowStock').textContent = data.lowStockItems;
    document.getElementById('statTotalClients').textContent = data.totalClients;

    // Set current date
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Recent transactions table
    const tbody = document.getElementById('dashRecentTable');
    if (data.recentTransactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-inbox"></i><p>No transactions yet</p></td></tr>';
    } else {
        tbody.innerHTML = data.recentTransactions.map(t => `
      <tr>
        <td>${t.date}</td>
        <td>${t.ppe_name || '-'}</td>
        <td><span class="badge badge-${t.transaction_type === 'IN' ? 'in' : 'out'}">${t.transaction_type === 'IN' ? '↓ IN' : '↑ OUT'}</span></td>
        <td>${t.quantity}</td>
        <td>${t.company_name || '-'}</td>
        <td>${t.responsible_person || '-'}</td>
      </tr>
    `).join('');
    }

    // Stock chart
    if (stockChart) stockChart.destroy();
    const stockCtx = document.getElementById('stockChart').getContext('2d');
    stockChart = new Chart(stockCtx, {
        type: 'bar',
        data: {
            labels: data.stockChart.map(i => i.ppe_name.length > 15 ? i.ppe_name.slice(0, 15) + '...' : i.ppe_name),
            datasets: [
                { label: 'Current Stock', data: data.stockChart.map(i => i.current_stock), backgroundColor: 'rgba(59, 130, 246, 0.7)', borderRadius: 6 },
                { label: 'Minimum Stock', data: data.stockChart.map(i => i.minimum_stock), backgroundColor: 'rgba(239, 68, 68, 0.4)', borderRadius: 6 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8' } } },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(45,58,77,0.5)' } },
                y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(45,58,77,0.5)' } }
            }
        }
    });

    // Activity chart
    if (activityChart) activityChart.destroy();
    const months = [...new Set([...data.monthlyIn.map(m => m.month), ...data.monthlyOut.map(m => m.month)])].sort();
    const actCtx = document.getElementById('activityChart').getContext('2d');
    activityChart = new Chart(actCtx, {
        type: 'line',
        data: {
            labels: months.length ? months : ['No Data'],
            datasets: [
                {
                    label: 'Received (IN)', data: months.map(m => { const f = data.monthlyIn.find(x => x.month === m); return f ? f.total : 0; }),
                    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4, fill: true
                },
                {
                    label: 'Issued (OUT)', data: months.map(m => { const f = data.monthlyOut.find(x => x.month === m); return f ? f.total : 0; }),
                    borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.4, fill: true
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8' } } },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(45,58,77,0.5)' } },
                y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(45,58,77,0.5)' } }
            }
        }
    });
}

// ============ PPE INVENTORY ============
async function loadPPE() {
    const search = document.getElementById('ppeSearch')?.value || '';
    const items = await api(`/api/ppe?search=${encodeURIComponent(search)}`);
    if (!items) return;
    const tbody = document.getElementById('ppeTable');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-hard-hat"></i><p>No PPE items found. Click "Add PPE Item" to get started.</p></td></tr>';
    } else {
        tbody.innerHTML = items.map(i => `
      <tr>
        <td><strong>#${i.id}</strong></td>
        <td>${i.ppe_name}</td>
        <td>${i.category}</td>
        <td>${i.size || '-'}</td>
        <td>${i.unit}</td>
        <td><strong>${i.current_stock}</strong></td>
        <td>${i.minimum_stock}</td>
        <td>${i.current_stock <= i.minimum_stock ? '<span class="badge badge-low"><i class="fas fa-exclamation-triangle"></i> Low Stock</span>' : '<span class="badge badge-ok">✓ OK</span>'}</td>
        <td>
          <button class="btn-icon" onclick="editPPE(${i.id})" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="btn-icon danger" onclick="deletePPE(${i.id}, '${i.ppe_name.replace(/'/g, "\\'")}')" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
    }
}

const SIZE_CATEGORIES = ['Uniform', 'Body Protection', 'Foot Protection', 'Hand Protection', 'High Visibility'];
const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const SHOE_SIZES = ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14'];
const GLOVE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function getSizesForCategory(cat) {
    if (cat === 'Foot Protection') return SHOE_SIZES;
    if (cat === 'Hand Protection') return GLOVE_SIZES;
    return APPAREL_SIZES;
}

function showPPEForm(item = null) {
    const isEdit = item !== null;
    const showSize = isEdit && item.category && SIZE_CATEGORIES.includes(item.category);
    const currentSizes = showSize ? getSizesForCategory(item.category) : APPAREL_SIZES;
    openModal(isEdit ? 'Edit PPE Item' : 'Add New PPE Item', `
    <form onsubmit="savePPE(event, ${isEdit ? item.id : 'null'})">
      <div class="form-row">
        <div class="form-group">
          <label>PPE Name *</label>
          <input type="text" id="ppeName" required value="${isEdit ? item.ppe_name : ''}" placeholder="e.g., Safety Helmet, T-Shirt, Polo">
        </div>
        <div class="form-group">
          <label>Category *</label>
          <select id="ppeCategory" required onchange="toggleSizeField()">
            <option value="">Select Category</option>
            <option ${isEdit && item.category === 'Uniform' ? 'selected' : ''}>Uniform</option>
            <option ${isEdit && item.category === 'Head Protection' ? 'selected' : ''}>Head Protection</option>
            <option ${isEdit && item.category === 'Eye Protection' ? 'selected' : ''}>Eye Protection</option>
            <option ${isEdit && item.category === 'Hearing Protection' ? 'selected' : ''}>Hearing Protection</option>
            <option ${isEdit && item.category === 'Respiratory Protection' ? 'selected' : ''}>Respiratory Protection</option>
            <option ${isEdit && item.category === 'Hand Protection' ? 'selected' : ''}>Hand Protection</option>
            <option ${isEdit && item.category === 'Foot Protection' ? 'selected' : ''}>Foot Protection</option>
            <option ${isEdit && item.category === 'Body Protection' ? 'selected' : ''}>Body Protection</option>
            <option ${isEdit && item.category === 'Fall Protection' ? 'selected' : ''}>Fall Protection</option>
            <option ${isEdit && item.category === 'High Visibility' ? 'selected' : ''}>High Visibility</option>
            <option ${isEdit && item.category === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>
      <div class="form-row" id="sizeRow" style="display:${showSize ? 'flex' : 'none'}">
        <div class="form-group" style="width:100%">
          <label><i class="fas fa-ruler"></i> Size</label>
          <select id="ppeSize">
            <option value="">Select Size</option>
            ${(showSize ? currentSizes : APPAREL_SIZES).map(s => `<option ${isEdit && item.size === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Unit</label>
          <select id="ppeUnit">
            <option ${isEdit && item.unit === 'pcs' ? 'selected' : ''}>pcs</option>
            <option ${isEdit && item.unit === 'pairs' ? 'selected' : ''}>pairs</option>
            <option ${isEdit && item.unit === 'boxes' ? 'selected' : ''}>boxes</option>
            <option ${isEdit && item.unit === 'sets' ? 'selected' : ''}>sets</option>
            <option ${isEdit && item.unit === 'rolls' ? 'selected' : ''}>rolls</option>
          </select>
        </div>
        <div class="form-group">
          <label>Current Stock</label>
          <input type="number" id="ppeStock" min="0" value="${isEdit ? item.current_stock : 0}">
        </div>
      </div>
      <div class="form-group">
        <label>Minimum Stock Level</label>
        <input type="number" id="ppeMinStock" min="0" value="${isEdit ? item.minimum_stock : 10}">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </form>
  `);
}

function toggleSizeField() {
    const cat = document.getElementById('ppeCategory').value;
    const sizeRow = document.getElementById('sizeRow');
    if (sizeRow) {
        const show = SIZE_CATEGORIES.includes(cat);
        sizeRow.style.display = show ? 'flex' : 'none';
        if (show) {
            const sizeSelect = document.getElementById('ppeSize');
            const sizes = getSizesForCategory(cat);
            const currentVal = sizeSelect.value;
            sizeSelect.innerHTML = '<option value="">Select Size</option>' + sizes.map(s => `<option ${s === currentVal ? 'selected' : ''}>${s}</option>`).join('');
        } else {
            const sizeSelect = document.getElementById('ppeSize');
            if (sizeSelect) sizeSelect.value = '';
        }
    }
}

async function savePPE(e, id) {
    e.preventDefault();
    const category = document.getElementById('ppeCategory').value;
    const body = {
        ppe_name: document.getElementById('ppeName').value,
        category: category,
        size: SIZE_CATEGORIES.includes(category) ? (document.getElementById('ppeSize')?.value || null) : null,
        unit: document.getElementById('ppeUnit').value,
        current_stock: parseInt(document.getElementById('ppeStock').value) || 0,
        minimum_stock: parseInt(document.getElementById('ppeMinStock').value) || 10
    };
    const res = id
        ? await api(`/api/ppe/${id}`, { method: 'PUT', body })
        : await api('/api/ppe', { method: 'POST', body });
    if (res?.success) {
        closeModal();
        showToast(id ? 'PPE item updated!' : 'PPE item added!');
        loadPPE();
    } else {
        showToast(res?.message || 'Error saving PPE item', 'error');
    }
}

async function editPPE(id) {
    const item = await api(`/api/ppe/${id}`);
    if (item) showPPEForm(item);
}

async function deletePPE(id, name) {
    openModal('Delete PPE Item', `
    <div style="text-align:center; padding: 20px 0;">
      <i class="fas fa-exclamation-triangle" style="font-size:3rem; color:var(--accent-red); margin-bottom:16px;"></i>
      <p style="margin-bottom:8px;">Are you sure you want to delete</p>
      <p style="font-weight:700; font-size:1.1rem; margin-bottom:20px;">"${name}"?</p>
      <p style="color:var(--text-muted); font-size:0.85rem;">This action cannot be undone.</p>
      <div class="form-actions" style="justify-content:center; margin-top:24px;">
        <button class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button class="btn btn-danger" onclick="confirmDeletePPE(${id})"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>
  `);
}

async function confirmDeletePPE(id) {
    const res = await api(`/api/ppe/${id}`, { method: 'DELETE' });
    if (res?.success) {
        closeModal();
        showToast('PPE item deleted');
        loadPPE();
    } else {
        showToast(res?.message || 'Error deleting', 'error');
    }
}

// ============ INCOMING PPE ============
async function loadIncoming() {
    const items = await api('/api/incoming');
    if (!items) return;
    const tbody = document.getElementById('incomingTable');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-truck-loading"></i><p>No deliveries recorded yet.</p></td></tr>';
    } else {
        tbody.innerHTML = items.map(i => `
      <tr>
        <td><strong>#${i.id}</strong></td>
        <td>${i.date_received}</td>
        <td>${i.ppe_name || '-'}</td>
        <td><strong>${i.quantity}</strong></td>
        <td>${i.supplier || '-'}</td>
        <td>${i.received_by || '-'}</td>
        <td>${i.remarks || '-'}</td>
      </tr>
    `).join('');
    }
}

async function showIncomingForm() {
    const ppeItems = await api('/api/ppe');
    const today = new Date().toISOString().slice(0, 10);
    const categories = ['Uniform','Head Protection','Eye Protection','Hearing Protection','Respiratory Protection','Hand Protection','Foot Protection','Body Protection','Fall Protection','High Visibility','Other'];
    openModal('Record PPE Delivery', `
    <form onsubmit="saveIncoming(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Date Received *</label>
          <input type="date" id="inDate" required value="${today}">
        </div>
        <div class="form-group">
          <label>PPE Source *</label>
          <select id="inMode" onchange="toggleIncomingMode()">
            <option value="existing">Select Existing PPE</option>
            <option value="new">Add New PPE Item</option>
          </select>
        </div>
      </div>
      <div id="inExistingRow" class="form-group">
        <label>PPE Item *</label>
        <select id="inPPE">
          <option value="">Select PPE</option>
          ${(ppeItems || []).map(p => `<option value="${p.id}">${p.ppe_name}${p.size ? ' (' + p.size + ')' : ''} — Stock: ${p.current_stock}</option>`).join('')}
        </select>
      </div>
      <div id="inNewRow" style="display:none">
        <div class="form-row">
          <div class="form-group">
            <label>New PPE Name *</label>
            <input type="text" id="inNewName" placeholder="e.g., Safety Shoes, Company Polo">
          </div>
          <div class="form-group">
            <label>Category *</label>
            <select id="inNewCategory" onchange="toggleIncomingSizeField()">
              <option value="">Select Category</option>
              ${categories.map(c => `<option>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" id="inSizeRow" style="display:none">
          <label><i class="fas fa-ruler"></i> Size</label>
          <select id="inNewSize">
            <option value="">Select Size</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Quantity Received *</label>
          <input type="number" id="inQty" min="1" required placeholder="e.g., 100">
        </div>
        <div class="form-group">
          <label>Supplier</label>
          <input type="text" id="inSupplier" placeholder="Supplier name">
        </div>
      </div>
      <div class="form-group">
        <label>Received By</label>
        <input type="text" id="inReceivedBy" placeholder="Staff name">
      </div>
      <div class="form-group">
        <label>Remarks</label>
        <textarea id="inRemarks" placeholder="Additional notes..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-truck-loading"></i> Record Delivery</button>
      </div>
    </form>
  `);
}

function toggleIncomingMode() {
    const mode = document.getElementById('inMode').value;
    document.getElementById('inExistingRow').style.display = mode === 'existing' ? 'block' : 'none';
    document.getElementById('inNewRow').style.display = mode === 'new' ? 'block' : 'none';
}

function toggleIncomingSizeField() {
    const cat = document.getElementById('inNewCategory').value;
    const sizeRow = document.getElementById('inSizeRow');
    const show = SIZE_CATEGORIES.includes(cat);
    sizeRow.style.display = show ? 'block' : 'none';
    if (show) {
        const sizes = getSizesForCategory(cat);
        document.getElementById('inNewSize').innerHTML = '<option value="">Select Size</option>' + sizes.map(s => `<option>${s}</option>`).join('');
    }
}

async function saveIncoming(e) {
    e.preventDefault();
    const mode = document.getElementById('inMode').value;
    const body = {
        date_received: document.getElementById('inDate').value,
        quantity: parseInt(document.getElementById('inQty').value),
        supplier: document.getElementById('inSupplier').value,
        received_by: document.getElementById('inReceivedBy').value,
        remarks: document.getElementById('inRemarks').value
    };
    if (mode === 'existing') {
        const ppeId = document.getElementById('inPPE').value;
        if (!ppeId) { showToast('Please select a PPE item', 'warning'); return; }
        body.ppe_id = parseInt(ppeId);
    } else {
        const name = document.getElementById('inNewName').value.trim();
        if (!name) { showToast('Please enter PPE name', 'warning'); return; }
        body.ppe_name = name;
        body.category = document.getElementById('inNewCategory').value || 'Other';
        body.size = document.getElementById('inNewSize')?.value || null;
    }
    const res = await api('/api/incoming', { method: 'POST', body });
    if (res?.success) {
        closeModal();
        showToast(mode === 'new' ? 'Delivery recorded! New PPE item created in inventory.' : 'Delivery recorded! Stock updated.');
        loadIncoming();
    } else {
        showToast(res?.message || 'Error recording delivery', 'error');
    }
}

// ============ PPE DISTRIBUTION ============
async function loadDistribution() {
    const items = await api('/api/distribution');
    if (!items) return;
    const tbody = document.getElementById('distributionTable');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-share-square"></i><p>No PPE distributed yet.</p></td></tr>';
    } else {
        tbody.innerHTML = items.map(i => `
      <tr>
        <td><strong>#${i.id}</strong></td>
        <td>${i.date_issued}</td>
        <td>${i.company_name || '-'}</td>
        <td>${i.ppe_name || '-'}</td>
        <td><strong>${i.quantity}</strong></td>
        <td>${i.issued_by || '-'}</td>
        <td>${i.remarks || '-'}</td>
      </tr>
    `).join('');
    }
}

async function showDistributionForm() {
    const [ppeItems, clients] = await Promise.all([api('/api/ppe'), api('/api/clients')]);
    if (!ppeItems || ppeItems.length === 0) { showToast('Please add PPE items first', 'warning'); return; }
    if (!clients || clients.length === 0) { showToast('Please add client companies first', 'warning'); return; }
    const today = new Date().toISOString().slice(0, 10);
    openModal('Issue PPE to Client', `
    <form onsubmit="saveDistribution(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Date Issued *</label>
          <input type="date" id="distDate" required value="${today}">
        </div>
        <div class="form-group">
          <label>Client Company *</label>
          <select id="distClient" required>
            <option value="">Select Client</option>
            ${clients.map(c => `<option value="${c.id}">${c.company_name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>PPE Item *</label>
          <select id="distPPE" required onchange="showStockInfo()">
            <option value="">Select PPE</option>
            ${ppeItems.map(p => `<option value="${p.id}" data-stock="${p.current_stock}" data-unit="${p.unit}">${p.ppe_name} (Stock: ${p.current_stock} ${p.unit})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Quantity to Issue *</label>
          <input type="number" id="distQty" min="1" required placeholder="e.g., 50">
          <small id="stockInfo" style="color:var(--text-muted); display:block; margin-top:4px;"></small>
        </div>
      </div>
      <div class="form-group">
        <label>Issued By</label>
        <input type="text" id="distIssuedBy" placeholder="Staff name">
      </div>
      <div class="form-group">
        <label>Remarks</label>
        <textarea id="distRemarks" placeholder="Additional notes..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-share-square"></i> Issue PPE</button>
      </div>
    </form>
  `);
}

function showStockInfo() {
    const sel = document.getElementById('distPPE');
    const opt = sel.options[sel.selectedIndex];
    const info = document.getElementById('stockInfo');
    if (opt && opt.dataset.stock !== undefined) {
        info.textContent = `Available: ${opt.dataset.stock} ${opt.dataset.unit}`;
        info.style.color = parseInt(opt.dataset.stock) > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    } else {
        info.textContent = '';
    }
}

async function saveDistribution(e) {
    e.preventDefault();
    const res = await api('/api/distribution', {
        method: 'POST',
        body: {
            date_issued: document.getElementById('distDate').value,
            client_id: parseInt(document.getElementById('distClient').value),
            ppe_id: parseInt(document.getElementById('distPPE').value),
            quantity: parseInt(document.getElementById('distQty').value),
            issued_by: document.getElementById('distIssuedBy').value,
            remarks: document.getElementById('distRemarks').value
        }
    });
    if (res?.success) {
        closeModal();
        showToast('PPE issued successfully! Stock updated.');
        loadDistribution();
    } else {
        showToast(res?.message || 'Error issuing PPE', 'error');
    }
}

// ============ CLIENTS ============
async function loadClients() {
    const items = await api('/api/clients');
    if (!items) return;
    const tbody = document.getElementById('clientsTable');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-building"></i><p>No clients added yet.</p></td></tr>';
    } else {
        tbody.innerHTML = items.map(c => `
      <tr>
        <td><strong>#${c.id}</strong></td>
        <td>${c.company_name}</td>
        <td>${c.contact_person || '-'}</td>
        <td>${c.contact_number || '-'}</td>
        <td>${c.project_location || '-'}</td>
        <td>${c.date_added}</td>
        <td>
          <button class="btn-icon" onclick="editClient(${c.id})" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" onclick="viewClientHistory(${c.id}, '${c.company_name.replace(/'/g, "\\'")}')" title="PPE History"><i class="fas fa-history"></i></button>
        </td>
      </tr>
    `).join('');
    }
}

function showClientForm(client = null) {
    const isEdit = client !== null;
    openModal(isEdit ? 'Edit Client' : 'Add New Client', `
    <form onsubmit="saveClient(event, ${isEdit ? client.id : 'null'})">
      <div class="form-group">
        <label>Company Name *</label>
        <input type="text" id="clientName" required value="${isEdit ? client.company_name : ''}" placeholder="e.g., ABC Construction Corp.">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Contact Person</label>
          <input type="text" id="clientContact" value="${isEdit ? (client.contact_person || '') : ''}" placeholder="Full name">
        </div>
        <div class="form-group">
          <label>Contact Number</label>
          <input type="text" id="clientNumber" value="${isEdit ? (client.contact_number || '') : ''}" placeholder="Phone number">
        </div>
      </div>
      <div class="form-group">
        <label>Project Location</label>
        <input type="text" id="clientLocation" value="${isEdit ? (client.project_location || '') : ''}" placeholder="e.g., Manila, Philippines">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Save'}</button>
      </div>
    </form>
  `);
}

async function saveClient(e, id) {
    e.preventDefault();
    const body = {
        company_name: document.getElementById('clientName').value,
        contact_person: document.getElementById('clientContact').value,
        contact_number: document.getElementById('clientNumber').value,
        project_location: document.getElementById('clientLocation').value
    };
    const res = id
        ? await api(`/api/clients/${id}`, { method: 'PUT', body })
        : await api('/api/clients', { method: 'POST', body });
    if (res?.success) {
        closeModal();
        showToast(id ? 'Client updated!' : 'Client added!');
        loadClients();
    } else {
        showToast(res?.message || 'Error saving client', 'error');
    }
}

async function editClient(id) {
    const client = await api(`/api/clients/${id}`);
    if (client) showClientForm(client);
}

async function viewClientHistory(id, name) {
    const items = await api(`/api/clients/${id}/history`);
    let content;
    if (!items || items.length === 0) {
        content = `<div class="empty-state"><i class="fas fa-inbox"></i><p>No PPE issued to ${name} yet.</p></div>`;
    } else {
        content = `<div class="table-container"><table>
      <thead><tr><th>Date</th><th>PPE Item</th><th>Qty</th><th>Issued By</th><th>Remarks</th></tr></thead>
      <tbody>${items.map(i => `
        <tr><td>${i.date_issued}</td><td>${i.ppe_name}</td><td>${i.quantity}</td><td>${i.issued_by || '-'}</td><td>${i.remarks || '-'}</td></tr>
      `).join('')}</tbody>
    </table></div>`;
    }
    openModal(`PPE History — ${name}`, content);
}

// ============ TRANSACTIONS ============
async function loadTransactions() {
    const search = document.getElementById('txnSearch')?.value || '';
    const type = document.getElementById('txnType')?.value || '';
    const dateFrom = document.getElementById('txnDateFrom')?.value || '';
    const dateTo = document.getElementById('txnDateTo')?.value || '';

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    const items = await api(`/api/transactions?${params}`);
    if (!items) return;
    const tbody = document.getElementById('transactionsTable');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-history"></i><p>No transactions found.</p></td></tr>';
    } else {
        tbody.innerHTML = items.map(t => `
      <tr>
        <td><strong>#${t.id}</strong></td>
        <td>${t.date}</td>
        <td>${t.ppe_name || '-'}</td>
        <td><span class="badge badge-${t.transaction_type === 'IN' ? 'in' : 'out'}">${t.transaction_type === 'IN' ? '↓ IN' : '↑ OUT'}</span></td>
        <td><strong>${t.quantity}</strong></td>
        <td>${t.company_name || '-'}</td>
        <td>${t.responsible_person || '-'}</td>
        <td>${t.remarks || '-'}</td>
        <td>
          <button class="btn-icon danger" onclick="deleteTransaction(${t.id}, '${(t.ppe_name || '').replace(/'/g, "\\'")}', '${t.transaction_type}', ${t.quantity})" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
    }
}

async function showTransactionForm() {
    const [ppeItems, clients] = await Promise.all([api('/api/ppe'), api('/api/clients')]);
    if (!ppeItems || ppeItems.length === 0) { showToast('Please add PPE items first', 'warning'); return; }
    const today = new Date().toISOString().slice(0, 10);
    openModal('Add Transaction', `
    <form onsubmit="saveTransaction(event)">
      <div class="form-row">
        <div class="form-group">
          <label>Date *</label>
          <input type="date" id="txnFormDate" required value="${today}">
        </div>
        <div class="form-group">
          <label>Type *</label>
          <select id="txnFormType" required>
            <option value="IN">↓ IN (Received)</option>
            <option value="OUT">↑ OUT (Issued)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>PPE Item *</label>
          <select id="txnFormPPE" required>
            <option value="">Select PPE</option>
            ${ppeItems.map(p => `<option value="${p.id}">${p.ppe_name}${p.size ? ' (' + p.size + ')' : ''} — Stock: ${p.current_stock}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Quantity *</label>
          <input type="number" id="txnFormQty" min="1" required placeholder="e.g., 10">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Client (optional)</label>
          <select id="txnFormClient">
            <option value="">No Client</option>
            ${(clients || []).map(c => `<option value="${c.id}">${c.company_name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Responsible Person</label>
          <input type="text" id="txnFormPerson" placeholder="Staff name">
        </div>
      </div>
      <div class="form-group">
        <label>Remarks</label>
        <textarea id="txnFormRemarks" placeholder="Additional notes..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-plus"></i> Add Transaction</button>
      </div>
    </form>
  `);
}

async function saveTransaction(e) {
    e.preventDefault();
    const res = await api('/api/transactions', {
        method: 'POST',
        body: {
            date: document.getElementById('txnFormDate').value,
            transaction_type: document.getElementById('txnFormType').value,
            ppe_id: parseInt(document.getElementById('txnFormPPE').value),
            quantity: parseInt(document.getElementById('txnFormQty').value),
            client_id: document.getElementById('txnFormClient').value || null,
            responsible_person: document.getElementById('txnFormPerson').value,
            remarks: document.getElementById('txnFormRemarks').value
        }
    });
    if (res?.success) {
        closeModal();
        showToast('Transaction added! Stock updated.');
        loadTransactions();
    } else {
        showToast(res?.message || 'Error adding transaction', 'error');
    }
}

function deleteTransaction(id, ppeName, type, qty) {
    openModal('Delete Transaction', `
    <div style="text-align:center; padding: 20px 0;">
      <i class="fas fa-exclamation-triangle" style="font-size:3rem; color:var(--accent-red); margin-bottom:16px;"></i>
      <p style="margin-bottom:8px;">Are you sure you want to delete this transaction?</p>
      <p style="font-weight:700; font-size:1.1rem; margin-bottom:8px;">"${ppeName}" — ${type} ${qty} units</p>
      <p style="color:var(--accent-yellow); font-size:0.85rem; margin-bottom:20px;"><i class="fas fa-info-circle"></i> Stock will be automatically reversed.</p>
      <div class="form-actions" style="justify-content:center; margin-top:24px;">
        <button class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button class="btn btn-danger" onclick="confirmDeleteTransaction(${id})"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>
  `);
}

async function confirmDeleteTransaction(id) {
    const res = await api(`/api/transactions/${id}`, { method: 'DELETE' });
    if (res?.success) {
        closeModal();
        showToast('Transaction deleted. Stock reversed.');
        loadTransactions();
    } else {
        showToast(res?.message || 'Error deleting transaction', 'error');
    }
}

// ============ REPORTS ============
async function generateReport(type) {
    let data, title, headers;
    const preview = document.getElementById('reportPreview');
    const previewTable = document.getElementById('reportPreviewTable');

    if (type === 'inventory') {
        data = await api('/api/reports/inventory');
        title = 'PPE Inventory Summary';
        headers = ['ID', 'PPE Name', 'Category', 'Unit', 'Current Stock', 'Min Stock', 'Status'];
        previewTable.innerHTML = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${data.map(i => `<tr><td>${i.id}</td><td>${i.ppe_name}</td><td>${i.category}</td><td>${i.unit}</td><td><strong>${i.current_stock}</strong></td><td>${i.minimum_stock}</td><td>${i.current_stock <= i.minimum_stock ? '<span class="badge badge-low">Low Stock</span>' : '<span class="badge badge-ok">OK</span>'}</td></tr>`).join('')}
    </tbody></table>`;
    } else if (type === 'received') {
        data = await api('/api/reports/received');
        title = 'PPE Received History';
        headers = ['ID', 'Date', 'PPE Item', 'Qty', 'Supplier', 'Received By', 'Remarks'];
        previewTable.innerHTML = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${data.map(i => `<tr><td>${i.id}</td><td>${i.date_received}</td><td>${i.ppe_name}</td><td>${i.quantity}</td><td>${i.supplier || '-'}</td><td>${i.received_by || '-'}</td><td>${i.remarks || '-'}</td></tr>`).join('')}
    </tbody></table>`;
    } else if (type === 'issued') {
        data = await api('/api/reports/issued');
        title = 'PPE Issued to Clients';
        headers = ['ID', 'Date', 'Client', 'PPE Item', 'Qty', 'Issued By', 'Remarks'];
        previewTable.innerHTML = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${data.map(i => `<tr><td>${i.id}</td><td>${i.date_issued}</td><td>${i.company_name}</td><td>${i.ppe_name}</td><td>${i.quantity}</td><td>${i.issued_by || '-'}</td><td>${i.remarks || '-'}</td></tr>`).join('')}
    </tbody></table>`;
    }

    document.getElementById('reportPreviewTitle').textContent = title;
    preview.style.display = 'block';
    preview.scrollIntoView({ behavior: 'smooth' });
}

function downloadExcel(type) {
    window.open(`/api/reports/excel/${type}`, '_blank');
    showToast('Excel report downloading...', 'info');
}

async function downloadPDF(type) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    // Header
    doc.setFontSize(16);
    doc.setTextColor(26, 58, 107);
    doc.text('TAASCOR MANAGEMENT & GENERAL SERVICES CORP.', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(196, 18, 48);

    let title, headers, rows;

    if (type === 'inventory') {
        title = 'PPE Inventory Summary Report';
        const data = await api('/api/reports/inventory');
        headers = [['ID', 'PPE Name', 'Category', 'Unit', 'Current Stock', 'Min Stock', 'Status']];
        rows = data.map(i => [i.id, i.ppe_name, i.category, i.unit, i.current_stock, i.minimum_stock, i.current_stock <= i.minimum_stock ? 'LOW STOCK' : 'OK']);
    } else if (type === 'received') {
        title = 'PPE Received History Report';
        const data = await api('/api/reports/received');
        headers = [['ID', 'Date', 'PPE Item', 'Quantity', 'Supplier', 'Received By', 'Remarks']];
        rows = data.map(i => [i.id, i.date_received, i.ppe_name, i.quantity, i.supplier || '-', i.received_by || '-', i.remarks || '-']);
    } else if (type === 'issued') {
        title = 'PPE Issued to Clients Report';
        const data = await api('/api/reports/issued');
        headers = [['ID', 'Date', 'Client', 'PPE Item', 'Quantity', 'Issued By', 'Remarks']];
        rows = data.map(i => [i.id, i.date_issued, i.company_name, i.ppe_name, i.quantity, i.issued_by || '-', i.remarks || '-']);
    }

    doc.text(title, doc.internal.pageSize.getWidth() / 2, 22, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, doc.internal.pageSize.getWidth() / 2, 28, { align: 'center' });

    doc.autoTable({
        head: headers,
        body: rows,
        startY: 34,
        theme: 'grid',
        headStyles: { fillColor: [26, 58, 107], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin: { left: 14, right: 14 }
    });

    doc.save(`TAASCOR_PPE_${type}_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('PDF report generated!', 'info');
}

// ============ SETTINGS ============
function showSettings() {
    openModal('Settings', `
    <h4 style="margin-bottom:16px; color:var(--text-secondary);">Change PIN</h4>
    <form onsubmit="changePin(event)">
      <div class="form-group">
        <label>Current PIN</label>
        <input type="password" id="settCurrentPin" maxlength="6" required placeholder="Enter current PIN" pattern="[0-9]{6}">
      </div>
      <div class="form-group">
        <label>New PIN (6 digits)</label>
        <input type="password" id="settNewPin" maxlength="6" required placeholder="Enter new PIN" pattern="[0-9]{6}">
      </div>
      <div class="form-group">
        <label>Confirm New PIN</label>
        <input type="password" id="settConfirmPin" maxlength="6" required placeholder="Confirm new PIN" pattern="[0-9]{6}">
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="closeModal()" style="background:var(--bg-secondary)">Cancel</button>
        <button type="submit" class="btn btn-primary"><i class="fas fa-key"></i> Change PIN</button>
      </div>
    </form>
  `);
}

async function changePin(e) {
    e.preventDefault();
    const currentPin = document.getElementById('settCurrentPin').value;
    const newPin = document.getElementById('settNewPin').value;
    const confirmPin = document.getElementById('settConfirmPin').value;

    if (newPin !== confirmPin) { showToast('New PIN and confirmation do not match', 'error'); return; }
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) { showToast('PIN must be exactly 6 digits', 'error'); return; }

    const res = await api('/api/pin/change', { method: 'POST', body: { currentPin, newPin } });
    if (res?.success) {
        closeModal();
        showToast('PIN changed successfully!');
    } else {
        showToast(res?.message || 'Error changing PIN', 'error');
    }
}

// ============ NETWORK INFO ============
// Removed - not needed for online deployment

// ============ THEME TOGGLE ============
function toggleTheme() {
    const body = document.body;
    const isLight = body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        const icon = document.querySelector('#themeToggle i');
        if (icon) icon.className = 'fas fa-moon';
    }
});
