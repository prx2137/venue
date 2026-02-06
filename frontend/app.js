/**
 * Music Venue Management System - Frontend Application
 * Version 4.0 - Dark Theme, Private Chat, Notifications
 */

// ============== CONFIGURATION ==============
const API_URL = window.location.origin;
const WS_URL = API_URL.replace('http', 'ws');

// Job positions
const JOB_POSITIONS = [
    'Barman',
    'Barback',
    'Świetlik',
    'Ochrona',
    'Akustyk',
    'Promotor',
    'Menedżer',
    'Szatnia',
    'Bramka'
];

// ============== STATE ==============
let currentUser = null;
let authToken = null;
let currentView = 'dashboard';
let websocket = null;
let onlineUsers = [];
let typingUsers = {};
let unreadMessages = {};
let currentChatRecipient = null; // null = public chat
let notificationsEnabled = true;

// ============== NOTIFICATION SYSTEM ==============
const notificationSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleR4JVqvk6Z9VFwBA0f/tmUgUA0bR/vCLPAUNas/+9HguCA5+0v7weR8HAIjV/PJ2FgUOltj98GkNAQif3Pv2XgIFE6jg+flSAQMZseP5+EUAAhu35/r4OwAEIb7q+fkwAAUmxO358iUBBirL8fjqGwIHL9P1+OAPAwgz2vb34AcECDff+PfYAAUKOub5+NEABQ094/r61gAFDkDn+/rUAAQPQ+v8+9MABA9F7v389QIEEEjx/f36AQQRSPX+/f8BBRNLkfAA');

function playNotificationSound() {
    if (!notificationsEnabled) return;
    try {
        notificationSound.currentTime = 0;
        notificationSound.volume = 0.5;
        notificationSound.play().catch(() => {});
    } catch (e) {}
}

function vibrate() {
    if (!notificationsEnabled) return;
    if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
    }
}

function notify(title, message) {
    if (!notificationsEnabled) return;
    
    playNotificationSound();
    vibrate();
    
    // Browser notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '🎵' });
    }
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}

// ============== API HELPERS ==============
async function api(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        logout();
        throw new Error('Sesja wygasła');
    }
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Błąd serwera' }));
        throw new Error(error.detail || 'Błąd serwera');
    }
    
    return response.json();
}

// ============== AUTHENTICATION ==============
async function login(email, password) {
    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        authToken = data.access_token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        showApp();
        connectWebSocket();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    if (websocket) {
        websocket.close();
        websocket = null;
    }
    showLogin();
}

function checkAuth() {
    const token = localStorage.getItem('authToken');
    const user = localStorage.getItem('currentUser');
    
    if (token && user) {
        authToken = token;
        currentUser = JSON.parse(user);
        showApp();
        connectWebSocket();
    } else {
        showLogin();
    }
    
    // Load notification preference
    notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';
}

// ============== WEBSOCKET ==============
function connectWebSocket() {
    if (!authToken) return;
    
    const wsUrl = `${WS_URL}/ws/chat/${authToken}`;
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
        console.log('WebSocket connected');
    };
    
    websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    websocket.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(() => {
            if (authToken) connectWebSocket();
        }, 3000);
    };
    
    websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'message':
            handleNewMessage(data);
            break;
        case 'online_users':
            onlineUsers = data.users;
            updateOnlineStatus();
            break;
        case 'typing':
            handleTyping(data);
            break;
        case 'stop_typing':
            handleStopTyping(data);
            break;
    }
}

function handleNewMessage(data) {
    // Check if message is for current chat
    const isForCurrentChat = data.is_private
        ? (data.sender_id === currentChatRecipient || data.recipient_id === currentChatRecipient || data.sender_id === currentUser.id)
        : currentChatRecipient === null;
    
    if (currentView === 'chat' && isForCurrentChat) {
        appendMessage(data);
    }
    
    // Notification if not own message and not in current chat
    if (data.sender_id !== currentUser.id) {
        if (currentView !== 'chat' || !isForCurrentChat) {
            // Increment unread count
            const key = data.is_private ? data.sender_id : 'public';
            unreadMessages[key] = (unreadMessages[key] || 0) + 1;
            updateUnreadBadges();
            
            // Notify
            const prefix = data.is_private ? '🔒 Prywatna: ' : '';
            notify(`${prefix}${data.sender_name}`, data.content);
            showToast('Nowa wiadomość', `${data.sender_name}: ${data.content.substring(0, 50)}...`, 'info');
        }
    }
}

function handleTyping(data) {
    if (data.user_id !== currentUser.id) {
        typingUsers[data.user_id] = data.user_name;
        updateTypingIndicator();
    }
}

function handleStopTyping(data) {
    delete typingUsers[data.user_id];
    updateTypingIndicator();
}

// ============== UI RENDERING ==============
function showLogin() {
    document.getElementById('app').innerHTML = `
        <div class="login-container">
            <div class="login-box">
                <h1>Venue Manager</h1>
                <form id="loginForm">
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="loginEmail" placeholder="email@example.com" required>
                    </div>
                    <div class="form-group">
                        <label>Hasło</label>
                        <input type="password" id="loginPassword" placeholder="••••••••" required>
                    </div>
                    <button type="submit" class="btn btn-primary btn-block">Zaloguj się</button>
                </form>
            </div>
        </div>
    `;
    
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        await login(email, password);
    });
}

function showApp() {
    const roleClass = `role-${currentUser.role}`;
    const initials = currentUser.full_name.split(' ').map(n => n[0]).join('').toUpperCase();
    const canAccessFinance = ['owner', 'manager'].includes(currentUser.role);
    
    document.getElementById('app').innerHTML = `
        <div class="app-container">
            <button class="mobile-menu-toggle" onclick="toggleSidebar()">☰</button>
            
            <aside class="sidebar" id="sidebar">
                <div class="sidebar-header">
                    <h2>🎵 Venue</h2>
                </div>
                
                <nav class="sidebar-nav">
                    <a class="nav-item active" data-view="dashboard" onclick="navigateTo('dashboard')">
                        <span class="icon">📊</span>
                        <span>Dashboard</span>
                    </a>
                    <a class="nav-item" data-view="events" onclick="navigateTo('events')">
                        <span class="icon">🎤</span>
                        <span>Wydarzenia</span>
                    </a>
                    <a class="nav-item" data-view="calendar" onclick="navigateTo('calendar')">
                        <span class="icon">📅</span>
                        <span>Kalendarz</span>
                    </a>
                    ${canAccessFinance ? `
                    <a class="nav-item" data-view="revenues" onclick="navigateTo('revenues')">
                        <span class="icon">💰</span>
                        <span>Przychody</span>
                    </a>
                    <a class="nav-item" data-view="costs" onclick="navigateTo('costs')">
                        <span class="icon">📉</span>
                        <span>Koszty</span>
                    </a>
                    <a class="nav-item" data-view="receipts" onclick="navigateTo('receipts')">
                        <span class="icon">🧾</span>
                        <span>Paragony</span>
                    </a>
                    ` : ''}
                    <a class="nav-item" data-view="staff" onclick="navigateTo('staff')">
                        <span class="icon">👥</span>
                        <span>Personel</span>
                    </a>
                    <a class="nav-item" data-view="chat" onclick="navigateTo('chat')">
                        <span class="icon">💬</span>
                        <span>Czat</span>
                        <span class="nav-badge" id="chatBadge" style="display: none">0</span>
                    </a>
                    ${canAccessFinance ? `
                    <a class="nav-item" data-view="users" onclick="navigateTo('users')">
                        <span class="icon">⚙️</span>
                        <span>Użytkownicy</span>
                    </a>
                    ` : ''}
                </nav>
                
                <div class="sidebar-footer">
                    <div class="user-info ${roleClass}">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-details">
                            <div class="user-name">${currentUser.full_name}</div>
                            <div class="user-role">${translateRole(currentUser.role)}</div>
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-block" onclick="logout()">
                        Wyloguj
                    </button>
                </div>
            </aside>
            
            <main class="main-content" id="mainContent">
                <!-- Content will be rendered here -->
            </main>
        </div>
        
        <div class="toast-container" id="toastContainer"></div>
    `;
    
    navigateTo('dashboard');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function navigateTo(view) {
    currentView = view;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    // Close mobile menu
    document.getElementById('sidebar')?.classList.remove('open');
    
    // Clear unread for chat
    if (view === 'chat') {
        const key = currentChatRecipient || 'public';
        unreadMessages[key] = 0;
        updateUnreadBadges();
    }
    
    // Render view
    const content = document.getElementById('mainContent');
    switch (view) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'events':
            renderEvents();
            break;
        case 'calendar':
            renderCalendar();
            break;
        case 'revenues':
            renderRevenues();
            break;
        case 'costs':
            renderCosts();
            break;
        case 'receipts':
            renderReceipts();
            break;
        case 'staff':
            renderStaff();
            break;
        case 'chat':
            renderChat();
            break;
        case 'users':
            renderUsers();
            break;
        default:
            content.innerHTML = '<p>Widok nie znaleziony</p>';
    }
}

// ============== DASHBOARD ==============
let dashboardYear = new Date().getFullYear();
let dashboardMonth = 0; // 0 = all

async function renderDashboard() {
    const canAccessFinance = ['owner', 'manager'].includes(currentUser.role);
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>📊 Dashboard</h1>
        </div>
        
        <div class="filters-bar">
            <div class="filter-group">
                <label>Rok:</label>
                <select id="filterYear" onchange="updateDashboardFilters()">
                    <option value="0">Wszystkie</option>
                    ${[2024, 2025, 2026, 2027].map(y => 
                        `<option value="${y}" ${y === dashboardYear ? 'selected' : ''}>${y}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="filter-group">
                <label>Miesiąc:</label>
                <select id="filterMonth" onchange="updateDashboardFilters()">
                    <option value="0">Wszystkie</option>
                    ${['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                       'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']
                        .map((m, i) => `<option value="${i + 1}" ${i + 1 === dashboardMonth ? 'selected' : ''}>${m}</option>`)
                        .join('')}
                </select>
            </div>
        </div>
        
        <div class="stats-grid" id="statsGrid">
            <div class="loading"><div class="spinner"></div></div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3>📅 Nadchodzące wydarzenia</h3>
            </div>
            <div class="card-body" id="upcomingEvents">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    `;
    
    await loadDashboardData();
}

async function updateDashboardFilters() {
    dashboardYear = parseInt(document.getElementById('filterYear').value);
    dashboardMonth = parseInt(document.getElementById('filterMonth').value);
    await loadDashboardData();
}

async function loadDashboardData() {
    try {
        let url = '/api/dashboard';
        const params = [];
        if (dashboardYear) params.push(`year=${dashboardYear}`);
        if (dashboardMonth) params.push(`month=${dashboardMonth}`);
        if (params.length) url += '?' + params.join('&');
        
        const stats = await api(url);
        const canAccessFinance = stats.has_financial_access;
        
        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card events">
                <div class="stat-icon">🎤</div>
                <div class="stat-value">${stats.total_events}</div>
                <div class="stat-label">Wszystkich wydarzeń</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📆</div>
                <div class="stat-value">${stats.upcoming_events}</div>
                <div class="stat-label">Nadchodzących</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">✅</div>
                <div class="stat-value">${stats.completed_events}</div>
                <div class="stat-label">Zakończonych</div>
            </div>
            ${canAccessFinance ? `
            <div class="stat-card revenue">
                <div class="stat-icon">💰</div>
                <div class="stat-value">${formatCurrency(stats.total_revenue)}</div>
                <div class="stat-label">Przychody</div>
            </div>
            <div class="stat-card costs">
                <div class="stat-icon">📉</div>
                <div class="stat-value">${formatCurrency(stats.total_costs)}</div>
                <div class="stat-label">Koszty</div>
            </div>
            <div class="stat-card profit">
                <div class="stat-icon">📈</div>
                <div class="stat-value ${stats.net_profit >= 0 ? 'positive' : 'negative'}">
                    ${formatCurrency(stats.net_profit)}
                </div>
                <div class="stat-label">Zysk netto</div>
            </div>
            ` : `
            <div class="stat-card">
                <div class="stat-icon">🔒</div>
                <div class="stat-value">-</div>
                <div class="stat-label">Dane finansowe</div>
            </div>
            `}
        `;
        
        // Load upcoming events
        const events = await api('/api/events?status=upcoming');
        const upcomingEl = document.getElementById('upcomingEvents');
        
        if (events.length === 0) {
            upcomingEl.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📅</div>
                    <h3>Brak nadchodzących wydarzeń</h3>
                    <p>Dodaj nowe wydarzenie w zakładce "Wydarzenia"</p>
                </div>
            `;
        } else {
            upcomingEl.innerHTML = events.slice(0, 5).map(event => `
                <div class="event-card">
                    <div class="event-date-box">
                        <div class="day">${new Date(event.date).getDate()}</div>
                        <div class="month">${getMonthShort(new Date(event.date).getMonth())}</div>
                    </div>
                    <div class="event-info">
                        <h3>${event.name}</h3>
                        ${event.genre ? `<span class="genre">${event.genre}</span>` : ''}
                        <p class="description">${event.description || ''}</p>
                        <div class="event-meta">
                            <span>🎫 ${formatCurrency(event.ticket_price)}</span>
                            <span>👥 ${event.expected_attendees} osób</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== EVENTS ==============
let eventsFilter = 'all';

async function renderEvents() {
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>🎤 Wydarzenia</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="showEventModal()">
                    + Nowe wydarzenie
                </button>
            </div>
        </div>
        
        <div class="tabs">
            <button class="tab ${eventsFilter === 'all' ? 'active' : ''}" onclick="filterEvents('all')">Wszystkie</button>
            <button class="tab ${eventsFilter === 'upcoming' ? 'active' : ''}" onclick="filterEvents('upcoming')">Nadchodzące</button>
            <button class="tab ${eventsFilter === 'archive' ? 'active' : ''}" onclick="filterEvents('archive')">Archiwum</button>
        </div>
        
        <div class="event-list" id="eventList">
            <div class="loading"><div class="spinner"></div></div>
        </div>
    `;
    
    await loadEvents();
}

async function filterEvents(filter) {
    eventsFilter = filter;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab:nth-child(${filter === 'all' ? 1 : filter === 'upcoming' ? 2 : 3})`).classList.add('active');
    await loadEvents();
}

async function loadEvents() {
    try {
        let url = '/api/events';
        if (eventsFilter !== 'all') url += `?status=${eventsFilter}`;
        
        const events = await api(url);
        const container = document.getElementById('eventList');
        const canDelete = ['owner', 'manager'].includes(currentUser.role);
        
        if (events.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🎤</div>
                    <h3>Brak wydarzeń</h3>
                    <p>Kliknij "Nowe wydarzenie" aby dodać pierwsze</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = events.map(event => {
            const date = new Date(event.date);
            const isPast = date < new Date();
            
            return `
                <div class="event-card">
                    <div class="event-date-box">
                        <div class="day">${date.getDate()}</div>
                        <div class="month">${getMonthShort(date.getMonth())}</div>
                    </div>
                    <div class="event-info">
                        <h3>${event.name}</h3>
                        ${event.genre ? `<span class="genre">${event.genre}</span>` : ''}
                        ${isPast ? '<span class="badge badge-warning">Zakończone</span>' : '<span class="badge badge-success">Nadchodzące</span>'}
                        <p class="description">${event.description || ''}</p>
                        <div class="event-meta">
                            <span>🎫 ${formatCurrency(event.ticket_price)}</span>
                            <span>👥 ${event.expected_attendees} osób</span>
                            ${event.actual_attendees ? `<span>✓ ${event.actual_attendees} przyszło</span>` : ''}
                        </div>
                    </div>
                    <div class="event-actions">
                        <button class="btn btn-sm btn-secondary" onclick="showEventModal(${event.id})">Edytuj</button>
                        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteEvent(${event.id})">Usuń</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showEventModal(eventId = null) {
    let event = null;
    if (eventId) {
        event = await api(`/api/events/${eventId}`);
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>${event ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="eventForm">
                    <div class="form-group">
                        <label>Nazwa *</label>
                        <input type="text" name="name" value="${event?.name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Data i godzina *</label>
                        <input type="datetime-local" name="date" value="${event ? formatDateTimeLocal(event.date) : ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Gatunek</label>
                        <input type="text" name="genre" value="${event?.genre || ''}" placeholder="np. Rock, Jazz, Techno">
                    </div>
                    <div class="form-group">
                        <label>Cena biletu (PLN)</label>
                        <input type="number" name="ticket_price" value="${event?.ticket_price || ''}" step="0.01" min="0">
                    </div>
                    <div class="form-group">
                        <label>Oczekiwana liczba gości</label>
                        <input type="number" name="expected_attendees" value="${event?.expected_attendees || ''}" min="0">
                    </div>
                    ${event ? `
                    <div class="form-group">
                        <label>Rzeczywista liczba gości</label>
                        <input type="number" name="actual_attendees" value="${event?.actual_attendees || ''}" min="0">
                    </div>
                    ` : ''}
                    <div class="form-group">
                        <label>Opis</label>
                        <textarea name="description" rows="3">${event?.description || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Notatki</label>
                        <textarea name="notes" rows="2">${event?.notes || ''}</textarea>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveEvent(${eventId})">Zapisz</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function saveEvent(eventId) {
    const form = document.getElementById('eventForm');
    const formData = new FormData(form);
    
    const data = {
        name: formData.get('name'),
        date: formData.get('date'),
        genre: formData.get('genre') || null,
        ticket_price: parseFloat(formData.get('ticket_price')) || 0,
        expected_attendees: parseInt(formData.get('expected_attendees')) || 0,
        description: formData.get('description') || null,
        notes: formData.get('notes') || null
    };
    
    if (eventId) {
        data.actual_attendees = parseInt(formData.get('actual_attendees')) || null;
    }
    
    try {
        if (eventId) {
            await api(`/api/events/${eventId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Sukces', 'Wydarzenie zaktualizowane', 'success');
        } else {
            await api('/api/events', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Sukces', 'Wydarzenie utworzone', 'success');
        }
        
        document.querySelector('.modal-overlay').remove();
        loadEvents();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function deleteEvent(eventId) {
    if (!confirm('Czy na pewno chcesz usunąć to wydarzenie?')) return;
    
    try {
        await api(`/api/events/${eventId}`, { method: 'DELETE' });
        showToast('Sukces', 'Wydarzenie usunięte', 'success');
        loadEvents();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== CALENDAR ==============
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();

async function renderCalendar() {
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>📅 Kalendarz</h1>
        </div>
        
        <div class="calendar-container">
            <div class="calendar-header">
                <div class="calendar-nav">
                    <button onclick="changeMonth(-1)">◀</button>
                </div>
                <h3 id="calendarTitle">${getMonthName(calendarMonth)} ${calendarYear}</h3>
                <div class="calendar-nav">
                    <button onclick="changeMonth(1)">▶</button>
                </div>
            </div>
            <div class="calendar-grid" id="calendarGrid">
                <!-- Calendar will be rendered here -->
            </div>
        </div>
    `;
    
    await loadCalendar();
}

async function changeMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    } else if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }
    
    document.getElementById('calendarTitle').textContent = `${getMonthName(calendarMonth)} ${calendarYear}`;
    await loadCalendar();
}

async function loadCalendar() {
    try {
        const events = await api(`/api/calendar/${calendarYear}/${calendarMonth + 1}`);
        const grid = document.getElementById('calendarGrid');
        
        // Day headers
        const days = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];
        let html = days.map(d => `<div class="calendar-day-header">${d}</div>`).join('');
        
        // Calculate first day and days in month
        const firstDay = new Date(calendarYear, calendarMonth, 1);
        const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
        const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
        const daysInMonth = lastDay.getDate();
        
        // Previous month days
        const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            html += `<div class="calendar-day other-month"><span class="day-number">${prevMonthDays - i}</span></div>`;
        }
        
        // Current month days
        const today = new Date();
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = today.getDate() === day && 
                           today.getMonth() === calendarMonth && 
                           today.getFullYear() === calendarYear;
            
            const dayEvents = events[day] || [];
            
            html += `
                <div class="calendar-day ${isToday ? 'today' : ''}" onclick="showEventModal(null, '${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}')">
                    <span class="day-number">${day}</span>
                    ${dayEvents.map(e => `
                        <div class="calendar-event ${e.status === 'completed' ? 'completed' : ''}" 
                             onclick="event.stopPropagation(); showEventModal(${e.id})">
                            ${e.name}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        // Next month days
        const totalCells = startDayOfWeek + daysInMonth;
        const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-day other-month"><span class="day-number">${i}</span></div>`;
        }
        
        grid.innerHTML = html;
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== REVENUES ==============
async function renderRevenues() {
    if (!['owner', 'manager'].includes(currentUser.role)) {
        document.getElementById('mainContent').innerHTML = `
            <div class="restricted-notice">
                <div class="icon">🔒</div>
                <h3>Brak dostępu</h3>
                <p>Tylko menedżerowie i właściciele mogą przeglądać przychody.</p>
            </div>
        `;
        return;
    }
    
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>💰 Przychody</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="showRevenueModal()">+ Nowy przychód</button>
            </div>
        </div>
        
        <div class="card">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Wydarzenie</th>
                            <th>Opis</th>
                            <th>Kategoria</th>
                            <th>Kwota</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody id="revenuesTable">
                        <tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    await loadRevenues();
}

async function loadRevenues() {
    try {
        const [revenues, events] = await Promise.all([
            api('/api/revenues'),
            api('/api/events')
        ]);
        
        const eventsMap = Object.fromEntries(events.map(e => [e.id, e.name]));
        const tbody = document.getElementById('revenuesTable');
        
        if (revenues.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Brak przychodów</td></tr>';
            return;
        }
        
        tbody.innerHTML = revenues.map(rev => `
            <tr>
                <td>${formatDate(rev.created_at)}</td>
                <td>${rev.event_id ? eventsMap[rev.event_id] || '-' : '-'}</td>
                <td>${rev.description}</td>
                <td>${translateCategory(rev.category)}</td>
                <td><strong>${formatCurrency(rev.amount)}</strong></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-danger" onclick="deleteRevenue(${rev.id})">Usuń</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showRevenueModal() {
    const events = await api('/api/events');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Nowy przychód</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="revenueForm">
                    <div class="form-group">
                        <label>Wydarzenie</label>
                        <select name="event_id">
                            <option value="">-- Bez wydarzenia --</option>
                            ${events.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Opis *</label>
                        <input type="text" name="description" required placeholder="np. Sprzedaż biletów">
                    </div>
                    <div class="form-group">
                        <label>Kwota (PLN) *</label>
                        <input type="number" name="amount" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label>Kategoria</label>
                        <select name="category">
                            <option value="tickets">Bilety</option>
                            <option value="bar">Bar</option>
                            <option value="merchandise">Merch</option>
                            <option value="other">Inne</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveRevenue()">Zapisz</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function saveRevenue() {
    const form = document.getElementById('revenueForm');
    const formData = new FormData(form);
    
    try {
        await api('/api/revenues', {
            method: 'POST',
            body: JSON.stringify({
                event_id: formData.get('event_id') ? parseInt(formData.get('event_id')) : null,
                description: formData.get('description'),
                amount: parseFloat(formData.get('amount')),
                category: formData.get('category')
            })
        });
        
        document.querySelector('.modal-overlay').remove();
        showToast('Sukces', 'Przychód dodany', 'success');
        loadRevenues();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function deleteRevenue(id) {
    if (!confirm('Usunąć ten przychód?')) return;
    
    try {
        await api(`/api/revenues/${id}`, { method: 'DELETE' });
        showToast('Sukces', 'Przychód usunięty', 'success');
        loadRevenues();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== COSTS ==============
async function renderCosts() {
    if (!['owner', 'manager'].includes(currentUser.role)) {
        document.getElementById('mainContent').innerHTML = `
            <div class="restricted-notice">
                <div class="icon">🔒</div>
                <h3>Brak dostępu</h3>
                <p>Tylko menedżerowie i właściciele mogą przeglądać koszty.</p>
            </div>
        `;
        return;
    }
    
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>📉 Koszty</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="showCostModal()">+ Nowy koszt</button>
            </div>
        </div>
        
        <div class="card">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Wydarzenie</th>
                            <th>Opis</th>
                            <th>Kategoria</th>
                            <th>Kwota</th>
                            <th>Akcje</th>
                        </tr>
                    </thead>
                    <tbody id="costsTable">
                        <tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    await loadCosts();
}

async function loadCosts() {
    try {
        const [costs, events] = await Promise.all([
            api('/api/costs'),
            api('/api/events')
        ]);
        
        const eventsMap = Object.fromEntries(events.map(e => [e.id, e.name]));
        const tbody = document.getElementById('costsTable');
        
        if (costs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Brak kosztów</td></tr>';
            return;
        }
        
        tbody.innerHTML = costs.map(cost => `
            <tr>
                <td>${formatDate(cost.created_at)}</td>
                <td>${cost.event_id ? eventsMap[cost.event_id] || '-' : '-'}</td>
                <td>${cost.description}</td>
                <td>${translateCategory(cost.category)}</td>
                <td><strong>${formatCurrency(cost.amount)}</strong></td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-danger" onclick="deleteCost(${cost.id})">Usuń</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showCostModal() {
    const events = await api('/api/events');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Nowy koszt</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="costForm">
                    <div class="form-group">
                        <label>Wydarzenie</label>
                        <select name="event_id">
                            <option value="">-- Bez wydarzenia --</option>
                            ${events.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Opis *</label>
                        <input type="text" name="description" required placeholder="np. Zakup alkoholi">
                    </div>
                    <div class="form-group">
                        <label>Kwota (PLN) *</label>
                        <input type="number" name="amount" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label>Kategoria</label>
                        <select name="category">
                            <option value="artist_fee">Honorarium artysty</option>
                            <option value="staff">Personel</option>
                            <option value="bar_stock">Zaopatrzenie baru</option>
                            <option value="equipment">Sprzęt</option>
                            <option value="marketing">Marketing</option>
                            <option value="other">Inne</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveCost()">Zapisz</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function saveCost() {
    const form = document.getElementById('costForm');
    const formData = new FormData(form);
    
    try {
        await api('/api/costs', {
            method: 'POST',
            body: JSON.stringify({
                event_id: formData.get('event_id') ? parseInt(formData.get('event_id')) : null,
                description: formData.get('description'),
                amount: parseFloat(formData.get('amount')),
                category: formData.get('category')
            })
        });
        
        document.querySelector('.modal-overlay').remove();
        showToast('Sukces', 'Koszt dodany', 'success');
        loadCosts();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function deleteCost(id) {
    if (!confirm('Usunąć ten koszt?')) return;
    
    try {
        await api(`/api/costs/${id}`, { method: 'DELETE' });
        showToast('Sukces', 'Koszt usunięty', 'success');
        loadCosts();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== STAFF ==============
async function renderStaff() {
    const content = document.getElementById('mainContent');
    const canManage = ['owner', 'manager'].includes(currentUser.role);
    
    content.innerHTML = `
        <div class="page-header">
            <h1>👥 Personel</h1>
            ${canManage ? `
            <div class="page-actions">
                <button class="btn btn-primary" onclick="showStaffModal()">+ Przypisz osobę</button>
            </div>
            ` : ''}
        </div>
        
        <div class="card">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Wydarzenie</th>
                            <th>Stanowisko</th>
                            <th>Imię i nazwisko</th>
                            <th>Godziny</th>
                            <th>Stawka</th>
                            <th>Suma</th>
                            ${canManage ? '<th>Akcje</th>' : ''}
                        </tr>
                    </thead>
                    <tbody id="staffTable">
                        <tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    await loadStaff();
}

async function loadStaff() {
    try {
        const [staff, events] = await Promise.all([
            api('/api/staff'),
            api('/api/events')
        ]);
        
        const eventsMap = Object.fromEntries(events.map(e => [e.id, e.name]));
        const tbody = document.getElementById('staffTable');
        const canManage = ['owner', 'manager'].includes(currentUser.role);
        
        if (staff.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Brak przypisań personelu</td></tr>`;
            return;
        }
        
        tbody.innerHTML = staff.map(s => `
            <tr>
                <td>${eventsMap[s.event_id] || '-'}</td>
                <td>${s.position}</td>
                <td>${s.name}</td>
                <td>${s.hours || '-'}</td>
                <td>${s.hourly_rate ? formatCurrency(s.hourly_rate) + '/h' : '-'}</td>
                <td><strong>${s.hours && s.hourly_rate ? formatCurrency(s.hours * s.hourly_rate) : '-'}</strong></td>
                ${canManage ? `
                <td class="actions-cell">
                    <button class="btn btn-sm btn-danger" onclick="deleteStaff(${s.id})">Usuń</button>
                </td>
                ` : ''}
            </tr>
        `).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showStaffModal() {
    const events = await api('/api/events');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Przypisz personel</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="staffForm">
                    <div class="form-group">
                        <label>Wydarzenie *</label>
                        <select name="event_id" required>
                            <option value="">-- Wybierz --</option>
                            ${events.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Stanowisko *</label>
                        <select name="position" required>
                            ${JOB_POSITIONS.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Imię i nazwisko *</label>
                        <input type="text" name="name" required placeholder="np. Jan Kowalski">
                    </div>
                    <div class="form-group">
                        <label>Liczba godzin</label>
                        <input type="number" name="hours" step="0.5" min="0" placeholder="np. 8">
                    </div>
                    <div class="form-group">
                        <label>Stawka godzinowa (PLN)</label>
                        <input type="number" name="hourly_rate" step="0.01" min="0" placeholder="np. 40">
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveStaff()">Zapisz</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function saveStaff() {
    const form = document.getElementById('staffForm');
    const formData = new FormData(form);
    
    try {
        await api('/api/staff', {
            method: 'POST',
            body: JSON.stringify({
                event_id: parseInt(formData.get('event_id')),
                position: formData.get('position'),
                name: formData.get('name'),
                hours: parseFloat(formData.get('hours')) || null,
                hourly_rate: parseFloat(formData.get('hourly_rate')) || null
            })
        });
        
        document.querySelector('.modal-overlay').remove();
        showToast('Sukces', 'Personel przypisany', 'success');
        loadStaff();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function deleteStaff(id) {
    if (!confirm('Usunąć to przypisanie?')) return;
    
    try {
        await api(`/api/staff/${id}`, { method: 'DELETE' });
        showToast('Sukces', 'Przypisanie usunięte', 'success');
        loadStaff();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== RECEIPTS ==============
async function renderReceipts() {
    if (!['owner', 'manager'].includes(currentUser.role)) {
        document.getElementById('mainContent').innerHTML = `
            <div class="restricted-notice">
                <div class="icon">🔒</div>
                <h3>Brak dostępu</h3>
                <p>Tylko menedżerowie i właściciele mogą przeglądać paragony.</p>
            </div>
        `;
        return;
    }
    
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>🧾 Paragony</h1>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3>📷 Zeskanuj paragon</h3>
            </div>
            <div class="card-body">
                <div class="receipt-upload" id="receiptUpload" onclick="document.getElementById('receiptInput').click()">
                    <input type="file" id="receiptInput" accept="image/*" capture="environment" onchange="uploadReceipt(this)">
                    <div class="upload-icon">📷</div>
                    <p>Kliknij aby zrobić zdjęcie lub wybrać plik</p>
                    <p style="font-size: 0.875rem; color: var(--text-muted);">Obsługiwane formaty: JPG, PNG</p>
                </div>
                
                <div id="receiptPreview" style="display: none">
                    <div class="receipt-preview">
                        <img id="previewImage" src="" alt="Podgląd">
                    </div>
                    <div class="loading" id="scanningLoader" style="display: none">
                        <div class="spinner"></div>
                        <p style="margin-left: 10px">Skanowanie...</p>
                    </div>
                </div>
                
                <div id="ocrResult" style="display: none">
                    <!-- OCR results will be shown here -->
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <h3>📋 Historia paragonów</h3>
            </div>
            <div class="card-body">
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Sklep</th>
                                <th>Kwota</th>
                                <th>Status</th>
                                <th>Akcje</th>
                            </tr>
                        </thead>
                        <tbody id="receiptsTable">
                            <tr><td colspan="5"><div class="loading"><div class="spinner"></div></div></td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    await loadReceipts();
}

async function loadReceipts() {
    try {
        const receipts = await api('/api/receipts');
        const tbody = document.getElementById('receiptsTable');
        
        if (receipts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Brak paragonów</td></tr>';
            return;
        }
        
        tbody.innerHTML = receipts.map(r => `
            <tr>
                <td>${formatDate(r.created_at)}</td>
                <td>${r.store_name || 'Nieznany'}</td>
                <td>${r.total_amount ? formatCurrency(r.total_amount) : '-'}</td>
                <td>
                    <span class="badge ${r.status === 'processed' ? 'badge-success' : 'badge-warning'}">
                        ${r.status === 'processed' ? 'Przetworzony' : 'Oczekuje'}
                    </span>
                </td>
                <td class="actions-cell">
                    <button class="btn btn-sm btn-secondary" onclick="viewReceiptImage(${r.id})">Podgląd</button>
                    ${r.status !== 'processed' ? `
                    <button class="btn btn-sm btn-primary" onclick="showCreateCostFromReceipt(${r.id}, ${r.total_amount || 0}, '${r.store_name || ''}')">
                        Utwórz koszt
                    </button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function uploadReceipt(input) {
    const file = input.files[0];
    if (!file) return;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = async (e) => {
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('receiptPreview').style.display = 'block';
        document.getElementById('scanningLoader').style.display = 'flex';
        document.getElementById('ocrResult').style.display = 'none';
        
        // Upload and scan
        const formData = new FormData();
        formData.append('image', file);
        
        try {
            const response = await fetch(`${API_URL}/api/receipts/scan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                },
                body: formData
            });
            
            const result = await response.json();
            
            document.getElementById('scanningLoader').style.display = 'none';
            
            // Show result
            const ocrDiv = document.getElementById('ocrResult');
            ocrDiv.style.display = 'block';
            ocrDiv.innerHTML = `
                <div class="ocr-result">
                    <h4>🔍 Wynik skanowania</h4>
                    <div class="ocr-field">
                        <span class="label">Sklep:</span>
                        <span class="value">${result.parsed.store_name || 'Nie rozpoznano'}</span>
                    </div>
                    <div class="ocr-field">
                        <span class="label">Kwota:</span>
                        <span class="value">${result.parsed.total_amount ? formatCurrency(result.parsed.total_amount) : 'Nie rozpoznano'}</span>
                    </div>
                    <div class="ocr-field">
                        <span class="label">Data:</span>
                        <span class="value">${result.parsed.date || 'Nie rozpoznano'}</span>
                    </div>
                    
                    <div style="margin-top: 1rem">
                        <button class="btn btn-primary" onclick="showCreateCostFromReceipt(${result.receipt_id}, ${result.parsed.total_amount || 0}, '${result.parsed.store_name || ''}')">
                            Utwórz koszt z paragonu
                        </button>
                    </div>
                </div>
            `;
            
            showToast('Sukces', 'Paragon zeskanowany', 'success');
            loadReceipts();
        } catch (error) {
            document.getElementById('scanningLoader').style.display = 'none';
            showToast('Błąd', 'Nie udało się zeskanować paragonu', 'error');
        }
    };
    reader.readAsDataURL(file);
}

async function viewReceiptImage(receiptId) {
    try {
        const data = await api(`/api/receipts/${receiptId}/image`);
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width: 600px">
                <div class="modal-header">
                    <h2>Podgląd paragonu</h2>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body" style="text-align: center">
                    <img src="data:${data.image_type};base64,${data.image_data}" 
                         style="max-width: 100%; border-radius: 8px;">
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showCreateCostFromReceipt(receiptId, amount, storeName) {
    const events = await api('/api/events');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>Utwórz koszt z paragonu</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="receiptCostForm">
                    <div class="form-group">
                        <label>Wydarzenie</label>
                        <select name="event_id">
                            <option value="">-- Bez wydarzenia --</option>
                            ${events.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Opis</label>
                        <input type="text" name="description" value="Paragon: ${storeName || 'Sklep'}">
                    </div>
                    <div class="form-group">
                        <label>Kwota (PLN) *</label>
                        <input type="number" name="amount" value="${amount}" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label>Kategoria</label>
                        <select name="category">
                            <option value="bar_stock" selected>Zaopatrzenie baru</option>
                            <option value="equipment">Sprzęt</option>
                            <option value="marketing">Marketing</option>
                            <option value="other">Inne</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveCostFromReceipt(${receiptId})">Utwórz koszt</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function saveCostFromReceipt(receiptId) {
    const form = document.getElementById('receiptCostForm');
    const formData = new FormData(form);
    
    try {
        await api(`/api/receipts/${receiptId}/create-cost`, {
            method: 'POST',
            body: JSON.stringify({
                event_id: formData.get('event_id') ? parseInt(formData.get('event_id')) : null,
                description: formData.get('description'),
                amount: parseFloat(formData.get('amount')),
                category: formData.get('category')
            })
        });
        
        document.querySelector('.modal-overlay').remove();
        showToast('Sukces', 'Koszt utworzony z paragonu', 'success');
        loadReceipts();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== CHAT ==============
let chatUsers = [];

async function renderChat() {
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>💬 Czat</h1>
        </div>
        
        <div class="chat-container">
            <div class="chat-sidebar">
                <div class="chat-sidebar-header">
                    <h3>Rozmowy</h3>
                    <label class="notification-toggle">
                        <input type="checkbox" ${notificationsEnabled ? 'checked' : ''} onchange="toggleNotifications(this.checked)">
                        🔔
                    </label>
                </div>
                <div class="chat-user-list">
                    <div class="chat-channel active" data-recipient="" onclick="selectChatChannel(null)">
                        <span class="channel-icon">📢</span>
                        <span class="channel-name">Ogólny</span>
                        <span class="unread-badge" id="unread-public" style="display: none">0</span>
                    </div>
                    <div id="chatUsersList">
                        <!-- Users will be loaded here -->
                    </div>
                </div>
            </div>
            
            <div class="chat-main">
                <div class="chat-header">
                    <h3 id="chatTitle">📢 Ogólny</h3>
                    <span class="private-indicator" id="privateIndicator" style="display: none">🔒 Prywatna rozmowa</span>
                </div>
                <div class="chat-messages" id="chatMessages">
                    <div class="loading"><div class="spinner"></div></div>
                </div>
                <div class="typing-indicator" id="typingIndicator" style="display: none"></div>
                <div class="chat-input-area">
                    <input type="text" id="chatInput" placeholder="Napisz wiadomość..." 
                           onkeypress="handleChatKeypress(event)" oninput="handleChatInput()">
                    <button class="btn btn-primary" onclick="sendChatMessage()">Wyślij</button>
                </div>
            </div>
        </div>
    `;
    
    await loadChatUsers();
    await loadChatMessages();
}

function toggleNotifications(enabled) {
    notificationsEnabled = enabled;
    localStorage.setItem('notificationsEnabled', enabled);
    showToast('Powiadomienia', enabled ? 'Włączone' : 'Wyłączone', 'info');
}

async function loadChatUsers() {
    try {
        chatUsers = await api('/api/chat/users');
        const container = document.getElementById('chatUsersList');
        
        container.innerHTML = chatUsers.map(user => `
            <div class="chat-user ${currentChatRecipient === user.id ? 'active' : ''}" 
                 data-user-id="${user.id}" 
                 onclick="selectChatChannel(${user.id})">
                <span class="online-status ${user.online ? 'online' : ''}"></span>
                <span class="user-name">${user.name}</span>
                <span class="unread-badge" id="unread-${user.id}" style="display: none">0</span>
            </div>
        `).join('');
        
        updateUnreadBadges();
    } catch (error) {
        console.error('Error loading chat users:', error);
    }
}

async function selectChatChannel(recipientId) {
    currentChatRecipient = recipientId;
    
    // Update UI
    document.querySelectorAll('.chat-channel, .chat-user').forEach(el => {
        el.classList.remove('active');
    });
    
    if (recipientId === null) {
        document.querySelector('.chat-channel[data-recipient=""]').classList.add('active');
        document.getElementById('chatTitle').textContent = '📢 Ogólny';
        document.getElementById('privateIndicator').style.display = 'none';
    } else {
        document.querySelector(`.chat-user[data-user-id="${recipientId}"]`)?.classList.add('active');
        const user = chatUsers.find(u => u.id === recipientId);
        document.getElementById('chatTitle').textContent = user ? user.name : 'Rozmowa';
        document.getElementById('privateIndicator').style.display = 'inline';
    }
    
    // Clear unread
    const key = recipientId || 'public';
    unreadMessages[key] = 0;
    updateUnreadBadges();
    
    await loadChatMessages();
}

async function loadChatMessages() {
    try {
        let url = '/api/chat/messages';
        if (currentChatRecipient) {
            url += `?recipient_id=${currentChatRecipient}`;
        }
        
        const messages = await api(url);
        const container = document.getElementById('chatMessages');
        
        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">💬</div>
                    <h3>Brak wiadomości</h3>
                    <p>Rozpocznij rozmowę!</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = messages.map(msg => createMessageHTML(msg)).join('');
        container.scrollTop = container.scrollHeight;
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

function createMessageHTML(msg) {
    const isOwn = msg.sender_id === currentUser.id;
    return `
        <div class="message ${isOwn ? 'own' : ''} ${msg.is_private ? 'private' : ''}">
            <div class="message-header">
                <span class="message-sender">${isOwn ? 'Ty' : msg.sender_name}</span>
                <span class="message-time">${formatTime(msg.timestamp)}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        </div>
    `;
}

function appendMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    container.insertAdjacentHTML('beforeend', createMessageHTML(msg));
    container.scrollTop = container.scrollHeight;
}

let typingTimeout = null;

function handleChatInput() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    
    websocket.send(JSON.stringify({ 
        type: 'typing',
        recipient_id: currentChatRecipient
    }));
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        websocket.send(JSON.stringify({ 
            type: 'stop_typing',
            recipient_id: currentChatRecipient
        }));
    }, 2000);
}

function handleChatKeypress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    
    if (!content || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    
    websocket.send(JSON.stringify({
        type: 'message',
        content: content,
        recipient_id: currentChatRecipient
    }));
    
    input.value = '';
    
    // Stop typing
    clearTimeout(typingTimeout);
    websocket.send(JSON.stringify({ 
        type: 'stop_typing',
        recipient_id: currentChatRecipient
    }));
}

function updateOnlineStatus() {
    chatUsers.forEach(user => {
        const el = document.querySelector(`.chat-user[data-user-id="${user.id}"] .online-status`);
        if (el) {
            el.classList.toggle('online', onlineUsers.includes(user.id));
        }
    });
}

function updateTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;
    
    const names = Object.values(typingUsers);
    if (names.length === 0) {
        indicator.style.display = 'none';
    } else {
        indicator.style.display = 'block';
        indicator.textContent = names.length === 1 
            ? `${names[0]} pisze...` 
            : `${names.join(', ')} piszą...`;
    }
}

function updateUnreadBadges() {
    // Public channel
    const publicBadge = document.getElementById('unread-public');
    if (publicBadge) {
        const publicCount = unreadMessages['public'] || 0;
        publicBadge.textContent = publicCount;
        publicBadge.style.display = publicCount > 0 ? 'inline' : 'none';
    }
    
    // User channels
    chatUsers.forEach(user => {
        const badge = document.getElementById(`unread-${user.id}`);
        if (badge) {
            const count = unreadMessages[user.id] || 0;
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline' : 'none';
        }
    });
    
    // Sidebar badge
    const totalUnread = Object.values(unreadMessages).reduce((a, b) => a + b, 0);
    const navBadge = document.getElementById('chatBadge');
    if (navBadge) {
        navBadge.textContent = totalUnread;
        navBadge.style.display = totalUnread > 0 ? 'inline' : 'none';
    }
}

// ============== USERS ==============
async function renderUsers() {
    if (!['owner', 'manager'].includes(currentUser.role)) {
        document.getElementById('mainContent').innerHTML = `
            <div class="restricted-notice">
                <div class="icon">🔒</div>
                <h3>Brak dostępu</h3>
                <p>Tylko menedżerowie i właściciele mogą zarządzać użytkownikami.</p>
            </div>
        `;
        return;
    }
    
    const content = document.getElementById('mainContent');
    
    content.innerHTML = `
        <div class="page-header">
            <h1>⚙️ Użytkownicy</h1>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="showUserModal()">+ Nowy użytkownik</button>
            </div>
        </div>
        
        <div class="user-cards" id="userCards">
            <div class="loading"><div class="spinner"></div></div>
        </div>
    `;
    
    await loadUsers();
}

async function loadUsers() {
    try {
        const users = await api('/api/users');
        const container = document.getElementById('userCards');
        
        container.innerHTML = users.map(user => {
            const initials = user.full_name.split(' ').map(n => n[0]).join('').toUpperCase();
            const canEdit = currentUser.role === 'owner' || 
                           (currentUser.role === 'manager' && user.role === 'worker');
            const canDelete = canEdit && user.id !== currentUser.id;
            
            return `
                <div class="user-card role-${user.role}">
                    <div class="user-card-header">
                        <div class="user-card-avatar">${initials}</div>
                        <div class="user-card-info">
                            <h4>${user.full_name}</h4>
                            <p class="email">${user.email}</p>
                        </div>
                    </div>
                    <span class="user-card-role">${translateRole(user.role)}</span>
                    <div class="user-card-actions">
                        ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="showUserModal(${user.id})">Edytuj</button>` : ''}
                        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">Usuń</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function showUserModal(userId = null) {
    let user = null;
    if (userId) {
        const users = await api('/api/users');
        user = users.find(u => u.id === userId);
    }
    
    const canChangeRole = currentUser.role === 'owner';
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h2>${user ? 'Edytuj użytkownika' : 'Nowy użytkownik'}</h2>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                <form id="userForm">
                    <div class="form-group">
                        <label>Imię i nazwisko *</label>
                        <input type="text" name="full_name" value="${user?.full_name || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>Email *</label>
                        <input type="email" name="email" value="${user?.email || ''}" required>
                    </div>
                    <div class="form-group">
                        <label>${user ? 'Nowe hasło (opcjonalne)' : 'Hasło *'}</label>
                        <input type="password" name="password" ${user ? '' : 'required'} placeholder="${user ? 'Zostaw puste aby nie zmieniać' : ''}">
                    </div>
                    <div class="form-group">
                        <label>Rola</label>
                        <select name="role" ${!canChangeRole ? 'disabled' : ''}>
                            ${currentUser.role === 'owner' ? '<option value="owner">Właściciel</option>' : ''}
                            ${currentUser.role === 'owner' ? '<option value="manager">Menedżer</option>' : ''}
                            <option value="worker" ${user?.role === 'worker' ? 'selected' : ''}>Pracownik</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Anuluj</button>
                <button class="btn btn-primary" onclick="saveUser(${userId})">Zapisz</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Set role value
    if (user) {
        modal.querySelector('select[name="role"]').value = user.role;
    }
}

async function saveUser(userId) {
    const form = document.getElementById('userForm');
    const formData = new FormData(form);
    
    const data = {
        full_name: formData.get('full_name'),
        email: formData.get('email'),
        role: formData.get('role') || 'worker'
    };
    
    if (formData.get('password')) {
        data.password = formData.get('password');
    }
    
    try {
        if (userId) {
            await api(`/api/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            showToast('Sukces', 'Użytkownik zaktualizowany', 'success');
        } else {
            await api('/api/users', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            showToast('Sukces', 'Użytkownik utworzony', 'success');
        }
        
        document.querySelector('.modal-overlay').remove();
        loadUsers();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Czy na pewno chcesz usunąć tego użytkownika?')) return;
    
    try {
        await api(`/api/users/${userId}`, { method: 'DELETE' });
        showToast('Sukces', 'Użytkownik usunięty', 'success');
        loadUsers();
    } catch (error) {
        showToast('Błąd', error.message, 'error');
    }
}

// ============== UTILITIES ==============
function formatCurrency(amount) {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN'
    }).format(amount || 0);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pl-PL');
}

function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateTimeLocal(dateStr) {
    const d = new Date(dateStr);
    return d.toISOString().slice(0, 16);
}

function getMonthName(month) {
    return ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
            'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'][month];
}

function getMonthShort(month) {
    return ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 
            'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'][month];
}

function translateRole(role) {
    const roles = {
        'owner': 'Właściciel',
        'manager': 'Menedżer',
        'worker': 'Pracownik'
    };
    return roles[role] || role;
}

function translateCategory(category) {
    const categories = {
        'tickets': 'Bilety',
        'bar': 'Bar',
        'merchandise': 'Merch',
        'artist_fee': 'Honorarium artysty',
        'staff': 'Personel',
        'bar_stock': 'Zaopatrzenie baru',
        'equipment': 'Sprzęt',
        'marketing': 'Marketing',
        'other': 'Inne'
    };
    return categories[category] || category;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 5000);
}

// ============== INITIALIZATION ==============
document.addEventListener('DOMContentLoaded', checkAuth);
