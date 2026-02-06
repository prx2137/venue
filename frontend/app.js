/**
 * Music Venue Management System - Frontend Application
 * Version 3.0 with Calendar, Event Archive, and Period Filtering
 */

// ==================== CONFIGURATION ====================

const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : window.location.origin;

const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');

console.log('🔌 API URL:', API_URL);

// ==================== STATE ====================

const state = {
    user: null,
    token: null,
    events: [],
    costs: [],
    revenues: [],
    receipts: [],
    users: [],
    categories: { cost_categories: [], revenue_sources: [] },
    selectedEvent: null,
    chatMessages: [],
    onlineUsers: [],
    ws: null,
    unreadCount: 0,
    // Calendar & filtering
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    filterYear: null,
    filterMonth: null,
    availablePeriods: { periods: [], years: [] }
};

// ==================== UTILITIES ====================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatMoney(amount) {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(amount || 0);
}

function formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pl-PL');
}

function formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pl-PL');
}

function toast(message, type = 'info') {
    const container = $('#toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
}

// ==================== API ====================

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
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Błąd serwera');
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ==================== AUTH ====================

async function login(e) {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value;
    const password = form.password.value;
    
    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        state.token = data.access_token;
        state.user = data.user;
        localStorage.setItem('token', state.token);
        localStorage.setItem('user', JSON.stringify(state.user));
        
        toast(`Witaj, ${state.user.full_name}!`, 'success');
        showApp();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    showLogin();
}

function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        state.token = token;
        state.user = JSON.parse(user);
        showApp();
    } else {
        showLogin();
    }
}

// ==================== VIEWS ====================

function showLogin() {
    $('#login-screen').style.display = 'flex';
    $('#app').style.display = 'none';
}

function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app').style.display = 'block';
    
    // Set user info
    $('#user-name').textContent = state.user.full_name;
    $('#user-role').textContent = getRoleName(state.user.role);
    
    // Show/hide admin features
    const isAdmin = ['owner', 'manager'].includes(state.user.role);
    $$('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
    
    // Initialize
    loadInitialData();
    initWebSocket();
    showSection('dashboard');
}

function showSection(section) {
    $$('.section').forEach(s => s.classList.remove('active'));
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    
    $(`#section-${section}`).classList.add('active');
    $(`.nav-item[data-section="${section}"]`)?.classList.add('active');
    
    // Load section-specific data
    if (section === 'dashboard') loadDashboard();
    if (section === 'events') loadEvents();
    if (section === 'calendar') renderCalendar();
    if (section === 'costs') loadCosts();
    if (section === 'revenues') loadRevenues();
    if (section === 'receipts') loadReceipts();
    if (section === 'reports') loadReports();
    if (section === 'users') loadUsers();
    if (section === 'chat') {
        loadChatHistory();
        state.unreadCount = 0;
        updateChatBadge();
    }
}

function getRoleName(role) {
    const names = { owner: 'Właściciel', manager: 'Manager', worker: 'Pracownik' };
    return names[role] || role;
}

// ==================== DATA LOADING ====================

async function loadInitialData() {
    try {
        state.events = await api('/api/events');
        state.categories = await api('/api/stats/categories');
        state.availablePeriods = await api('/api/stats/available-periods');
        
        if (['owner', 'manager'].includes(state.user.role)) {
            state.users = await api('/api/users');
        }
        
        updateFilterSelectors();
    } catch (error) {
        console.error('Load error:', error);
    }
}

async function loadDashboard() {
    try {
        // Build query params for filtering
        let params = '';
        if (state.filterYear) params += `year=${state.filterYear}&`;
        if (state.filterMonth) params += `month=${state.filterMonth}&`;
        if (params) params = '?' + params.slice(0, -1);
        
        const stats = await api(`/api/stats/dashboard${params}`);
        
        $('#stat-events').textContent = stats.events_count;
        $('#stat-costs').textContent = formatMoney(stats.total_costs);
        $('#stat-revenue').textContent = formatMoney(stats.total_revenue);
        $('#stat-profit').textContent = formatMoney(stats.net_profit);
        
        // Profit color
        const profitEl = $('#stat-profit').closest('.stat-card');
        profitEl.classList.remove('positive', 'negative');
        if (stats.net_profit > 0) profitEl.classList.add('positive');
        if (stats.net_profit < 0) profitEl.classList.add('negative');
        
        // Update filter display
        updateFilterDisplay();
        
        // Recent events (get upcoming and past)
        const allEvents = await api('/api/events');
        const upcoming = allEvents.filter(e => !e.is_past).slice(0, 3);
        const past = allEvents.filter(e => e.is_past).slice(0, 3);
        
        renderRecentEvents(upcoming, past);
    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

function updateFilterSelectors() {
    // Year selector
    const yearSelect = $('#filter-year');
    if (yearSelect) {
        yearSelect.innerHTML = '<option value="">Wszystkie lata</option>';
        state.availablePeriods.years.forEach(year => {
            yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
        });
        // Add current and next year if not in list
        const currentYear = new Date().getFullYear();
        if (!state.availablePeriods.years.includes(currentYear)) {
            yearSelect.innerHTML += `<option value="${currentYear}">${currentYear}</option>`;
        }
        if (!state.availablePeriods.years.includes(currentYear + 1)) {
            yearSelect.innerHTML += `<option value="${currentYear + 1}">${currentYear + 1}</option>`;
        }
    }
    
    // Month selector
    const monthSelect = $('#filter-month');
    if (monthSelect) {
        monthSelect.innerHTML = '<option value="">Wszystkie miesiące</option>';
        const months = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                       'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
        months.forEach((name, idx) => {
            monthSelect.innerHTML += `<option value="${idx + 1}">${name}</option>`;
        });
    }
}

function updateFilterDisplay() {
    const display = $('#current-filter-display');
    if (display) {
        if (state.filterYear || state.filterMonth) {
            const months = ['', 'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                           'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
            let text = '📅 ';
            if (state.filterMonth) text += months[state.filterMonth] + ' ';
            if (state.filterYear) text += state.filterYear;
            display.textContent = text;
            display.style.display = 'inline-block';
        } else {
            display.textContent = '📅 Wszystkie okresy';
            display.style.display = 'inline-block';
        }
    }
}

function applyFilters() {
    const yearSelect = $('#filter-year');
    const monthSelect = $('#filter-month');
    
    state.filterYear = yearSelect?.value ? parseInt(yearSelect.value) : null;
    state.filterMonth = monthSelect?.value ? parseInt(monthSelect.value) : null;
    
    loadDashboard();
    toast('Filtry zastosowane', 'success');
}

function clearFilters() {
    state.filterYear = null;
    state.filterMonth = null;
    
    const yearSelect = $('#filter-year');
    const monthSelect = $('#filter-month');
    if (yearSelect) yearSelect.value = '';
    if (monthSelect) monthSelect.value = '';
    
    loadDashboard();
    toast('Filtry wyczyszczone', 'info');
}

function renderRecentEvents(upcoming, past) {
    const container = $('#recent-events');
    if (!container) return;
    
    let html = '';
    
    if (upcoming.length > 0) {
        html += '<h4>🗓️ Nadchodzące</h4>';
        upcoming.forEach(event => {
            html += `
                <div class="event-item upcoming" onclick="showEventDetail(${event.id})">
                    <span class="event-name">${event.name}</span>
                    <span class="event-date">${formatDate(event.event_date)}</span>
                </div>
            `;
        });
    }
    
    if (past.length > 0) {
        html += '<h4 style="margin-top: 1rem;">📋 Ostatnie</h4>';
        past.forEach(event => {
            html += `
                <div class="event-item past" onclick="showEventDetail(${event.id})">
                    <span class="event-name">${event.name}</span>
                    <span class="event-date">${formatDate(event.event_date)}</span>
                </div>
            `;
        });
    }
    
    if (!html) {
        html = '<p class="empty-state">Brak wydarzeń</p>';
    }
    
    container.innerHTML = html;
}

// ==================== CALENDAR ====================

function renderCalendar() {
    const container = $('#calendar-container');
    if (!container) return;
    
    const year = state.calendarYear;
    const month = state.calendarMonth;
    
    // Get first day of month and number of days
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
    
    const months = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                   'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
    
    let html = `
        <div class="calendar-header">
            <button class="btn btn-sm" onclick="changeCalendarMonth(-1)">◀</button>
            <h3>${months[month - 1]} ${year}</h3>
            <button class="btn btn-sm" onclick="changeCalendarMonth(1)">▶</button>
        </div>
        <div class="calendar-grid">
            <div class="calendar-day-header">Pon</div>
            <div class="calendar-day-header">Wt</div>
            <div class="calendar-day-header">Śr</div>
            <div class="calendar-day-header">Czw</div>
            <div class="calendar-day-header">Pt</div>
            <div class="calendar-day-header">Sob</div>
            <div class="calendar-day-header">Nie</div>
    `;
    
    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    // Days of month
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const isPast = new Date(dateStr) < new Date(todayStr);
        
        // Find events for this day
        const dayEvents = state.events.filter(e => {
            const eventDate = new Date(e.event_date);
            return eventDate.getFullYear() === year && 
                   eventDate.getMonth() === month - 1 && 
                   eventDate.getDate() === day;
        });
        
        let dayClass = 'calendar-day';
        if (isToday) dayClass += ' today';
        if (isPast) dayClass += ' past';
        if (dayEvents.length > 0) dayClass += ' has-events';
        
        html += `<div class="${dayClass}" onclick="showDayEvents('${dateStr}')">
            <span class="day-number">${day}</span>
            ${dayEvents.length > 0 ? `<span class="event-count">${dayEvents.length}</span>` : ''}
            <div class="day-events">
                ${dayEvents.slice(0, 2).map(e => `<div class="mini-event">${e.name}</div>`).join('')}
                ${dayEvents.length > 2 ? `<div class="more-events">+${dayEvents.length - 2}</div>` : ''}
            </div>
        </div>`;
    }
    
    html += '</div>';
    
    // Quick add button
    html += `
        <div class="calendar-actions">
            <button class="btn btn-primary" onclick="showEventModal()">
                ➕ Dodaj wydarzenie
            </button>
        </div>
    `;
    
    container.innerHTML = html;
}

function changeCalendarMonth(delta) {
    state.calendarMonth += delta;
    
    if (state.calendarMonth > 12) {
        state.calendarMonth = 1;
        state.calendarYear++;
    } else if (state.calendarMonth < 1) {
        state.calendarMonth = 12;
        state.calendarYear--;
    }
    
    // Reload events for new month range
    loadEvents().then(() => renderCalendar());
}

function showDayEvents(dateStr) {
    const dayEvents = state.events.filter(e => {
        const eventDate = new Date(e.event_date).toISOString().split('T')[0];
        return eventDate === dateStr;
    });
    
    if (dayEvents.length === 0) {
        // Show add event modal with pre-filled date
        showEventModal(null, dateStr);
        return;
    }
    
    if (dayEvents.length === 1) {
        showEventDetail(dayEvents[0].id);
        return;
    }
    
    // Show list of events
    let html = `
        <h3>Wydarzenia ${formatDate(dateStr)}</h3>
        <div class="day-events-list">
    `;
    
    dayEvents.forEach(event => {
        html += `
            <div class="event-list-item" onclick="showEventDetail(${event.id}); hideModal();">
                <strong>${event.name}</strong>
                <span>${event.description || ''}</span>
            </div>
        `;
    });
    
    html += `
        </div>
        <button class="btn btn-primary" onclick="showEventModal(null, '${dateStr}')">
            ➕ Dodaj wydarzenie
        </button>
    `;
    
    showModal('Wydarzenia', html);
}

// ==================== EVENTS ====================

async function loadEvents() {
    try {
        state.events = await api('/api/events');
        renderEvents();
    } catch (error) {
        console.error('Events error:', error);
    }
}

function renderEvents() {
    const container = $('#events-list');
    if (!container) return;
    
    // Separate upcoming and past
    const upcoming = state.events.filter(e => !e.is_past);
    const past = state.events.filter(e => e.is_past);
    
    let html = '';
    
    // Event filter tabs
    html += `
        <div class="event-tabs">
            <button class="tab-btn active" onclick="filterEventsList('all')">Wszystkie (${state.events.length})</button>
            <button class="tab-btn" onclick="filterEventsList('upcoming')">Nadchodzące (${upcoming.length})</button>
            <button class="tab-btn" onclick="filterEventsList('past')">Archiwum (${past.length})</button>
        </div>
    `;
    
    html += '<div class="events-grid" id="events-grid">';
    
    if (state.events.length === 0) {
        html += '<p class="empty-state">Brak wydarzeń. Dodaj pierwsze!</p>';
    } else {
        state.events.forEach(event => {
            const isPast = event.is_past;
            html += `
                <div class="event-card ${isPast ? 'past' : 'upcoming'}" data-type="${isPast ? 'past' : 'upcoming'}">
                    <div class="event-card-header">
                        <h4>${event.name}</h4>
                        <span class="event-badge ${isPast ? 'past' : 'upcoming'}">
                            ${isPast ? '📋 Zakończone' : '🗓️ Nadchodzące'}
                        </span>
                    </div>
                    <p class="event-date">📅 ${formatDateTime(event.event_date)}</p>
                    <p class="event-desc">${event.description || 'Brak opisu'}</p>
                    <div class="event-meta">
                        <span>👥 ${event.venue_capacity} osób</span>
                        <span>🎫 ${formatMoney(event.ticket_price)}</span>
                    </div>
                    <div class="event-actions">
                        <button class="btn btn-sm" onclick="showEventDetail(${event.id})">Szczegóły</button>
                        <button class="btn btn-sm" onclick="showEventModal(${event.id})">Edytuj</button>
                        <button class="btn btn-sm btn-danger admin-only" onclick="deleteEvent(${event.id})">🗑️</button>
                    </div>
                </div>
            `;
        });
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // Show/hide admin buttons
    const isAdmin = ['owner', 'manager'].includes(state.user?.role);
    container.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
}

function filterEventsList(type) {
    // Update tab buttons
    $$('.event-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    $(`.event-tabs .tab-btn[onclick*="${type}"]`)?.classList.add('active');
    
    // Filter cards
    $$('#events-grid .event-card').forEach(card => {
        if (type === 'all') {
            card.style.display = '';
        } else {
            card.style.display = card.dataset.type === type ? '' : 'none';
        }
    });
}

async function showEventDetail(eventId) {
    try {
        const event = await api(`/api/events/${eventId}`);
        const costs = await api(`/api/costs/event/${eventId}`);
        const revenues = await api(`/api/revenue/event/${eventId}`);
        
        const totalCosts = costs.reduce((sum, c) => sum + c.amount, 0);
        const totalRevenue = revenues.reduce((sum, r) => sum + r.amount, 0);
        const profit = totalRevenue - totalCosts;
        
        const html = `
            <div class="event-detail">
                <div class="event-detail-header">
                    <h3>${event.name}</h3>
                    <span class="event-badge ${event.is_past ? 'past' : 'upcoming'}">
                        ${event.is_past ? '📋 Zakończone' : '🗓️ Nadchodzące'}
                    </span>
                </div>
                <p><strong>📅 Data:</strong> ${formatDateTime(event.event_date)}</p>
                <p><strong>📝 Opis:</strong> ${event.description || 'Brak'}</p>
                <p><strong>👥 Pojemność:</strong> ${event.venue_capacity} osób</p>
                <p><strong>🎫 Cena biletu:</strong> ${formatMoney(event.ticket_price)}</p>
                
                <div class="event-summary">
                    <div class="summary-item">
                        <span>Koszty</span>
                        <strong class="negative">${formatMoney(totalCosts)}</strong>
                    </div>
                    <div class="summary-item">
                        <span>Przychody</span>
                        <strong class="positive">${formatMoney(totalRevenue)}</strong>
                    </div>
                    <div class="summary-item">
                        <span>Zysk</span>
                        <strong class="${profit >= 0 ? 'positive' : 'negative'}">${formatMoney(profit)}</strong>
                    </div>
                </div>
                
                <div class="event-detail-actions">
                    <button class="btn" onclick="showSection('costs'); selectEventForCosts(${eventId})">
                        💸 Zarządzaj kosztami
                    </button>
                    <button class="btn" onclick="showSection('revenues'); selectEventForRevenues(${eventId})">
                        💰 Zarządzaj przychodami
                    </button>
                </div>
            </div>
        `;
        
        showModal('Szczegóły wydarzenia', html);
    } catch (error) {
        toast(error.message, 'error');
    }
}

function showEventModal(eventId = null, prefilledDate = null) {
    const event = eventId ? state.events.find(e => e.id === eventId) : null;
    const isEdit = !!event;
    
    // Default date: prefilled or tomorrow
    let defaultDate = prefilledDate || new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    if (event) {
        defaultDate = new Date(event.event_date).toISOString().slice(0, 16);
    }
    
    const html = `
        <form id="event-form">
            <div class="form-group">
                <label>Nazwa wydarzenia *</label>
                <input type="text" name="name" value="${event?.name || ''}" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description">${event?.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Data i godzina *</label>
                <input type="datetime-local" name="event_date" value="${defaultDate}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Pojemność</label>
                    <input type="number" name="venue_capacity" value="${event?.venue_capacity || 100}" min="0">
                </div>
                <div class="form-group">
                    <label>Cena biletu (PLN)</label>
                    <input type="number" name="ticket_price" value="${event?.ticket_price || 0}" min="0" step="0.01">
                </div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">
                ${isEdit ? '💾 Zapisz zmiany' : '➕ Dodaj wydarzenie'}
            </button>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj wydarzenie' : 'Nowe wydarzenie', html);
    
    $('#event-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            description: formData.get('description'),
            event_date: formData.get('event_date'),
            venue_capacity: parseInt(formData.get('venue_capacity')) || 0,
            ticket_price: parseFloat(formData.get('ticket_price')) || 0
        };
        
        try {
            if (isEdit) {
                await api(`/api/events/${event.id}`, { method: 'PUT', body: JSON.stringify(data) });
                toast('Wydarzenie zaktualizowane!', 'success');
            } else {
                await api('/api/events', { method: 'POST', body: JSON.stringify(data) });
                toast('Wydarzenie dodane!', 'success');
            }
            hideModal();
            await loadEvents();
            await loadInitialData(); // Refresh periods
            renderCalendar();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

async function deleteEvent(id) {
    if (!confirm('Czy na pewno usunąć to wydarzenie? Wszystkie powiązane koszty i przychody również zostaną usunięte.')) return;
    
    try {
        await api(`/api/events/${id}`, { method: 'DELETE' });
        toast('Wydarzenie usunięte', 'success');
        await loadEvents();
        await loadInitialData();
        renderCalendar();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== COSTS ====================

async function loadCosts() {
    try {
        // Load costs for selected event or all
        renderCostsSection();
    } catch (error) {
        console.error('Costs error:', error);
    }
}

function renderCostsSection() {
    const container = $('#costs-content');
    if (!container) return;
    
    let html = `
        <div class="section-header">
            <h3>💸 Koszty</h3>
            <button class="btn btn-primary" onclick="showCostModal()">➕ Dodaj koszt</button>
        </div>
        
        <div class="form-group">
            <label>Wybierz wydarzenie</label>
            <select id="costs-event-select" onchange="loadCostsForEvent(this.value)">
                <option value="">-- Wybierz wydarzenie --</option>
                ${state.events.map(e => `<option value="${e.id}">${e.name} (${formatDate(e.event_date)})</option>`).join('')}
            </select>
        </div>
        
        <div id="costs-list"></div>
    `;
    
    container.innerHTML = html;
}

function selectEventForCosts(eventId) {
    hideModal();
    const select = $('#costs-event-select');
    if (select) {
        select.value = eventId;
        loadCostsForEvent(eventId);
    }
}

async function loadCostsForEvent(eventId) {
    if (!eventId) {
        $('#costs-list').innerHTML = '<p class="empty-state">Wybierz wydarzenie</p>';
        return;
    }
    
    try {
        state.costs = await api(`/api/costs/event/${eventId}`);
        renderCostsList();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function renderCostsList() {
    const container = $('#costs-list');
    if (!container) return;
    
    if (state.costs.length === 0) {
        container.innerHTML = '<p class="empty-state">Brak kosztów dla tego wydarzenia</p>';
        return;
    }
    
    const total = state.costs.reduce((sum, c) => sum + c.amount, 0);
    
    let html = `
        <div class="costs-summary">
            <strong>Suma kosztów: ${formatMoney(total)}</strong>
        </div>
        <div class="items-list">
    `;
    
    state.costs.forEach(cost => {
        html += `
            <div class="list-item">
                <div class="item-info">
                    <span class="item-category">${getCategoryName(cost.category)}</span>
                    <span class="item-desc">${cost.description || '-'}</span>
                </div>
                <div class="item-amount negative">${formatMoney(cost.amount)}</div>
                <div class="item-actions">
                    <button class="btn btn-sm" onclick="showCostModal(${cost.id})">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCost(${cost.id})">🗑️</button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function getCategoryName(category) {
    const names = {
        bar_alcohol: '🍺 Alkohol',
        bar_beverages: '🥤 Napoje',
        bar_food: '🍕 Jedzenie',
        bar_supplies: '📦 Zaopatrzenie baru',
        artist_fee: '🎤 Honorarium artysty',
        sound_engineer: '🔊 Realizator dźwięku',
        lighting: '💡 Oświetlenie',
        staff_wages: '👷 Wynagrodzenia',
        security: '🛡️ Ochrona',
        cleaning: '🧹 Sprzątanie',
        utilities: '⚡ Media',
        rent: '🏠 Wynajem',
        equipment: '🎛️ Sprzęt',
        marketing: '📢 Marketing',
        other: '📌 Inne'
    };
    return names[category] || category;
}

function showCostModal(costId = null) {
    const eventId = $('#costs-event-select')?.value;
    if (!eventId && !costId) {
        toast('Najpierw wybierz wydarzenie', 'warning');
        return;
    }
    
    const cost = costId ? state.costs.find(c => c.id === costId) : null;
    const isEdit = !!cost;
    
    const html = `
        <form id="cost-form">
            <div class="form-group">
                <label>Kategoria *</label>
                <select name="category" required>
                    ${state.categories.cost_categories.map(cat => 
                        `<option value="${cat}" ${cost?.category === cat ? 'selected' : ''}>${getCategoryName(cat)}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" value="${cost?.amount || ''}" min="0.01" step="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <input type="text" name="description" value="${cost?.description || ''}">
            </div>
            <button type="submit" class="btn btn-primary btn-block">
                ${isEdit ? '💾 Zapisz' : '➕ Dodaj'}
            </button>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj koszt' : 'Nowy koszt', html);
    
    $('#cost-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            event_id: parseInt(eventId || cost.event_id),
            category: formData.get('category'),
            amount: parseFloat(formData.get('amount')),
            description: formData.get('description')
        };
        
        try {
            if (isEdit) {
                await api(`/api/costs/${cost.id}`, { method: 'PUT', body: JSON.stringify(data) });
            } else {
                await api('/api/costs', { method: 'POST', body: JSON.stringify(data) });
            }
            toast('Koszt zapisany!', 'success');
            hideModal();
            loadCostsForEvent(data.event_id);
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

async function deleteCost(id) {
    if (!confirm('Usunąć ten koszt?')) return;
    
    try {
        await api(`/api/costs/${id}`, { method: 'DELETE' });
        toast('Koszt usunięty', 'success');
        const eventId = $('#costs-event-select')?.value;
        if (eventId) loadCostsForEvent(eventId);
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== REVENUES ====================

async function loadRevenues() {
    renderRevenuesSection();
}

function renderRevenuesSection() {
    const container = $('#revenues-content');
    if (!container) return;
    
    let html = `
        <div class="section-header">
            <h3>💰 Przychody</h3>
            <button class="btn btn-primary" onclick="showRevenueModal()">➕ Dodaj przychód</button>
        </div>
        
        <div class="form-group">
            <label>Wybierz wydarzenie</label>
            <select id="revenues-event-select" onchange="loadRevenuesForEvent(this.value)">
                <option value="">-- Wybierz wydarzenie --</option>
                ${state.events.map(e => `<option value="${e.id}">${e.name} (${formatDate(e.event_date)})</option>`).join('')}
            </select>
        </div>
        
        <div id="revenues-list"></div>
    `;
    
    container.innerHTML = html;
}

function selectEventForRevenues(eventId) {
    hideModal();
    const select = $('#revenues-event-select');
    if (select) {
        select.value = eventId;
        loadRevenuesForEvent(eventId);
    }
}

async function loadRevenuesForEvent(eventId) {
    if (!eventId) {
        $('#revenues-list').innerHTML = '<p class="empty-state">Wybierz wydarzenie</p>';
        return;
    }
    
    try {
        state.revenues = await api(`/api/revenue/event/${eventId}`);
        renderRevenuesList();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function renderRevenuesList() {
    const container = $('#revenues-list');
    if (!container) return;
    
    if (state.revenues.length === 0) {
        container.innerHTML = '<p class="empty-state">Brak przychodów dla tego wydarzenia</p>';
        return;
    }
    
    const total = state.revenues.reduce((sum, r) => sum + r.amount, 0);
    
    let html = `
        <div class="revenues-summary">
            <strong>Suma przychodów: ${formatMoney(total)}</strong>
        </div>
        <div class="items-list">
    `;
    
    state.revenues.forEach(revenue => {
        html += `
            <div class="list-item">
                <div class="item-info">
                    <span class="item-category">${getSourceName(revenue.source)}</span>
                    <span class="item-desc">${revenue.description || '-'}</span>
                </div>
                <div class="item-amount positive">${formatMoney(revenue.amount)}</div>
                <div class="item-actions">
                    <button class="btn btn-sm" onclick="showRevenueModal(${revenue.id})">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteRevenue(${revenue.id})">🗑️</button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function getSourceName(source) {
    const names = {
        box_office: '🎫 Bilety',
        bar_sales: '🍺 Sprzedaż barowa',
        merchandise: '👕 Merchandise',
        sponsorship: '🤝 Sponsoring',
        other: '📌 Inne'
    };
    return names[source] || source;
}

function showRevenueModal(revenueId = null) {
    const eventId = $('#revenues-event-select')?.value;
    if (!eventId && !revenueId) {
        toast('Najpierw wybierz wydarzenie', 'warning');
        return;
    }
    
    const revenue = revenueId ? state.revenues.find(r => r.id === revenueId) : null;
    const isEdit = !!revenue;
    
    const html = `
        <form id="revenue-form">
            <div class="form-group">
                <label>Źródło *</label>
                <select name="source" required>
                    ${state.categories.revenue_sources.map(src => 
                        `<option value="${src}" ${revenue?.source === src ? 'selected' : ''}>${getSourceName(src)}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" value="${revenue?.amount || ''}" min="0.01" step="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <input type="text" name="description" value="${revenue?.description || ''}">
            </div>
            <button type="submit" class="btn btn-primary btn-block">
                ${isEdit ? '💾 Zapisz' : '➕ Dodaj'}
            </button>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj przychód' : 'Nowy przychód', html);
    
    $('#revenue-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            event_id: parseInt(eventId || revenue.event_id),
            source: formData.get('source'),
            amount: parseFloat(formData.get('amount')),
            description: formData.get('description')
        };
        
        try {
            if (isEdit) {
                await api(`/api/revenue/${revenue.id}`, { method: 'PUT', body: JSON.stringify(data) });
            } else {
                await api('/api/revenue', { method: 'POST', body: JSON.stringify(data) });
            }
            toast('Przychód zapisany!', 'success');
            hideModal();
            loadRevenuesForEvent(data.event_id);
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

async function deleteRevenue(id) {
    if (!confirm('Usunąć ten przychód?')) return;
    
    try {
        await api(`/api/revenue/${id}`, { method: 'DELETE' });
        toast('Przychód usunięty', 'success');
        const eventId = $('#revenues-event-select')?.value;
        if (eventId) loadRevenuesForEvent(eventId);
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== RECEIPTS ====================

async function loadReceipts() {
    try {
        state.receipts = await api('/api/receipts');
        renderReceipts();
    } catch (error) {
        console.error('Receipts error:', error);
    }
}

function renderReceipts() {
    const container = $('#receipts-list');
    if (!container) return;
    
    if (state.receipts.length === 0) {
        container.innerHTML = '<p class="empty-state">Brak paragonów</p>';
        return;
    }
    
    let html = '<div class="receipts-grid">';
    
    state.receipts.forEach(receipt => {
        const canViewImage = ['owner', 'manager'].includes(state.user?.role);
        
        html += `
            <div class="receipt-card">
                <div class="receipt-header">
                    <span class="store-name">${receipt.store_name || 'Nieznany sklep'}</span>
                    ${receipt.has_image ? '<span class="has-image">📷</span>' : ''}
                </div>
                <div class="receipt-info">
                    <p>📅 ${formatDate(receipt.receipt_date)}</p>
                    <p class="receipt-amount">${formatMoney(receipt.total_amount)}</p>
                </div>
                <div class="receipt-meta">
                    <span>Dodał: ${receipt.uploader_name || 'Nieznany'}</span>
                </div>
                <div class="receipt-actions">
                    <button class="btn btn-sm" onclick="showReceiptDetail(${receipt.id})">Szczegóły</button>
                    ${canViewImage && receipt.has_image ? `<button class="btn btn-sm" onclick="showReceiptImage(${receipt.id})">🖼️ Zdjęcie</button>` : ''}
                    <button class="btn btn-sm btn-danger admin-only" onclick="deleteReceipt(${receipt.id})">🗑️</button>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
    
    // Show/hide admin buttons
    const isAdmin = ['owner', 'manager'].includes(state.user?.role);
    container.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
}

function showReceiptUploadModal() {
    const html = `
        <div class="receipt-upload-tabs">
            <button class="tab-btn active" onclick="switchReceiptTab('image')">📷 Zdjęcie</button>
            <button class="tab-btn" onclick="switchReceiptTab('text')">📝 Tekst</button>
        </div>
        
        <div class="receipt-tab" id="tab-image">
            <form id="receipt-image-form">
                <div class="form-group">
                    <label>Zdjęcie paragonu</label>
                    <input type="file" name="image" accept="image/*" capture="environment" required
                           onchange="previewReceiptImage(this)">
                    <small>Zrób zdjęcie lub wybierz z galerii</small>
                </div>
                <div id="image-preview" class="image-preview"></div>
                <button type="submit" class="btn btn-primary btn-block">
                    📤 Prześlij zdjęcie
                </button>
            </form>
        </div>
        
        <div class="receipt-tab" id="tab-text" style="display: none;">
            <form id="receipt-text-form">
                <div class="form-group">
                    <label>Tekst paragonu (OCR)</label>
                    <textarea name="ocr_text" rows="10" placeholder="Wklej tekst z paragonu..." required></textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-block">
                    📤 Prześlij tekst
                </button>
            </form>
        </div>
    `;
    
    showModal('Dodaj paragon', html);
    initReceiptForms();
}

function switchReceiptTab(tab) {
    $$('.receipt-upload-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    $$('.receipt-tab').forEach(t => t.style.display = 'none');
    
    $(`.receipt-upload-tabs .tab-btn[onclick*="${tab}"]`).classList.add('active');
    $(`#tab-${tab}`).style.display = 'block';
}

function previewReceiptImage(input) {
    const preview = $('#image-preview');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<img src="${e.target.result}" alt="Podgląd">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function initReceiptForms() {
    // Image upload form
    $('#receipt-image-form').onsubmit = async (e) => {
        e.preventDefault();
        const fileInput = e.target.querySelector('input[type="file"]');
        const file = fileInput.files[0];
        
        if (!file) {
            toast('Wybierz zdjęcie', 'warning');
            return;
        }
        
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '⏳ Przetwarzanie OCR...';
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch(`${API_URL}/api/receipts/upload-image`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${state.token}`
                },
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Błąd przesyłania');
            }
            
            const result = await response.json();
            
            let message = 'Paragon dodany!';
            if (result.store_name) message += ` Sklep: ${result.store_name}`;
            if (result.total_amount) message += ` | Kwota: ${formatMoney(result.total_amount)}`;
            
            toast(message, 'success');
            hideModal();
            await loadReceipts();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '📤 Prześlij zdjęcie';
        }
    };
    
    // Text upload form
    $('#receipt-text-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        try {
            const result = await api('/api/receipts/upload', {
                method: 'POST',
                body: JSON.stringify({ ocr_text: formData.get('ocr_text') })
            });
            
            toast(`Paragon dodany! Rozpoznano sklep: ${result.store_name || 'Nieznany'}`, 'success');
            hideModal();
            await loadReceipts();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

async function showReceiptDetail(receiptId) {
    try {
        const receipt = await api(`/api/receipts/${receiptId}`);
        
        const html = `
            <div class="receipt-detail">
                <p><strong>🏪 Sklep:</strong> ${receipt.store_name || 'Nieznany'}</p>
                <p><strong>📅 Data:</strong> ${formatDate(receipt.receipt_date)}</p>
                <p><strong>💰 Kwota:</strong> ${formatMoney(receipt.total_amount)}</p>
                <p><strong>👤 Dodał:</strong> ${receipt.uploader_name || 'Nieznany'}</p>
                
                <h4>Rozpoznane produkty:</h4>
                <div class="parsed-items">
                    ${receipt.parsed_items && receipt.parsed_items.length > 0 
                        ? receipt.parsed_items.map(item => `
                            <div class="parsed-item">
                                <span>${item.name}</span>
                                <span>${formatMoney(item.price)}</span>
                            </div>
                        `).join('')
                        : '<p class="empty-state">Brak rozpoznanych produktów</p>'
                    }
                </div>
                
                <h4>Tekst OCR:</h4>
                <pre class="ocr-text">${receipt.ocr_text || 'Brak'}</pre>
            </div>
        `;
        
        showModal('Szczegóły paragonu', html);
    } catch (error) {
        toast(error.message, 'error');
    }
}

function showReceiptImage(receiptId) {
    const imageUrl = `${API_URL}/api/receipts/${receiptId}/image?token=${state.token}`;
    
    const html = `
        <div class="receipt-image-view">
            <img src="${imageUrl}" alt="Paragon" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><text x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22>Błąd ładowania</text></svg>'">
        </div>
    `;
    
    showModal('Zdjęcie paragonu', html);
}

async function deleteReceipt(id) {
    if (!confirm('Usunąć ten paragon?')) return;
    
    try {
        await api(`/api/receipts/${id}`, { method: 'DELETE' });
        toast('Paragon usunięty', 'success');
        await loadReceipts();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== REPORTS ====================

async function loadReports() {
    const container = $('#reports-content');
    if (!container) return;
    
    let html = `
        <div class="form-group">
            <label>Wybierz wydarzenie</label>
            <select id="report-event-select" onchange="generateReport(this.value)">
                <option value="">-- Wybierz wydarzenie --</option>
                ${state.events.map(e => `<option value="${e.id}">${e.name} (${formatDate(e.event_date)})</option>`).join('')}
            </select>
        </div>
        <div id="report-content"></div>
    `;
    
    container.innerHTML = html;
}

async function generateReport(eventId) {
    if (!eventId) {
        $('#report-content').innerHTML = '';
        return;
    }
    
    try {
        const report = await api(`/api/reports/event/${eventId}`);
        
        let html = `
            <div class="report">
                <h3>${report.event_name}</h3>
                <p class="report-date">📅 ${formatDate(report.event_date)}</p>
                
                <div class="report-summary">
                    <div class="summary-card">
                        <span>Koszty</span>
                        <strong class="negative">${formatMoney(report.total_costs)}</strong>
                    </div>
                    <div class="summary-card">
                        <span>Przychody</span>
                        <strong class="positive">${formatMoney(report.total_revenue)}</strong>
                    </div>
                    <div class="summary-card ${report.net_profit >= 0 ? 'profit' : 'loss'}">
                        <span>Zysk netto</span>
                        <strong>${formatMoney(report.net_profit)}</strong>
                    </div>
                </div>
                
                <div class="report-breakdown">
                    <div class="breakdown-section">
                        <h4>💸 Koszty według kategorii</h4>
                        ${Object.entries(report.costs_by_category || {}).map(([cat, amount]) => `
                            <div class="breakdown-item">
                                <span>${getCategoryName(cat)}</span>
                                <span>${formatMoney(amount)}</span>
                            </div>
                        `).join('') || '<p class="empty-state">Brak kosztów</p>'}
                    </div>
                    
                    <div class="breakdown-section">
                        <h4>💰 Przychody według źródła</h4>
                        ${Object.entries(report.revenue_by_source || {}).map(([src, amount]) => `
                            <div class="breakdown-item">
                                <span>${getSourceName(src)}</span>
                                <span>${formatMoney(amount)}</span>
                            </div>
                        `).join('') || '<p class="empty-state">Brak przychodów</p>'}
                    </div>
                </div>
            </div>
        `;
        
        $('#report-content').innerHTML = html;
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== USERS ====================

async function loadUsers() {
    if (!['owner', 'manager'].includes(state.user?.role)) return;
    
    try {
        state.users = await api('/api/users');
        renderUsers();
    } catch (error) {
        console.error('Users error:', error);
    }
}

function renderUsers() {
    const container = $('#users-list');
    if (!container) return;
    
    let html = '<div class="users-grid">';
    
    state.users.forEach(user => {
        const roleClass = user.role === 'owner' ? 'owner' : user.role === 'manager' ? 'manager' : 'worker';
        const canEdit = state.user.role === 'owner' || (state.user.role === 'manager' && user.role === 'worker');
        const isSelf = user.id === state.user.id;
        
        html += `
            <div class="user-card ${roleClass} ${!user.is_active ? 'inactive' : ''}">
                <div class="user-avatar">${user.full_name.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <strong>${user.full_name}</strong>
                    <span class="user-email">${user.email}</span>
                    <span class="user-role-badge">${getRoleName(user.role)}</span>
                    ${!user.is_active ? '<span class="inactive-badge">Nieaktywny</span>' : ''}
                </div>
                ${canEdit && !isSelf ? `
                    <div class="user-actions">
                        <button class="btn btn-sm" onclick="showUserModal(${user.id})">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">🗑️</button>
                    </div>
                ` : ''}
                ${isSelf ? '<span class="self-badge">To Ty</span>' : ''}
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function showUserModal(userId = null) {
    const user = userId ? state.users.find(u => u.id === userId) : null;
    const isEdit = !!user;
    
    // Determine which roles can be assigned
    const canAssignOwner = state.user.role === 'owner';
    const canAssignManager = state.user.role === 'owner';
    
    const html = `
        <form id="user-form">
            <div class="form-group">
                <label>Imię i nazwisko *</label>
                <input type="text" name="full_name" value="${user?.full_name || ''}" required>
            </div>
            <div class="form-group">
                <label>Email *</label>
                <input type="email" name="email" value="${user?.email || ''}" required>
            </div>
            <div class="form-group">
                <label>${isEdit ? 'Nowe hasło (opcjonalnie)' : 'Hasło *'}</label>
                <input type="password" name="password" ${isEdit ? '' : 'required'} minlength="6">
            </div>
            <div class="form-group">
                <label>Rola *</label>
                <select name="role" required>
                    <option value="worker" ${user?.role === 'worker' ? 'selected' : ''}>Pracownik</option>
                    ${canAssignManager ? `<option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Manager</option>` : ''}
                    ${canAssignOwner ? `<option value="owner" ${user?.role === 'owner' ? 'selected' : ''}>Właściciel</option>` : ''}
                </select>
            </div>
            ${isEdit ? `
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="is_active" ${user?.is_active ? 'checked' : ''}>
                        Aktywny
                    </label>
                </div>
            ` : ''}
            <button type="submit" class="btn btn-primary btn-block">
                ${isEdit ? '💾 Zapisz' : '➕ Dodaj użytkownika'}
            </button>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj użytkownika' : 'Nowy użytkownik', html);
    
    $('#user-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        const data = {
            full_name: formData.get('full_name'),
            email: formData.get('email'),
            role: formData.get('role')
        };
        
        if (formData.get('password')) {
            data.password = formData.get('password');
        }
        
        if (isEdit) {
            data.is_active = formData.get('is_active') === 'on';
        }
        
        try {
            if (isEdit) {
                await api(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify(data) });
            } else {
                await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
            }
            toast('Użytkownik zapisany!', 'success');
            hideModal();
            await loadUsers();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

async function deleteUser(id) {
    if (!confirm('Czy na pewno usunąć tego użytkownika?')) return;
    
    try {
        await api(`/api/users/${id}`, { method: 'DELETE' });
        toast('Użytkownik usunięty', 'success');
        await loadUsers();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== CHAT ====================

function initWebSocket() {
    if (state.ws) {
        state.ws.close();
    }
    
    const wsUrl = `${WS_URL}/ws/chat/${state.token}`;
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onopen = () => {
        console.log('🔌 WebSocket connected');
    };
    
    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    state.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        // Reconnect after 3 seconds
        setTimeout(() => {
            if (state.token) initWebSocket();
        }, 3000);
    };
    
    state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'message':
            addChatMessage(data);
            if (!$('#section-chat').classList.contains('active')) {
                state.unreadCount++;
                updateChatBadge();
                toast(`💬 ${data.sender_name}: ${data.content.substring(0, 50)}...`, 'info');
            }
            break;
        case 'user_status':
            updateOnlineStatus(data);
            break;
        case 'typing':
            showTypingIndicator(data);
            break;
    }
}

function addChatMessage(msg) {
    state.chatMessages.push(msg);
    
    const container = $('#chat-messages');
    if (!container) return;
    
    const isOwn = msg.sender_id === state.user.id;
    const roleClass = msg.sender_role === 'owner' ? 'owner' : msg.sender_role === 'manager' ? 'manager' : 'worker';
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : ''} ${roleClass}`;
    messageEl.innerHTML = `
        <div class="message-header">
            <span class="sender-name">${msg.sender_name}</span>
            <span class="message-time">${formatTime(msg.created_at)}</span>
        </div>
        <div class="message-content">${escapeHtml(msg.content)}</div>
    `;
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateOnlineStatus(data) {
    if (data.status === 'online') {
        if (!state.onlineUsers.find(u => u.id === data.user_id)) {
            state.onlineUsers.push({ id: data.user_id, name: data.user_name });
        }
    } else {
        state.onlineUsers = state.onlineUsers.filter(u => u.id !== data.user_id);
    }
    renderOnlineUsers();
}

function renderOnlineUsers() {
    const container = $('#online-users');
    if (!container) return;
    
    container.innerHTML = state.onlineUsers.map(u => `
        <span class="online-user">${u.name}</span>
    `).join('');
}

function showTypingIndicator(data) {
    const indicator = $('#typing-indicator');
    if (!indicator) return;
    
    if (data.is_typing && data.user_id !== state.user.id) {
        indicator.textContent = `${data.user_name} pisze...`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

function updateChatBadge() {
    const badge = $('#chat-badge');
    if (badge) {
        badge.textContent = state.unreadCount;
        badge.style.display = state.unreadCount > 0 ? 'inline-block' : 'none';
    }
}

async function loadChatHistory() {
    try {
        const data = await api('/api/chat/history?limit=100');
        state.chatMessages = data.messages || [];
        
        const container = $('#chat-messages');
        if (container) {
            container.innerHTML = '';
            state.chatMessages.forEach(msg => addChatMessage(msg));
        }
    } catch (error) {
        console.error('Chat history error:', error);
    }
}

function sendChatMessage() {
    const input = $('#chat-input');
    const content = input.value.trim();
    
    if (!content || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    
    state.ws.send(JSON.stringify({
        type: 'message',
        content: content
    }));
    
    input.value = '';
}

let typingTimeout;
function handleChatTyping() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    
    state.ws.send(JSON.stringify({
        type: 'typing',
        is_typing: true
    }));
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        state.ws.send(JSON.stringify({
            type: 'typing',
            is_typing: false
        }));
    }, 2000);
}

// ==================== MODAL ====================

function showModal(title, content) {
    let modal = $('#modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-backdrop" onclick="hideModal()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="modal-title"></h3>
                    <button class="modal-close" onclick="hideModal()">×</button>
                </div>
                <div class="modal-body" id="modal-body"></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = content;
    modal.classList.add('active');
}

function hideModal() {
    const modal = $('#modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    // Login form
    $('#login-form')?.addEventListener('submit', login);
    
    // Navigation
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            if (section) showSection(section);
        });
    });
    
    // Logout
    $('#logout-btn')?.addEventListener('click', logout);
    
    // Chat input
    $('#chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
        handleChatTyping();
    });
    
    $('#chat-send')?.addEventListener('click', sendChatMessage);
    
    // Check auth
    checkAuth();
});

// Global functions for onclick handlers
window.showSection = showSection;
window.showEventModal = showEventModal;
window.showEventDetail = showEventDetail;
window.deleteEvent = deleteEvent;
window.showCostModal = showCostModal;
window.deleteCost = deleteCost;
window.showRevenueModal = showRevenueModal;
window.deleteRevenue = deleteRevenue;
window.showReceiptUploadModal = showReceiptUploadModal;
window.showReceiptDetail = showReceiptDetail;
window.showReceiptImage = showReceiptImage;
window.deleteReceipt = deleteReceipt;
window.switchReceiptTab = switchReceiptTab;
window.previewReceiptImage = previewReceiptImage;
window.showUserModal = showUserModal;
window.deleteUser = deleteUser;
window.generateReport = generateReport;
window.hideModal = hideModal;
window.loadCostsForEvent = loadCostsForEvent;
window.loadRevenuesForEvent = loadRevenuesForEvent;
window.selectEventForCosts = selectEventForCosts;
window.selectEventForRevenues = selectEventForRevenues;
window.renderCalendar = renderCalendar;
window.changeCalendarMonth = changeCalendarMonth;
window.showDayEvents = showDayEvents;
window.filterEventsList = filterEventsList;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
