/**
 * Music Venue Management System - Frontend Application
 * Version 2.0 with Receipt OCR Support
 */

// ==================== CONFIGURATION ====================
const CONFIG = window.APP_CONFIG || {
    API_URL: window.location.origin
};

const API_URL = CONFIG.API_URL;

// ==================== STATE ====================
let state = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    currentView: 'dashboard',
    events: [],
    costs: [],
    revenues: [],
    receipts: [],
    categories: null
};

// ==================== API HELPERS ====================
async function api(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            logout();
            throw new Error('Sesja wygasła');
        }
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Błąd API');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function apiFormData(endpoint, formData) {
    const headers = {};
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || 'Błąd uploadu');
    }
    return data;
}

// ==================== AUTH ====================
async function login(email, password) {
    const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    
    state.token = data.access_token;
    state.user = data.user;
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    showApp();
    loadCategories();
    showDashboard();
}

function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showLogin();
}

async function register(email, password, fullName) {
    await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name: fullName })
    });
    showToast('Konto utworzone! Możesz się zalogować.', 'success');
    document.getElementById('registerForm').reset();
    document.getElementById('loginTab').click();
}

// ==================== UI HELPERS ====================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showLogin() {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
}

function showApp() {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appPage').style.display = 'flex';
    
    document.getElementById('userName').textContent = state.user?.full_name || 'Użytkownik';
    document.getElementById('userRole').textContent = getRoleLabel(state.user?.role);
    
    // Hide admin menu for workers
    const adminItems = document.querySelectorAll('.admin-only');
    adminItems.forEach(item => {
        item.style.display = ['owner', 'manager'].includes(state.user?.role) ? 'block' : 'none';
    });
}

function getRoleLabel(role) {
    const labels = { owner: 'Właściciel', manager: 'Manager', worker: 'Pracownik' };
    return labels[role] || role;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('pl-PL');
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pl-PL');
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount || 0);
}

function getCategoryLabel(category) {
    const labels = {
        bar_alcohol: '🍺 Alkohol',
        bar_beverages: '🥤 Napoje',
        bar_food: '🍕 Jedzenie',
        bar_supplies: '📦 Zaopatrzenie bar',
        staff_wages: '👥 Wynagrodzenia',
        equipment_rental: '🎸 Wynajem sprzętu',
        marketing: '📢 Marketing',
        utilities: '💡 Media',
        maintenance: '🔧 Konserwacja',
        cleaning: '🧹 Sprzątanie',
        security: '🛡️ Ochrona',
        artist_fee: '🎤 Honorarium artysty',
        sound_engineer: '🎚️ Realizator dźwięku',
        lighting: '💡 Oświetlenie',
        licenses: '📄 Licencje',
        insurance: '🏥 Ubezpieczenia',
        other: '📋 Inne'
    };
    return labels[category] || category;
}

function getRevenueLabel(source) {
    const labels = {
        box_office: '🎫 Bilety',
        bar_sales: '🍺 Sprzedaż bar',
        merchandise: '👕 Merchandise',
        sponsorship: '🤝 Sponsoring',
        rental: '🏠 Wynajem',
        other: '📋 Inne'
    };
    return labels[source] || source;
}

function getStatusBadge(status) {
    const badges = {
        pending: '<span class="badge badge-warning">Oczekuje</span>',
        processing: '<span class="badge badge-info">Przetwarzanie</span>',
        processed: '<span class="badge badge-primary">Przetworzony</span>',
        verified: '<span class="badge badge-success">Zweryfikowany</span>',
        rejected: '<span class="badge badge-danger">Odrzucony</span>',
        planned: '<span class="badge badge-info">Planowane</span>',
        completed: '<span class="badge badge-success">Zakończone</span>',
        cancelled: '<span class="badge badge-danger">Anulowane</span>'
    };
    return badges[status] || `<span class="badge">${status}</span>`;
}

// ==================== LOAD CATEGORIES ====================
async function loadCategories() {
    try {
        state.categories = await api('/api/stats/categories');
    } catch (e) {
        console.error('Error loading categories:', e);
    }
}

// ==================== VIEWS ====================
function setActiveNav(viewId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-view="${viewId}"]`);
    if (activeItem) activeItem.classList.add('active');
}

function showView(viewId) {
    state.currentView = viewId;
    setActiveNav(viewId);
    
    const content = document.getElementById('mainContent');
    
    switch(viewId) {
        case 'dashboard': showDashboard(); break;
        case 'events': showEvents(); break;
        case 'costs': showCosts(); break;
        case 'revenue': showRevenue(); break;
        case 'receipts': showReceipts(); break;
        case 'reports': showReports(); break;
        case 'users': showUsers(); break;
        default: showDashboard();
    }
}

// ==================== DASHBOARD ====================
async function showDashboard() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie...</div>';
    
    try {
        const [eventsData, costsData] = await Promise.all([
            api('/api/events?limit=5'),
            api('/api/costs?limit=10')
        ]);
        
        const totalCosts = costsData.reduce((sum, c) => sum + c.amount, 0);
        
        content.innerHTML = `
            <div class="dashboard">
                <h1>📊 Panel główny</h1>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">🎵</div>
                        <div class="stat-info">
                            <span class="stat-value">${eventsData.total}</span>
                            <span class="stat-label">Wydarzenia</span>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">💰</div>
                        <div class="stat-info">
                            <span class="stat-value">${formatCurrency(totalCosts)}</span>
                            <span class="stat-label">Koszty (ostatnie)</span>
                        </div>
                    </div>
                </div>
                
                <div class="dashboard-sections">
                    <div class="dashboard-section">
                        <h3>🎤 Ostatnie wydarzenia</h3>
                        ${eventsData.events.length ? `
                            <ul class="event-list">
                                ${eventsData.events.map(e => `
                                    <li class="event-item" onclick="showEventDetail(${e.id})">
                                        <strong>${e.name}</strong>
                                        <span>${formatDate(e.date)}</span>
                                        ${getStatusBadge(e.status)}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : '<p class="empty-state">Brak wydarzeń</p>'}
                    </div>
                    
                    <div class="dashboard-section">
                        <h3>📝 Ostatnie koszty</h3>
                        ${costsData.length ? `
                            <ul class="cost-list">
                                ${costsData.slice(0, 5).map(c => `
                                    <li class="cost-item">
                                        <span>${getCategoryLabel(c.category)}</span>
                                        <strong>${formatCurrency(c.amount)}</strong>
                                    </li>
                                `).join('')}
                            </ul>
                        ` : '<p class="empty-state">Brak kosztów</p>'}
                    </div>
                </div>
                
                <div class="quick-actions">
                    <h3>⚡ Szybkie akcje</h3>
                    <div class="action-buttons">
                        <button class="btn btn-primary" onclick="showAddEventModal()">➕ Nowe wydarzenie</button>
                        <button class="btn btn-secondary" onclick="showAddCostModal()">💸 Dodaj koszt</button>
                        <button class="btn btn-success" onclick="showUploadReceiptModal()">📷 Dodaj paragon</button>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

// ==================== EVENTS ====================
async function showEvents() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie wydarzeń...</div>';
    
    try {
        const data = await api('/api/events');
        state.events = data.events;
        
        content.innerHTML = `
            <div class="page-header">
                <h1>🎵 Wydarzenia</h1>
                <button class="btn btn-primary" onclick="showAddEventModal()">➕ Nowe wydarzenie</button>
            </div>
            
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Nazwa</th>
                            <th>Data</th>
                            <th>Status</th>
                            <th>Pojemność</th>
                            <th>Cena biletu</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.events.map(e => `
                            <tr>
                                <td><strong>${e.name}</strong></td>
                                <td>${formatDateTime(e.date)}</td>
                                <td>${getStatusBadge(e.status)}</td>
                                <td>${e.capacity || '-'}</td>
                                <td>${e.ticket_price ? formatCurrency(e.ticket_price) : '-'}</td>
                                <td class="actions">
                                    <button class="btn btn-sm" onclick="showEventDetail(${e.id})">👁️</button>
                                    <button class="btn btn-sm" onclick="editEvent(${e.id})">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

function showAddEventModal() {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    modalContent.innerHTML = `
        <h2>➕ Nowe wydarzenie</h2>
        <form id="eventForm" onsubmit="saveEvent(event)">
            <div class="form-group">
                <label>Nazwa wydarzenia *</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>Data i godzina *</label>
                <input type="datetime-local" name="date" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description" rows="3"></textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Pojemność</label>
                    <input type="number" name="capacity" min="0">
                </div>
                <div class="form-group">
                    <label>Cena biletu (PLN)</label>
                    <input type="number" name="ticket_price" min="0" step="0.01">
                </div>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select name="status">
                    <option value="planned">Planowane</option>
                    <option value="confirmed">Potwierdzone</option>
                    <option value="completed">Zakończone</option>
                    <option value="cancelled">Anulowane</option>
                </select>
            </div>
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Zapisz</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

async function saveEvent(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const data = {
        name: formData.get('name'),
        date: new Date(formData.get('date')).toISOString(),
        description: formData.get('description') || null,
        capacity: formData.get('capacity') ? parseInt(formData.get('capacity')) : null,
        ticket_price: formData.get('ticket_price') ? parseFloat(formData.get('ticket_price')) : null,
        status: formData.get('status')
    };
    
    try {
        await api('/api/events', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showToast('Wydarzenie utworzone!', 'success');
        showEvents();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteEvent(id) {
    if (!confirm('Czy na pewno chcesz usunąć to wydarzenie?')) return;
    
    try {
        await api(`/api/events/${id}`, { method: 'DELETE' });
        showToast('Wydarzenie usunięte', 'success');
        showEvents();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== COSTS ====================
async function showCosts() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie kosztów...</div>';
    
    try {
        const data = await api('/api/costs');
        state.costs = data;
        
        const totalByCategory = {};
        data.forEach(c => {
            totalByCategory[c.category] = (totalByCategory[c.category] || 0) + c.amount;
        });
        
        content.innerHTML = `
            <div class="page-header">
                <h1>💸 Koszty</h1>
                <div class="header-actions">
                    <button class="btn btn-success" onclick="showUploadReceiptModal()">📷 Dodaj paragon</button>
                    <button class="btn btn-primary" onclick="showAddCostModal()">➕ Dodaj koszt</button>
                </div>
            </div>
            
            <div class="costs-summary">
                <h3>Podsumowanie według kategorii</h3>
                <div class="category-grid">
                    ${Object.entries(totalByCategory).map(([cat, amount]) => `
                        <div class="category-card">
                            <span class="cat-label">${getCategoryLabel(cat)}</span>
                            <span class="cat-amount">${formatCurrency(amount)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Kategoria</th>
                            <th>Kwota</th>
                            <th>Opis</th>
                            <th>Dostawca</th>
                            <th>Data</th>
                            <th>Paragon</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(c => `
                            <tr>
                                <td>${getCategoryLabel(c.category)}</td>
                                <td><strong>${formatCurrency(c.amount)}</strong></td>
                                <td>${c.description || '-'}</td>
                                <td>${c.vendor || '-'}</td>
                                <td>${formatDate(c.cost_date || c.created_at)}</td>
                                <td>${c.receipt_id ? `<button class="btn btn-sm" onclick="viewReceipt(${c.receipt_id})">📷</button>` : '-'}</td>
                                <td class="actions">
                                    <button class="btn btn-sm" onclick="editCost(${c.id})">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteCost(${c.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

function showAddCostModal(eventId = null) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    const categoryOptions = state.categories?.cost_categories?.map(c => 
        `<option value="${c.value}">${getCategoryLabel(c.value)}</option>`
    ).join('') || '';
    
    modalContent.innerHTML = `
        <h2>💸 Dodaj koszt</h2>
        <form id="costForm" onsubmit="saveCost(event)">
            <div class="form-group">
                <label>Kategoria *</label>
                <select name="category" required>
                    <optgroup label="🍺 Bar">
                        <option value="bar_alcohol">Alkohol</option>
                        <option value="bar_beverages">Napoje bezalkoholowe</option>
                        <option value="bar_food">Jedzenie</option>
                        <option value="bar_supplies">Zaopatrzenie bar</option>
                    </optgroup>
                    <optgroup label="🎤 Artyści i event">
                        <option value="artist_fee">Honorarium artysty</option>
                        <option value="sound_engineer">Realizator dźwięku</option>
                        <option value="lighting">Oświetlenie</option>
                        <option value="equipment_rental">Wynajem sprzętu</option>
                    </optgroup>
                    <optgroup label="🏢 Operacyjne">
                        <option value="staff_wages">Wynagrodzenia</option>
                        <option value="utilities">Media</option>
                        <option value="maintenance">Konserwacja</option>
                        <option value="cleaning">Sprzątanie</option>
                        <option value="security">Ochrona</option>
                        <option value="marketing">Marketing</option>
                    </optgroup>
                    <optgroup label="📋 Inne">
                        <option value="licenses">Licencje</option>
                        <option value="insurance">Ubezpieczenia</option>
                        <option value="other">Inne</option>
                    </optgroup>
                </select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" step="0.01" min="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <input type="text" name="description">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Dostawca/Sklep</label>
                    <input type="text" name="vendor" placeholder="np. Makro, Hurtownia XYZ">
                </div>
                <div class="form-group">
                    <label>Nr faktury/paragonu</label>
                    <input type="text" name="invoice_number">
                </div>
            </div>
            <div class="form-group">
                <label>Data kosztu</label>
                <input type="date" name="cost_date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <input type="hidden" name="event_id" value="${eventId || ''}">
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Zapisz</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

async function saveCost(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const data = {
        category: formData.get('category'),
        amount: parseFloat(formData.get('amount')),
        description: formData.get('description') || null,
        vendor: formData.get('vendor') || null,
        invoice_number: formData.get('invoice_number') || null,
        cost_date: formData.get('cost_date') ? new Date(formData.get('cost_date')).toISOString() : null
    };
    
    if (formData.get('event_id')) {
        data.event_id = parseInt(formData.get('event_id'));
    }
    
    try {
        await api('/api/costs', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showToast('Koszt dodany!', 'success');
        showCosts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteCost(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten koszt?')) return;
    
    try {
        await api(`/api/costs/${id}`, { method: 'DELETE' });
        showToast('Koszt usunięty', 'success');
        showCosts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== RECEIPTS ====================
async function showReceipts() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie paragonów...</div>';
    
    try {
        const data = await api('/api/receipts');
        state.receipts = data.receipts;
        
        content.innerHTML = `
            <div class="page-header">
                <h1>📷 Paragony i faktury</h1>
                <button class="btn btn-primary" onclick="showUploadReceiptModal()">➕ Dodaj paragon</button>
            </div>
            
            <div class="info-box">
                <strong>💡 Jak to działa:</strong>
                <ol>
                    <li>Prześlij zdjęcie paragonu</li>
                    <li>Wprowadź tekst OCR (lub użyj aplikacji do skanowania)</li>
                    <li>System automatycznie rozpozna sklep, datę i produkty</li>
                    <li>Utwórz koszty jednym kliknięciem</li>
                </ol>
            </div>
            
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Plik</th>
                            <th>Sklep</th>
                            <th>Data paragonu</th>
                            <th>Suma</th>
                            <th>Status</th>
                            <th>Przesłano</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.receipts.length ? data.receipts.map(r => `
                            <tr>
                                <td>📄 ${r.filename}</td>
                                <td>${r.store_name || '-'}</td>
                                <td>${r.receipt_date ? formatDate(r.receipt_date) : '-'}</td>
                                <td>${r.total_amount ? formatCurrency(r.total_amount) : '-'}</td>
                                <td>${getStatusBadge(r.status)}</td>
                                <td>${formatDate(r.uploaded_at)}</td>
                                <td class="actions">
                                    <button class="btn btn-sm" onclick="viewReceipt(${r.id})">👁️</button>
                                    ${r.status === 'processed' ? `<button class="btn btn-sm btn-success" onclick="createCostsFromReceipt(${r.id})">💰</button>` : ''}
                                    <button class="btn btn-sm" onclick="processReceiptOCR(${r.id})">🔍</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteReceipt(${r.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="7" class="empty-state">Brak paragonów</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

function showUploadReceiptModal() {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    modalContent.innerHTML = `
        <h2>📷 Dodaj paragon</h2>
        <form id="receiptForm" onsubmit="uploadReceipt(event)">
            <div class="form-group">
                <label>Zdjęcie paragonu *</label>
                <input type="file" name="file" accept="image/*,.pdf" required onchange="previewImage(this)">
                <div id="imagePreview" class="image-preview"></div>
            </div>
            
            <div class="form-group">
                <label>Tekst OCR (opcjonalnie)</label>
                <textarea name="ocr_text" rows="6" placeholder="Wklej tekst z paragonu lub pozostaw puste..."></textarea>
                <small>Tip: Użyj Google Lens lub podobnej aplikacji do skanowania tekstu z paragonu</small>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Prześlij</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

function previewImage(input) {
    const preview = document.getElementById('imagePreview');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: 300px;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function uploadReceipt(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        // First upload the file
        const uploadData = new FormData();
        uploadData.append('file', formData.get('file'));
        
        const result = await apiFormData('/api/receipts/upload', uploadData);
        
        // If OCR text provided, process it
        const ocrText = formData.get('ocr_text');
        if (ocrText && ocrText.trim()) {
            const processData = new FormData();
            processData.append('ocr_text', ocrText);
            await apiFormData(`/api/receipts/${result.id}/process`, processData);
        }
        
        closeModal();
        showToast('Paragon przesłany!', 'success');
        showReceipts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function viewReceipt(id) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    try {
        const receipt = await api(`/api/receipts/${id}`);
        
        modalContent.innerHTML = `
            <h2>📷 Paragon #${receipt.id}</h2>
            <div class="receipt-detail">
                <div class="receipt-image">
                    <img src="${API_URL}/api/receipts/${id}/image" alt="Paragon" style="max-width: 100%; max-height: 400px;">
                </div>
                <div class="receipt-info">
                    <p><strong>Sklep:</strong> ${receipt.store_name || 'Nie rozpoznano'}</p>
                    <p><strong>Data:</strong> ${receipt.receipt_date ? formatDate(receipt.receipt_date) : 'Nie rozpoznano'}</p>
                    <p><strong>Suma:</strong> ${receipt.total_amount ? formatCurrency(receipt.total_amount) : 'Nie rozpoznano'}</p>
                    <p><strong>Status:</strong> ${getStatusBadge(receipt.status)}</p>
                    <p><strong>Pewność OCR:</strong> ${receipt.ocr_confidence ? receipt.ocr_confidence.toFixed(0) + '%' : '-'}</p>
                    
                    ${receipt.ocr_raw_text ? `
                        <h4>Rozpoznany tekst:</h4>
                        <pre class="ocr-text">${receipt.ocr_raw_text}</pre>
                    ` : ''}
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Zamknij</button>
                ${receipt.status === 'processed' ? `
                    <button class="btn btn-success" onclick="createCostsFromReceipt(${id}); closeModal();">💰 Utwórz koszty</button>
                ` : ''}
            </div>
        `;
        
        modal.style.display = 'flex';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function processReceiptOCR(id) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    modalContent.innerHTML = `
        <h2>🔍 Przetwórz OCR</h2>
        <p>Wklej tekst z paragonu (użyj Google Lens lub innej aplikacji OCR):</p>
        <form onsubmit="submitOCR(event, ${id})">
            <div class="form-group">
                <textarea name="ocr_text" rows="10" required placeholder="Wklej tekst paragonu tutaj..."></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Przetwórz</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

async function submitOCR(e, receiptId) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    try {
        const processData = new FormData();
        processData.append('ocr_text', formData.get('ocr_text'));
        
        const result = await apiFormData(`/api/receipts/${receiptId}/process`, processData);
        
        closeModal();
        showToast(`Rozpoznano: ${result.store_name || 'sklep'}, suma: ${result.total || 'nieznana'}`, 'success');
        showReceipts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function createCostsFromReceipt(id) {
    if (!confirm('Utworzyć koszty z pozycji paragonu?')) return;
    
    try {
        const result = await api(`/api/receipts/${id}/create-costs`, { method: 'POST' });
        showToast(result.message, 'success');
        showCosts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteReceipt(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten paragon?')) return;
    
    try {
        await api(`/api/receipts/${id}`, { method: 'DELETE' });
        showToast('Paragon usunięty', 'success');
        showReceipts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== REVENUE ====================
async function showRevenue() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie przychodów...</div>';
    
    try {
        const events = await api('/api/events');
        
        content.innerHTML = `
            <div class="page-header">
                <h1>💰 Przychody</h1>
                <button class="btn btn-primary" onclick="showAddRevenueModal()">➕ Dodaj przychód</button>
            </div>
            
            <p>Wybierz wydarzenie, aby zobaczyć przychody:</p>
            
            <div class="event-cards">
                ${events.events.map(e => `
                    <div class="event-card" onclick="showEventRevenue(${e.id})">
                        <h3>${e.name}</h3>
                        <p>${formatDate(e.date)}</p>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

async function showEventRevenue(eventId) {
    try {
        const revenues = await api(`/api/revenue/event/${eventId}`);
        const event = state.events.find(e => e.id === eventId) || { name: 'Wydarzenie' };
        
        const modal = document.getElementById('modal');
        const modalContent = document.getElementById('modalContent');
        
        const total = revenues.reduce((sum, r) => sum + r.amount, 0);
        
        modalContent.innerHTML = `
            <h2>💰 Przychody: ${event.name}</h2>
            <p><strong>Suma:</strong> ${formatCurrency(total)}</p>
            
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Źródło</th>
                        <th>Kwota</th>
                        <th>Opis</th>
                    </tr>
                </thead>
                <tbody>
                    ${revenues.map(r => `
                        <tr>
                            <td>${getRevenueLabel(r.source)}</td>
                            <td>${formatCurrency(r.amount)}</td>
                            <td>${r.description || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="form-actions">
                <button class="btn" onclick="closeModal()">Zamknij</button>
                <button class="btn btn-primary" onclick="closeModal(); showAddRevenueModal(${eventId})">➕ Dodaj</button>
            </div>
        `;
        
        modal.style.display = 'flex';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showAddRevenueModal(eventId = null) {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    const eventOptions = state.events.map(e => 
        `<option value="${e.id}" ${e.id === eventId ? 'selected' : ''}>${e.name}</option>`
    ).join('');
    
    modalContent.innerHTML = `
        <h2>💰 Dodaj przychód</h2>
        <form id="revenueForm" onsubmit="saveRevenue(event)">
            <div class="form-group">
                <label>Wydarzenie</label>
                <select name="event_id">
                    <option value="">-- Bez wydarzenia --</option>
                    ${eventOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Źródło *</label>
                <select name="source" required>
                    <option value="box_office">🎫 Bilety</option>
                    <option value="bar_sales">🍺 Sprzedaż bar</option>
                    <option value="merchandise">👕 Merchandise</option>
                    <option value="sponsorship">🤝 Sponsoring</option>
                    <option value="rental">🏠 Wynajem</option>
                    <option value="other">📋 Inne</option>
                </select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" step="0.01" min="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <input type="text" name="description">
            </div>
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Zapisz</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

async function saveRevenue(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const data = {
        source: formData.get('source'),
        amount: parseFloat(formData.get('amount')),
        description: formData.get('description') || null
    };
    
    if (formData.get('event_id')) {
        data.event_id = parseInt(formData.get('event_id'));
    }
    
    try {
        await api('/api/revenue', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        closeModal();
        showToast('Przychód dodany!', 'success');
        showRevenue();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== REPORTS ====================
async function showReports() {
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>📊 Raporty</h1>
        </div>
        
        <div class="report-options">
            <div class="report-card" onclick="showEventReportSelector()">
                <h3>🎵 Raport wydarzenia</h3>
                <p>Podsumowanie finansowe pojedynczego wydarzenia</p>
            </div>
            
            <div class="report-card" onclick="showPeriodReportForm()">
                <h3>📅 Raport okresowy</h3>
                <p>Podsumowanie za wybrany okres</p>
            </div>
        </div>
    `;
}

async function showEventReportSelector() {
    try {
        const events = await api('/api/events');
        
        const modal = document.getElementById('modal');
        const modalContent = document.getElementById('modalContent');
        
        modalContent.innerHTML = `
            <h2>📊 Wybierz wydarzenie</h2>
            <div class="event-list-modal">
                ${events.events.map(e => `
                    <div class="event-option" onclick="generateEventReport(${e.id})">
                        <strong>${e.name}</strong>
                        <span>${formatDate(e.date)}</span>
                    </div>
                `).join('')}
            </div>
            <div class="form-actions">
                <button class="btn" onclick="closeModal()">Anuluj</button>
            </div>
        `;
        
        modal.style.display = 'flex';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function generateEventReport(eventId) {
    closeModal();
    
    try {
        const report = await api(`/api/reports/event/${eventId}`);
        
        const content = document.getElementById('mainContent');
        content.innerHTML = `
            <div class="page-header">
                <h1>📊 Raport: ${report.event_name}</h1>
                <button class="btn" onclick="showReports()">← Powrót</button>
            </div>
            
            <div class="report-summary">
                <div class="report-stat ${report.net_profit >= 0 ? 'positive' : 'negative'}">
                    <span class="label">Zysk netto</span>
                    <span class="value">${formatCurrency(report.net_profit)}</span>
                </div>
                <div class="report-stat">
                    <span class="label">Marża</span>
                    <span class="value">${report.profit_margin.toFixed(1)}%</span>
                </div>
            </div>
            
            <div class="report-details">
                <div class="report-section">
                    <h3>💸 Koszty: ${formatCurrency(report.total_costs)}</h3>
                    <div class="breakdown">
                        ${Object.entries(report.costs_breakdown).map(([cat, amount]) => `
                            <div class="breakdown-item">
                                <span>${getCategoryLabel(cat)}</span>
                                <span>${formatCurrency(amount)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="report-section">
                    <h3>💰 Przychody: ${formatCurrency(report.total_revenue)}</h3>
                    <div class="breakdown">
                        ${Object.entries(report.revenue_breakdown).map(([src, amount]) => `
                            <div class="breakdown-item">
                                <span>${getRevenueLabel(src)}</span>
                                <span>${formatCurrency(amount)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showPeriodReportForm() {
    const modal = document.getElementById('modal');
    const modalContent = document.getElementById('modalContent');
    
    const today = new Date().toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    
    modalContent.innerHTML = `
        <h2>📅 Raport okresowy</h2>
        <form onsubmit="generatePeriodReport(event)">
            <div class="form-row">
                <div class="form-group">
                    <label>Od</label>
                    <input type="date" name="start_date" value="${monthAgo}" required>
                </div>
                <div class="form-group">
                    <label>Do</label>
                    <input type="date" name="end_date" value="${today}" required>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn" onclick="closeModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">Generuj</button>
            </div>
        </form>
    `;
    
    modal.style.display = 'flex';
}

async function generatePeriodReport(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    closeModal();
    
    try {
        const report = await api(`/api/reports/period?start_date=${formData.get('start_date')}&end_date=${formData.get('end_date')}`);
        
        const content = document.getElementById('mainContent');
        content.innerHTML = `
            <div class="page-header">
                <h1>📅 Raport: ${formatDate(report.period_from)} - ${formatDate(report.period_to)}</h1>
                <button class="btn" onclick="showReports()">← Powrót</button>
            </div>
            
            <div class="report-summary">
                <div class="report-stat">
                    <span class="label">Wydarzenia</span>
                    <span class="value">${report.events_count}</span>
                </div>
                <div class="report-stat ${report.net_profit >= 0 ? 'positive' : 'negative'}">
                    <span class="label">Zysk netto</span>
                    <span class="value">${formatCurrency(report.net_profit)}</span>
                </div>
                <div class="report-stat">
                    <span class="label">Marża</span>
                    <span class="value">${report.profit_margin.toFixed(1)}%</span>
                </div>
            </div>
            
            <div class="report-totals">
                <div class="total-item">
                    <span>💸 Całkowite koszty:</span>
                    <strong>${formatCurrency(report.total_costs)}</strong>
                </div>
                <div class="total-item">
                    <span>💰 Całkowite przychody:</span>
                    <strong>${formatCurrency(report.total_revenue)}</strong>
                </div>
            </div>
        `;
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== USERS ====================
async function showUsers() {
    const content = document.getElementById('mainContent');
    content.innerHTML = '<div class="loading">Ładowanie użytkowników...</div>';
    
    try {
        const users = await api('/api/users');
        
        content.innerHTML = `
            <div class="page-header">
                <h1>👥 Użytkownicy</h1>
            </div>
            
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Imię i nazwisko</th>
                            <th>Email</th>
                            <th>Rola</th>
                            <th>Status</th>
                            <th>Data utworzenia</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users.map(u => `
                            <tr>
                                <td><strong>${u.full_name}</strong></td>
                                <td>${u.email}</td>
                                <td>${getRoleLabel(u.role)}</td>
                                <td>${u.is_active ? '<span class="badge badge-success">Aktywny</span>' : '<span class="badge badge-danger">Nieaktywny</span>'}</td>
                                <td>${formatDate(u.created_at)}</td>
                                <td class="actions">
                                    ${state.user.role === 'owner' && u.id !== state.user.id ? `
                                        <button class="btn btn-sm" onclick="editUser(${u.id})">✏️</button>
                                        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">🗑️</button>
                                    ` : '-'}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        content.innerHTML = `<div class="error">Błąd: ${error.message}</div>`;
    }
}

// ==================== MODAL ====================
function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    // Check if logged in
    if (state.token && state.user) {
        showApp();
        loadCategories();
        showDashboard();
    } else {
        showLogin();
    }
    
    // Login form
    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        try {
            await login(form.email.value, form.password.value);
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
    
    // Register form
    document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        try {
            await register(form.email.value, form.password.value, form.fullName.value);
        } catch (error) {
            showToast(error.message, 'error');
        }
    });
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) showView(view);
        });
    });
    
    // Close modal on outside click
    document.getElementById('modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });
    
    // Tab switching for login/register
    document.getElementById('loginTab')?.addEventListener('click', () => {
        document.getElementById('loginTab').classList.add('active');
        document.getElementById('registerTab').classList.remove('active');
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    });
    
    document.getElementById('registerTab')?.addEventListener('click', () => {
        document.getElementById('registerTab').classList.add('active');
        document.getElementById('loginTab').classList.remove('active');
        document.getElementById('registerForm').style.display = 'block';
        document.getElementById('loginForm').style.display = 'none';
    });
});
