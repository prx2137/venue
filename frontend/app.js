/**
 * Music Venue Management System - Frontend Application
 * Version 3.0 with Live Chat Support
 */

// ==================== CONFIGURATION ====================

const API_URL = typeof window.APP_CONFIG !== 'undefined' 
    ? window.APP_CONFIG.API_URL 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000'
        : window.location.origin;

// WebSocket URL
const WS_URL = API_URL.replace('http://', 'ws://').replace('https://', 'wss://');

// ==================== STATE ====================

let state = {
    user: null,
    token: null,
    events: [],
    costs: [],
    revenues: [],
    receipts: [],
    users: [],
    categories: null,
    chatMessages: [],
    chatUsers: [],
    unreadCount: 0,
    ws: null,
    wsReconnectAttempts: 0,
    // Private messages
    privateMessages: [],
    conversations: [],
    currentConversationUserId: null,
    privateUnreadCount: 0,
    soundEnabled: true,
    // Staff positions
    positions: {}
};

// Position labels
const POSITION_LABELS = {
    'swietlik': 'Świetlik',
    'technik': 'Technik',
    'akustyk': 'Akustyk',
    'barman': 'Barman',
    'barback': 'Barback',
    'promotor': 'Promotor',
    'ochrona': 'Ochrona',
    'bramka': 'Bramka',
    'szatnia': 'Szatnia',
    'rezydent': 'Rezydent',
    'sala': 'Sala',
    'brak': 'Brak stanowiska'
};

// Notification sound
let notificationSound = null;
try {
    notificationSound = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU'+Array(300).join('1'));
} catch(e) {}

// ==================== DOM ELEMENTS ====================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

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
            throw new Error(data.detail || 'Błąd serwera');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ==================== AUTH ====================

async function login(email, password) {
    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        state.token = data.access_token;
        state.user = data.user;
        
        localStorage.setItem('token', state.token);
        localStorage.setItem('user', JSON.stringify(state.user));
        
        showApp();
        connectWebSocket();
        toast('Zalogowano pomyślnie!', 'success');
    } catch (error) {
        throw error;
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.ws?.close();
    state.ws = null;
    
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    showLogin();
}

async function checkAuth() {
    // Check for URL parameters (auto-login)
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    const passwordParam = urlParams.get('password');
    
    if (emailParam && passwordParam) {
        try {
            // Clean URL for security
            window.history.replaceState({}, document.title, window.location.pathname);
            await login(emailParam, passwordParam);
            return;
        } catch (error) {
            console.error('Auto-login failed:', error);
            showLogin();
            return;
        }
    }
    
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        state.token = token;
        state.user = JSON.parse(user);
        showApp();
        connectWebSocket();
    } else {
        showLogin();
    }
}

// ==================== WEBSOCKET CHAT ====================

function connectWebSocket() {
    if (!state.token) return;
    
    const wsUrl = `${WS_URL}/ws/chat/${state.token}`;
    
    try {
        state.ws = new WebSocket(wsUrl);
        
        state.ws.onopen = () => {
            console.log('✅ WebSocket connected');
            state.wsReconnectAttempts = 0;
            loadChatHistory();
        };
        
        state.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        };
        
        state.ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code);
            // Reconnect with exponential backoff
            if (state.token && state.wsReconnectAttempts < 5) {
                const delay = Math.min(1000 * Math.pow(2, state.wsReconnectAttempts), 30000);
                state.wsReconnectAttempts++;
                setTimeout(connectWebSocket, delay);
            }
        };
        
        state.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    } catch (error) {
        console.error('WebSocket connection failed:', error);
        // Fallback to REST polling
        startChatPolling();
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'new_message':
            addChatMessage(data.data);
            if (data.data.sender_id !== state.user.id && !$('#chat-panel').classList.contains('active')) {
                state.unreadCount++;
                updateChatBadge();
                playNotificationSound();
                toast(`${data.data.sender_name}: ${data.data.content.substring(0, 50)}...`, 'info');
            }
            break;
            
        case 'private_message':
            handlePrivateMessage(data.message);
            break;
            
        case 'user_online':
            updateUserStatus(data.data.user_id, true, data.data.full_name);
            break;
            
        case 'user_offline':
            updateUserStatus(data.data.user_id, false, data.data.full_name);
            break;
            
        case 'user_typing':
            showTypingIndicator(data.data.full_name);
            break;
            
        case 'pong':
            // Keep-alive response
            break;
    }
}

function handlePrivateMessage(message) {
    // Update private unread count
    state.privateUnreadCount++;
    updatePrivateBadge();
    
    // Play notification sound
    playNotificationSound();
    
    // Show toast notification
    toast(`📩 ${message.sender_name}: ${message.content.substring(0, 30)}...`, 'info');
    
    // If currently viewing this conversation, add message and mark as read
    if (state.currentConversationUserId === message.sender_id) {
        state.privateMessages.push(message);
        renderPrivateMessages();
        markMessagesAsRead(message.sender_id);
    }
    
    // Update conversations list
    loadConversations();
}

function playNotificationSound() {
    if (state.soundEnabled && notificationSound) {
        try {
            notificationSound.currentTime = 0;
            notificationSound.play().catch(() => {});
        } catch(e) {}
    }
}

function updatePrivateBadge() {
    const badge = $('#private-badge');
    if (badge) {
        badge.textContent = state.privateUnreadCount;
        badge.classList.toggle('hidden', state.privateUnreadCount === 0);
    }
}

function sendChatMessage(content) {
    if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'message',
            content: content
        }));
    } else {
        // Fallback to REST
        sendChatMessageREST(content);
    }
}

async function sendChatMessageREST(content) {
    try {
        const data = await api('/api/chat/messages', {
            method: 'POST',
            body: JSON.stringify({ content, message_type: 'text' })
        });
        addChatMessage(data);
    } catch (error) {
        toast('Nie udało się wysłać wiadomości', 'error');
    }
}

function sendTypingIndicator() {
    if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'typing' }));
    }
}

let typingTimeout = null;
function showTypingIndicator(userName) {
    if (userName === state.user.full_name) return;
    
    $('#typing-user').textContent = userName;
    $('#typing-indicator').classList.remove('hidden');
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        $('#typing-indicator').classList.add('hidden');
    }, 3000);
}

async function loadChatHistory() {
    try {
        const data = await api('/api/chat/history?limit=100');
        state.chatMessages = data.messages;
        state.chatUsers = data.users_online;
        state.unreadCount = data.total_unread;
        
        renderChatMessages();
        renderChatUsers();
        updateChatBadge();
    } catch (error) {
        console.error('Failed to load chat history:', error);
    }
}

function renderChatMessages() {
    const container = $('#chat-messages');
    container.innerHTML = '';
    
    state.chatMessages.forEach(msg => {
        const isOwn = msg.sender_id === state.user.id;
        const isSystem = msg.message_type === 'system';
        
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isOwn ? 'own' : 'other'} ${isSystem ? 'system' : ''}`;
        
        if (!isSystem) {
            messageEl.innerHTML = `
                <div class="message-header">
                    <span class="message-sender">${escapeHtml(msg.sender_name)}</span>
                    <span class="message-role">${getRoleLabel(msg.sender_role)}</span>
                    <span class="message-time">${formatTime(msg.created_at)}</span>
                </div>
                <div class="message-content">${escapeHtml(msg.content)}</div>
            `;
        } else {
            messageEl.innerHTML = `<div class="message-content">${escapeHtml(msg.content)}</div>`;
        }
        
        container.appendChild(messageEl);
    });
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function addChatMessage(msg) {
    state.chatMessages.push(msg);
    
    const container = $('#chat-messages');
    const isOwn = msg.sender_id === state.user.id;
    const isSystem = msg.message_type === 'system';
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${isOwn ? 'own' : 'other'} ${isSystem ? 'system' : ''}`;
    
    if (!isSystem) {
        messageEl.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${escapeHtml(msg.sender_name)}</span>
                <span class="message-role">${getRoleLabel(msg.sender_role)}</span>
                <span class="message-time">${formatTime(msg.created_at)}</span>
            </div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        `;
    } else {
        messageEl.innerHTML = `<div class="message-content">${escapeHtml(msg.content)}</div>`;
    }
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

function renderChatUsers() {
    const container = $('#users-online');
    container.innerHTML = '';
    
    const onlineUsers = state.chatUsers.filter(u => u.is_online);
    const offlineUsers = state.chatUsers.filter(u => !u.is_online);
    
    $('#online-count').textContent = onlineUsers.length;
    
    [...onlineUsers, ...offlineUsers].forEach(user => {
        const chip = document.createElement('div');
        chip.className = `user-chip ${user.role}`;
        chip.innerHTML = `
            <span class="status-dot ${user.is_online ? 'online' : ''}"></span>
            <span>${escapeHtml(user.full_name)}</span>
        `;
        container.appendChild(chip);
    });
}

function updateUserStatus(userId, isOnline, fullName) {
    const user = state.chatUsers.find(u => u.user_id === userId);
    if (user) {
        user.is_online = isOnline;
    } else {
        state.chatUsers.push({
            user_id: userId,
            full_name: fullName,
            is_online: isOnline
        });
    }
    renderChatUsers();
}

function updateChatBadge() {
    const badge = $('#chat-badge');
    if (state.unreadCount > 0) {
        badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

async function markMessagesRead() {
    if (state.unreadCount > 0) {
        try {
            await api('/api/chat/mark-read', { method: 'POST' });
            state.unreadCount = 0;
            updateChatBadge();
        } catch (error) {
            console.error('Failed to mark messages as read:', error);
        }
    }
}

function startChatPolling() {
    // Fallback polling if WebSocket fails
    setInterval(async () => {
        if (!$('#chat-panel').classList.contains('active')) return;
        await loadChatHistory();
    }, 5000);
}

// Keep-alive ping
setInterval(() => {
    if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000);


// ==================== PRIVATE MESSAGES ====================

async function loadConversations() {
    try {
        const data = await api('/api/messages/conversations');
        state.conversations = data.conversations;
        state.privateUnreadCount = data.total_unread;
        updatePrivateBadge();
        renderConversations();
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
}

async function loadPrivateMessages(userId) {
    try {
        state.currentConversationUserId = userId;
        const messages = await api(`/api/messages/${userId}`);
        state.privateMessages = messages;
        renderPrivateMessages();
        await loadConversations(); // Refresh unread counts
    } catch (error) {
        console.error('Failed to load private messages:', error);
    }
}

async function sendPrivateMessage(userId, content) {
    try {
        const message = await api(`/api/messages/${userId}`, {
            method: 'POST',
            body: JSON.stringify({ recipient_id: userId, content })
        });
        state.privateMessages.push(message);
        renderPrivateMessages();
    } catch (error) {
        toast('Nie udało się wysłać wiadomości', 'error');
    }
}

async function markMessagesAsRead(userId) {
    try {
        await api(`/api/messages/${userId}`);
    } catch (error) {
        console.error('Failed to mark messages as read:', error);
    }
}

function renderConversations() {
    const container = $('#conversations-list');
    if (!container) return;
    
    if (!state.conversations.length) {
        container.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 1rem;">Brak konwersacji</p>';
        return;
    }
    
    container.innerHTML = state.conversations.map(conv => `
        <div class="conversation-item ${conv.unread_count > 0 ? 'unread' : ''} ${state.currentConversationUserId === conv.user_id ? 'active' : ''}" 
             onclick="openConversation(${conv.user_id})">
            <div class="conversation-avatar">
                ${conv.user_name.charAt(0).toUpperCase()}
            </div>
            <div class="conversation-info">
                <div class="conversation-header">
                    <span class="conversation-name">${escapeHtml(conv.user_name)}</span>
                    ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
                </div>
                <div class="conversation-preview">
                    ${conv.last_message ? escapeHtml(conv.last_message) : '<em>Rozpocznij rozmowę</em>'}
                </div>
                <div class="conversation-meta">
                    <span class="conversation-role">${getRoleLabel(conv.user_role)}</span>
                    ${conv.user_position && conv.user_position !== 'brak' ? `<span class="conversation-position">${POSITION_LABELS[conv.user_position] || conv.user_position}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function renderPrivateMessages() {
    const container = $('#private-messages');
    if (!container) return;
    
    container.innerHTML = '';
    
    state.privateMessages.forEach(msg => {
        const isOwn = msg.sender_id === state.user.id;
        const messageEl = document.createElement('div');
        messageEl.className = `private-message ${isOwn ? 'own' : 'other'}`;
        messageEl.innerHTML = `
            <div class="pm-content">${escapeHtml(msg.content)}</div>
            <div class="pm-time">${formatTime(msg.created_at)}</div>
        `;
        container.appendChild(messageEl);
    });
    
    container.scrollTop = container.scrollHeight;
}

function openConversation(userId) {
    state.currentConversationUserId = userId;
    const user = state.conversations.find(c => c.user_id === userId);
    
    // Update active state in list
    $$('.conversation-item').forEach(el => el.classList.remove('active'));
    const activeItem = $(`.conversation-item[onclick*="${userId}"]`);
    if (activeItem) activeItem.classList.add('active');
    
    // Show conversation panel
    $('#no-conversation-selected').classList.add('hidden');
    $('#conversation-panel').classList.remove('hidden');
    $('#conversation-user-name').textContent = user ? user.user_name : 'Użytkownik';
    
    // Load messages
    loadPrivateMessages(userId);
}

function toggleSoundNotifications() {
    state.soundEnabled = !state.soundEnabled;
    
    // Update UI
    const btn = $('#sound-toggle');
    if (btn) {
        btn.innerHTML = state.soundEnabled ? '🔔' : '🔕';
        btn.title = state.soundEnabled ? 'Wyłącz dźwięki' : 'Włącz dźwięki';
    }
    
    // Save to server
    api('/api/users/me/sound-notifications', {
        method: 'PUT',
        body: JSON.stringify({ enabled: state.soundEnabled })
    }).catch(() => {});
    
    toast(state.soundEnabled ? 'Dźwięki włączone' : 'Dźwięki wyłączone', 'info');
}

function showPrivateMessagesPanel() {
    hideModal();
    
    const html = `
        <div class="private-messages-container">
            <div class="pm-sidebar">
                <div class="pm-sidebar-header">
                    <h3>💬 Wiadomości</h3>
                    <button class="btn btn-small" id="sound-toggle" onclick="toggleSoundNotifications()" title="${state.soundEnabled ? 'Wyłącz dźwięki' : 'Włącz dźwięki'}">
                        ${state.soundEnabled ? '🔔' : '🔕'}
                    </button>
                </div>
                <div id="conversations-list" class="conversations-list">
                    <p class="text-center" style="color: var(--text-muted); padding: 1rem;">Ładowanie...</p>
                </div>
            </div>
            <div class="pm-main">
                <div id="no-conversation-selected" class="no-conversation">
                    <div class="no-conversation-icon">💬</div>
                    <p>Wybierz rozmowę z listy</p>
                </div>
                <div id="conversation-panel" class="conversation-panel hidden">
                    <div class="conversation-header">
                        <h4 id="conversation-user-name">Użytkownik</h4>
                    </div>
                    <div id="private-messages" class="private-messages-list"></div>
                    <div class="pm-input-area">
                        <input type="text" id="pm-input" placeholder="Napisz wiadomość..." onkeypress="handlePmKeypress(event)">
                        <button class="btn btn-primary" onclick="sendCurrentPrivateMessage()">Wyślij</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    showModal('Prywatne wiadomości', html, 'modal-large');
    loadConversations();
}

function handlePmKeypress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendCurrentPrivateMessage();
    }
}

function sendCurrentPrivateMessage() {
    const input = $('#pm-input');
    const content = input.value.trim();
    
    if (!content || !state.currentConversationUserId) return;
    
    sendPrivateMessage(state.currentConversationUserId, content);
    input.value = '';
}


// ==================== UI HELPERS ====================

function showLogin() {
    $('#login-screen').classList.add('active');
    $('#main-app').classList.remove('active');
}

function showApp() {
    $('#login-screen').classList.remove('active');
    $('#main-app').classList.add('active');
    
    $('#user-name').textContent = state.user.full_name;
    $('#user-role-badge').textContent = getRoleLabel(state.user.role);
    
    // Show admin menu for owner/manager
    if (['owner', 'manager'].includes(state.user.role)) {
        $('#users-nav').classList.remove('hidden');
    }
    
    loadInitialData();
}

function getRoleLabel(role) {
    const labels = {
        owner: 'Właściciel',
        manager: 'Manager',
        worker: 'Pracownik'
    };
    return labels[role] || role;
}

function formatMoney(amount) {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN'
    }).format(amount);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateTime(dateStr) {
    return new Date(dateStr).toLocaleString('pl-PL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==================== MODAL ====================

function showModal(title, content, extraClass = '') {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = content;
    const modal = $('#modal');
    modal.classList.remove('modal-large');
    if (extraClass) {
        modal.classList.add(extraClass);
    }
    modal.classList.add('active');
}

function hideModal() {
    const modal = $('#modal');
    modal.classList.remove('active', 'modal-large');
}

// ==================== DATA LOADING ====================

async function loadInitialData() {
    try {
        await Promise.all([
            loadEvents(),
            loadCategories()
        ]);
        updateDashboard();
    } catch (error) {
        console.error('Failed to load initial data:', error);
    }
}

async function loadEvents() {
    state.events = await api('/api/events');
    updateEventSelects();
}

async function loadCategories() {
    state.categories = await api('/api/stats/categories');
}

async function loadUsers() {
    if (['owner', 'manager'].includes(state.user.role)) {
        state.users = await api('/api/users');
    }
}

function updateEventSelects() {
    const selects = ['#cost-event-filter', '#revenue-event-filter', '#report-event-select'];
    const options = state.events.map(e => 
        `<option value="${e.id}">${escapeHtml(e.name)} (${formatDate(e.event_date)})</option>`
    ).join('');
    
    selects.forEach(sel => {
        const select = $(sel);
        if (select) {
            const firstOption = select.querySelector('option:first-child');
            select.innerHTML = '';
            if (firstOption) select.appendChild(firstOption);
            select.innerHTML += options;
        }
    });
}

// ==================== DASHBOARD ====================

async function updateDashboard() {
    const totalEvents = state.events.length;
    let totalCosts = 0;
    let totalRevenue = 0;
    
    // Calculate totals from all events
    for (const event of state.events) {
        try {
            const costs = await api(`/api/costs/event/${event.id}`);
            const revenues = await api(`/api/revenue/event/${event.id}`);
            totalCosts += costs.reduce((sum, c) => sum + c.amount, 0);
            totalRevenue += revenues.reduce((sum, r) => sum + r.amount, 0);
        } catch (e) {
            // Skip failed requests
        }
    }
    
    $('#total-events').textContent = totalEvents;
    $('#total-costs').textContent = formatMoney(totalCosts);
    $('#total-revenue').textContent = formatMoney(totalRevenue);
    $('#total-profit').textContent = formatMoney(totalRevenue - totalCosts);
    
    // Recent events
    const recentEvents = state.events.slice(0, 5);
    $('#recent-events').innerHTML = recentEvents.length ? recentEvents.map(e => `
        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title">🎪 ${escapeHtml(e.name)}</div>
                    <div class="card-subtitle">${formatDate(e.event_date)}</div>
                </div>
                <span class="card-tag">${e.venue_capacity} miejsc</span>
            </div>
        </div>
    `).join('') : '<p class="text-center" style="color: var(--text-muted)">Brak wydarzeń</p>';
}

// ==================== EVENTS ====================

function renderEvents() {
    const list = $('#events-list');
    
    if (!state.events.length) {
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak wydarzeń</p>';
        return;
    }
    
    list.innerHTML = state.events.map(e => `
        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title">🎪 ${escapeHtml(e.name)}</div>
                    <div class="card-subtitle">${formatDateTime(e.event_date)}</div>
                </div>
                <span class="card-tag">${e.venue_capacity} miejsc</span>
            </div>
            <div class="card-body">
                ${e.description ? escapeHtml(e.description) : 'Brak opisu'}
            </div>
            <div class="card-footer">
                <span class="card-amount">${formatMoney(e.ticket_price)} / bilet</span>
                <div class="card-actions">
                    <button class="btn btn-small btn-secondary" onclick="editEvent(${e.id})">✏️</button>
                    <button class="btn btn-small btn-danger" onclick="deleteEvent(${e.id})">🗑️</button>
                </div>
            </div>
        </div>
    `).join('');
}

function showEventForm(event = null) {
    const isEdit = !!event;
    const html = `
        <form id="event-form">
            <div class="form-group">
                <label>Nazwa wydarzenia *</label>
                <input type="text" name="name" value="${event?.name || ''}" required>
            </div>
            <div class="form-group">
                <label>Data wydarzenia *</label>
                <input type="datetime-local" name="event_date" value="${event ? new Date(event.event_date).toISOString().slice(0, 16) : ''}" required>
            </div>
            <div class="form-group">
                <label>Pojemność</label>
                <input type="number" name="venue_capacity" value="${event?.venue_capacity || 0}" min="0">
            </div>
            <div class="form-group">
                <label>Cena biletu (PLN)</label>
                <input type="number" name="ticket_price" value="${event?.ticket_price || 0}" min="0" step="0.01">
            </div>
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description">${event?.description || ''}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Zapisz' : 'Dodaj'}</button>
            </div>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj wydarzenie' : 'Nowe wydarzenie', html);
    
    $('#event-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            event_date: new Date(formData.get('event_date')).toISOString(),
            venue_capacity: parseInt(formData.get('venue_capacity')) || 0,
            ticket_price: parseFloat(formData.get('ticket_price')) || 0,
            description: formData.get('description')
        };
        
        try {
            if (isEdit) {
                await api(`/api/events/${event.id}`, { method: 'PUT', body: JSON.stringify(data) });
                toast('Wydarzenie zaktualizowane', 'success');
            } else {
                await api('/api/events', { method: 'POST', body: JSON.stringify(data) });
                toast('Wydarzenie dodane', 'success');
            }
            hideModal();
            await loadEvents();
            renderEvents();
            updateDashboard();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

function editEvent(id) {
    const event = state.events.find(e => e.id === id);
    if (event) showEventForm(event);
}

async function deleteEvent(id) {
    if (!confirm('Czy na pewno chcesz usunąć to wydarzenie?')) return;
    
    try {
        await api(`/api/events/${id}`, { method: 'DELETE' });
        toast('Wydarzenie usunięte', 'success');
        await loadEvents();
        renderEvents();
        updateDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== COSTS ====================

async function loadCosts(eventId = null) {
    if (eventId) {
        state.costs = await api(`/api/costs/event/${eventId}`);
    } else {
        state.costs = [];
        for (const event of state.events) {
            const costs = await api(`/api/costs/event/${event.id}`);
            state.costs.push(...costs.map(c => ({ ...c, eventName: event.name })));
        }
    }
    renderCosts();
}

function renderCosts() {
    const list = $('#costs-list');
    
    if (!state.costs.length) {
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak kosztów</p>';
        return;
    }
    
    list.innerHTML = state.costs.map(c => {
        const categoryLabel = state.categories?.cost_categories?.[c.category] || c.category;
        const event = state.events.find(e => e.id === c.event_id);
        return `
            <div class="card">
                <div class="card-header">
                    <div>
                        <div class="card-title">${categoryLabel}</div>
                        <div class="card-subtitle">${event ? escapeHtml(event.name) : 'Wydarzenie #' + c.event_id}</div>
                    </div>
                    <span class="card-tag">${formatDate(c.created_at)}</span>
                </div>
                <div class="card-body">${c.description ? escapeHtml(c.description) : 'Brak opisu'}</div>
                <div class="card-footer">
                    <span class="card-amount negative">-${formatMoney(c.amount)}</span>
                    <div class="card-actions">
                        <button class="btn btn-small btn-secondary" onclick="editCost(${c.id})">✏️</button>
                        <button class="btn btn-small btn-danger" onclick="deleteCost(${c.id})">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function showCostForm(cost = null) {
    const isEdit = !!cost;
    const categories = state.categories?.cost_categories || {};
    const categoryOptions = Object.entries(categories).map(([key, label]) => 
        `<option value="${key}" ${cost?.category === key ? 'selected' : ''}>${label}</option>`
    ).join('');
    
    const eventOptions = state.events.map(e => 
        `<option value="${e.id}" ${cost?.event_id === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
    ).join('');
    
    const html = `
        <form id="cost-form">
            <div class="form-group">
                <label>Wydarzenie *</label>
                <select name="event_id" required class="form-select">${eventOptions}</select>
            </div>
            <div class="form-group">
                <label>Kategoria *</label>
                <select name="category" required class="form-select">${categoryOptions}</select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" value="${cost?.amount || ''}" min="0.01" step="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description">${cost?.description || ''}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Zapisz' : 'Dodaj'}</button>
            </div>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj koszt' : 'Nowy koszt', html);
    
    $('#cost-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            event_id: parseInt(formData.get('event_id')),
            category: formData.get('category'),
            amount: parseFloat(formData.get('amount')),
            description: formData.get('description')
        };
        
        try {
            if (isEdit) {
                await api(`/api/costs/${cost.id}`, { method: 'PUT', body: JSON.stringify(data) });
                toast('Koszt zaktualizowany', 'success');
            } else {
                await api('/api/costs', { method: 'POST', body: JSON.stringify(data) });
                toast('Koszt dodany', 'success');
            }
            hideModal();
            await loadCosts($('#cost-event-filter').value || null);
            updateDashboard();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

function editCost(id) {
    const cost = state.costs.find(c => c.id === id);
    if (cost) showCostForm(cost);
}

async function deleteCost(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten koszt?')) return;
    
    try {
        await api(`/api/costs/${id}`, { method: 'DELETE' });
        toast('Koszt usunięty', 'success');
        await loadCosts($('#cost-event-filter').value || null);
        updateDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== REVENUE ====================

async function loadRevenue(eventId = null) {
    if (eventId) {
        state.revenues = await api(`/api/revenue/event/${eventId}`);
    } else {
        state.revenues = [];
        for (const event of state.events) {
            const revenues = await api(`/api/revenue/event/${event.id}`);
            state.revenues.push(...revenues.map(r => ({ ...r, eventName: event.name })));
        }
    }
    renderRevenue();
}

function renderRevenue() {
    const list = $('#revenue-list');
    
    if (!state.revenues.length) {
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak przychodów</p>';
        return;
    }
    
    list.innerHTML = state.revenues.map(r => {
        const sourceLabel = state.categories?.revenue_sources?.[r.source] || r.source;
        const event = state.events.find(e => e.id === r.event_id);
        return `
            <div class="card">
                <div class="card-header">
                    <div>
                        <div class="card-title">${sourceLabel}</div>
                        <div class="card-subtitle">${event ? escapeHtml(event.name) : 'Wydarzenie #' + r.event_id}</div>
                    </div>
                    <span class="card-tag">${formatDate(r.created_at)}</span>
                </div>
                <div class="card-body">${r.description ? escapeHtml(r.description) : 'Brak opisu'}</div>
                <div class="card-footer">
                    <span class="card-amount positive">+${formatMoney(r.amount)}</span>
                    <div class="card-actions">
                        <button class="btn btn-small btn-secondary" onclick="editRevenue(${r.id})">✏️</button>
                        <button class="btn btn-small btn-danger" onclick="deleteRevenue(${r.id})">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function showRevenueForm(revenue = null) {
    const isEdit = !!revenue;
    const sources = state.categories?.revenue_sources || {};
    const sourceOptions = Object.entries(sources).map(([key, label]) => 
        `<option value="${key}" ${revenue?.source === key ? 'selected' : ''}>${label}</option>`
    ).join('');
    
    const eventOptions = state.events.map(e => 
        `<option value="${e.id}" ${revenue?.event_id === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
    ).join('');
    
    const html = `
        <form id="revenue-form">
            <div class="form-group">
                <label>Wydarzenie *</label>
                <select name="event_id" required class="form-select">${eventOptions}</select>
            </div>
            <div class="form-group">
                <label>Źródło *</label>
                <select name="source" required class="form-select">${sourceOptions}</select>
            </div>
            <div class="form-group">
                <label>Kwota (PLN) *</label>
                <input type="number" name="amount" value="${revenue?.amount || ''}" min="0.01" step="0.01" required>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description">${revenue?.description || ''}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Zapisz' : 'Dodaj'}</button>
            </div>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj przychód' : 'Nowy przychód', html);
    
    $('#revenue-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            event_id: parseInt(formData.get('event_id')),
            source: formData.get('source'),
            amount: parseFloat(formData.get('amount')),
            description: formData.get('description')
        };
        
        try {
            if (isEdit) {
                await api(`/api/revenue/${revenue.id}`, { method: 'PUT', body: JSON.stringify(data) });
                toast('Przychód zaktualizowany', 'success');
            } else {
                await api('/api/revenue', { method: 'POST', body: JSON.stringify(data) });
                toast('Przychód dodany', 'success');
            }
            hideModal();
            await loadRevenue($('#revenue-event-filter').value || null);
            updateDashboard();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

function editRevenue(id) {
    const revenue = state.revenues.find(r => r.id === id);
    if (revenue) showRevenueForm(revenue);
}

async function deleteRevenue(id) {
    if (!confirm('Czy na pewno chcesz usunąć ten przychód?')) return;
    
    try {
        await api(`/api/revenue/${id}`, { method: 'DELETE' });
        toast('Przychód usunięty', 'success');
        await loadRevenue($('#revenue-event-filter').value || null);
        updateDashboard();
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== RECEIPTS ====================

async function loadReceipts() {
    state.receipts = await api('/api/receipts');
    renderReceipts();
}

function renderReceipts() {
    const list = $('#receipts-list');
    const canViewImages = ['owner', 'manager'].includes(state.user?.role);
    
    if (!state.receipts.length) {
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak paragonów. Dodaj pierwszy paragon klikając przycisk powyżej.</p>';
        return;
    }
    
    list.innerHTML = state.receipts.map(r => `
        <div class="card receipt-card ${r.status}">
            <div class="card-header">
                <div>
                    <div class="card-title">
                        ${r.has_image ? '📷' : '🧾'} ${escapeHtml(r.store_name || 'Nieznany sklep')}
                    </div>
                    <div class="card-subtitle">
                        ${r.receipt_date ? formatDate(r.receipt_date) : 'Brak daty'}
                        ${r.uploaded_by_name ? ` • Dodał: ${escapeHtml(r.uploaded_by_name)}` : ''}
                    </div>
                </div>
                <span class="card-tag ${r.status === 'processed' ? 'status-processed' : 'status-pending'}">
                    ${r.status === 'processed' ? '✓ Przetworzony' : '⏳ Oczekuje'}
                </span>
            </div>
            <div class="card-footer">
                <span class="card-amount">${r.total_amount ? formatMoney(r.total_amount) : 'Brak kwoty'}</span>
                <div class="card-actions">
                    <button class="btn btn-small" onclick="showReceiptDetails(${r.id})">👁️ Szczegóły</button>
                    ${r.has_image && canViewImages ? `<button class="btn btn-small" onclick="showReceiptImage(${r.id})">🖼️ Zdjęcie</button>` : ''}
                    ${r.status === 'pending' ? `<button class="btn btn-small btn-primary" onclick="createCostFromReceipt(${r.id})">💰 Utwórz koszt</button>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function showReceiptForm() {
    const html = `
        <div class="receipt-upload-tabs">
            <button type="button" class="tab-btn active" onclick="switchReceiptTab('image')">📷 Zdjęcie paragonu</button>
            <button type="button" class="tab-btn" onclick="switchReceiptTab('text')">📝 Tekst (ręcznie)</button>
        </div>
        
        <div id="receipt-tab-image" class="receipt-tab active">
            <form id="receipt-image-form">
                <div class="form-group">
                    <label>Wybierz zdjęcie paragonu *</label>
                    <div class="file-upload-area" id="file-upload-area">
                        <input type="file" name="receipt_image" id="receipt-image-input" accept="image/jpeg,image/png,image/webp" required hidden>
                        <div class="upload-placeholder" onclick="$('#receipt-image-input').click()">
                            <span class="upload-icon">📷</span>
                            <span>Kliknij aby wybrać zdjęcie</span>
                            <span class="upload-hint">lub przeciągnij i upuść</span>
                        </div>
                        <div class="upload-preview" id="upload-preview" style="display: none;">
                            <img id="preview-image" src="" alt="Podgląd">
                            <button type="button" class="btn btn-small" onclick="clearImagePreview()">✕ Usuń</button>
                        </div>
                    </div>
                    <span class="form-hint">Obsługiwane formaty: JPEG, PNG, WebP. Maks. 5MB.</span>
                </div>
                <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px; background: var(--bg-tertiary); padding: 12px; border-radius: 8px;">
                    💡 <strong>Wskazówka:</strong> Zrób wyraźne zdjęcie paragonu telefonem. System automatycznie rozpozna sklep, kwotę i datę.
                </p>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                    <button type="submit" class="btn btn-primary" id="upload-image-btn">📤 Prześlij zdjęcie</button>
                </div>
            </form>
        </div>
        
        <div id="receipt-tab-text" class="receipt-tab" style="display: none;">
            <form id="receipt-text-form">
                <div class="form-group">
                    <label>Tekst paragonu (OCR) *</label>
                    <textarea name="ocr_text" rows="8" placeholder="Wklej tekst zeskanowany z paragonu (np. Google Lens)..." required></textarea>
                </div>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;">
                    💡 Użyj Google Lens lub podobnej aplikacji do zeskanowania paragonu, a następnie wklej tekst powyżej.
                </p>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                    <button type="submit" class="btn btn-primary">📤 Prześlij</button>
                </div>
            </form>
        </div>
    `;
    
    showModal('Dodaj paragon', html);
    
    // Setup file input handlers
    const fileInput = $('#receipt-image-input');
    const uploadArea = $('#file-upload-area');
    
    fileInput.addEventListener('change', handleImageSelect);
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleImageSelect({ target: fileInput });
        }
    });
    
    // Image upload form
    $('#receipt-image-form').onsubmit = async (e) => {
        e.preventDefault();
        const file = fileInput.files[0];
        if (!file) {
            toast('Wybierz zdjęcie paragonu', 'error');
            return;
        }
        
        const btn = $('#upload-image-btn');
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
    
    // Text upload form (legacy)
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

function switchReceiptTab(tab) {
    document.querySelectorAll('.receipt-upload-tabs .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.receipt-tab').forEach(t => t.style.display = 'none');
    
    event.target.classList.add('active');
    $(`#receipt-tab-${tab}`).style.display = 'block';
}

function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast('Nieprawidłowy format. Użyj JPEG, PNG lub WebP.', 'error');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        toast('Plik jest za duży (max 5MB)', 'error');
        return;
    }
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        $('#preview-image').src = e.target.result;
        $('.upload-placeholder').style.display = 'none';
        $('#upload-preview').style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function clearImagePreview() {
    $('#receipt-image-input').value = '';
    $('#preview-image').src = '';
    $('.upload-placeholder').style.display = 'flex';
    $('#upload-preview').style.display = 'none';
}

async function showReceiptDetails(receiptId) {
    try {
        const receipt = await api(`/api/receipts/${receiptId}`);
        
        const itemsHtml = receipt.parsed_items?.length ? `
            <div class="receipt-items">
                <h4>Rozpoznane pozycje:</h4>
                <ul>
                    ${receipt.parsed_items.map(item => `
                        <li>${escapeHtml(item.name)} - ${formatMoney(item.price)}</li>
                    `).join('')}
                </ul>
            </div>
        ` : '';
        
        const html = `
            <div class="receipt-details">
                <div class="detail-row">
                    <span class="detail-label">Sklep:</span>
                    <span class="detail-value">${escapeHtml(receipt.store_name || 'Nieznany')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Data:</span>
                    <span class="detail-value">${receipt.receipt_date ? formatDate(receipt.receipt_date) : 'Brak'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Kwota:</span>
                    <span class="detail-value" style="font-weight: 600; color: var(--primary);">
                        ${receipt.total_amount ? formatMoney(receipt.total_amount) : 'Nie rozpoznano'}
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="detail-value">${receipt.status === 'processed' ? '✅ Przetworzony' : '⏳ Oczekuje'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Dodał:</span>
                    <span class="detail-value">${escapeHtml(receipt.uploaded_by_name || 'Nieznany')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Data dodania:</span>
                    <span class="detail-value">${formatDate(receipt.created_at)}</span>
                </div>
                ${receipt.has_image ? '<div class="detail-row"><span class="detail-label">Zdjęcie:</span><span class="detail-value">📷 Załączone</span></div>' : ''}
                ${itemsHtml}
                ${receipt.ocr_text ? `
                    <div class="ocr-text-section">
                        <h4>Tekst OCR:</h4>
                        <pre class="ocr-text">${escapeHtml(receipt.ocr_text)}</pre>
                    </div>
                ` : ''}
            </div>
            <div class="form-actions" style="margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Zamknij</button>
                ${receipt.has_image && ['owner', 'manager'].includes(state.user?.role) ? `
                    <button type="button" class="btn btn-primary" onclick="showReceiptImage(${receiptId})">🖼️ Zobacz zdjęcie</button>
                ` : ''}
            </div>
        `;
        
        showModal('Szczegóły paragonu', html);
    } catch (error) {
        toast(error.message, 'error');
    }
}

function showReceiptImage(receiptId) {
    if (!['owner', 'manager'].includes(state.user?.role)) {
        toast('Tylko manager i właściciel mogą przeglądać zdjęcia paragonów', 'error');
        return;
    }
    
    const imageUrl = `${API_URL}/api/receipts/${receiptId}/image?token=${state.token}`;
    
    const html = `
        <div class="receipt-image-viewer">
            <img src="${imageUrl}" alt="Zdjęcie paragonu" style="max-width: 100%; max-height: 70vh; border-radius: 8px;">
        </div>
        <div class="form-actions" style="margin-top: 20px;">
            <button type="button" class="btn btn-secondary" onclick="hideModal()">Zamknij</button>
            <a href="${imageUrl}" download="paragon_${receiptId}.jpg" class="btn btn-primary">📥 Pobierz</a>
        </div>
    `;
    
    showModal('Zdjęcie paragonu', html);
}

function createCostFromReceipt(receiptId) {
    const receipt = state.receipts.find(r => r.id === receiptId);
    if (!receipt) return;
    
    const eventOptions = state.events.map(e => 
        `<option value="${e.id}">${escapeHtml(e.name)}</option>`
    ).join('');
    
    const categories = state.categories?.cost_categories || {};
    const categoryOptions = Object.entries(categories).map(([key, label]) => 
        `<option value="${key}" ${key === 'bar_supplies' ? 'selected' : ''}>${label}</option>`
    ).join('');
    
    const html = `
        <form id="receipt-cost-form">
            <div class="receipt-summary">
                <div class="summary-item">
                    <span class="summary-label">Sklep:</span>
                    <span class="summary-value">${escapeHtml(receipt.store_name || 'Nieznany sklep')}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Kwota:</span>
                    <span class="summary-value amount">${receipt.total_amount ? formatMoney(receipt.total_amount) : 'Brak'}</span>
                </div>
            </div>
            <div class="form-group">
                <label>Wydarzenie *</label>
                <select name="event_id" required class="form-select">${eventOptions}</select>
            </div>
            <div class="form-group">
                <label>Kategoria *</label>
                <select name="category" required class="form-select">${categoryOptions}</select>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">✅ Utwórz koszt</button>
            </div>
        </form>
    `;
    
    showModal('Utwórz koszt z paragonu', html);
    
    $('#receipt-cost-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        try {
            await api(`/api/receipts/${receiptId}/create-costs`, {
                method: 'POST',
                body: JSON.stringify({
                    receipt_id: receiptId,
                    event_id: parseInt(formData.get('event_id')),
                    category: formData.get('category')
                })
            });
            
            toast('Koszt utworzony z paragonu!', 'success');
            hideModal();
            await loadReceipts();
            updateDashboard();
        } catch (error) {
            toast(error.message, 'error');
        }
    };
}

// ==================== REPORTS ====================

async function loadReport(eventId) {
    if (!eventId) {
        $('#report-content').innerHTML = '<p class="text-center" style="color: var(--text-muted)">Wybierz wydarzenie</p>';
        return;
    }
    
    try {
        const report = await api(`/api/reports/event/${eventId}`);
        
        const costsBreakdown = Object.entries(report.costs_breakdown || {}).map(([cat, amount]) => {
            const label = state.categories?.cost_categories?.[cat] || cat;
            return `<div class="breakdown-item"><span>${label}</span><span class="text-danger">-${formatMoney(amount)}</span></div>`;
        }).join('') || '<p style="color: var(--text-muted)">Brak kosztów</p>';
        
        const revenueBreakdown = Object.entries(report.revenue_breakdown || {}).map(([src, amount]) => {
            const label = state.categories?.revenue_sources?.[src] || src;
            return `<div class="breakdown-item"><span>${label}</span><span class="text-success">+${formatMoney(amount)}</span></div>`;
        }).join('') || '<p style="color: var(--text-muted)">Brak przychodów</p>';
        
        $('#report-content').innerHTML = `
            <h3 style="margin-bottom: 20px;">📊 ${escapeHtml(report.event_name)}</h3>
            <div class="report-summary">
                <div class="report-stat">
                    <span class="report-stat-value text-danger">${formatMoney(report.total_costs)}</span>
                    <span class="report-stat-label">Koszty</span>
                </div>
                <div class="report-stat">
                    <span class="report-stat-value text-success">${formatMoney(report.total_revenue)}</span>
                    <span class="report-stat-label">Przychody</span>
                </div>
                <div class="report-stat">
                    <span class="report-stat-value ${report.net_profit >= 0 ? 'text-success' : 'text-danger'}">${formatMoney(report.net_profit)}</span>
                    <span class="report-stat-label">Zysk netto</span>
                </div>
                <div class="report-stat">
                    <span class="report-stat-value">${report.profit_margin.toFixed(1)}%</span>
                    <span class="report-stat-label">Marża</span>
                </div>
            </div>
            <div class="breakdown-section">
                <h4>💸 Koszty</h4>
                ${costsBreakdown}
            </div>
            <div class="breakdown-section">
                <h4>💰 Przychody</h4>
                ${revenueBreakdown}
            </div>
        `;
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ==================== USERS ====================

function canManageUser(targetUser) {
    // Nie można zarządzać sobą (z wyjątkiem edycji imienia)
    if (targetUser.id === state.user.id) return false;
    
    // Właściciel może zarządzać wszystkimi
    if (state.user.role === 'owner') return true;
    
    // Manager może zarządzać tylko pracownikami
    if (state.user.role === 'manager' && targetUser.role === 'worker') return true;
    
    return false;
}

function renderUsers() {
    const list = $('#users-list');
    
    if (!state.users.length) {
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak użytkowników</p>';
        return;
    }
    
    // Sortuj: właściciele > managerzy > pracownicy, potem alfabetycznie
    const roleOrder = { owner: 0, manager: 1, worker: 2 };
    const sortedUsers = [...state.users].sort((a, b) => {
        const roleCompare = roleOrder[a.role] - roleOrder[b.role];
        if (roleCompare !== 0) return roleCompare;
        return a.full_name.localeCompare(b.full_name, 'pl');
    });
    
    list.innerHTML = sortedUsers.map(u => {
        const canManage = canManageUser(u);
        const isCurrentUser = u.id === state.user.id;
        const roleClass = u.role === 'owner' ? 'owner' : (u.role === 'manager' ? 'manager' : 'worker');
        const roleEmoji = u.role === 'owner' ? '👑' : (u.role === 'manager' ? '🎯' : '👤');
        const positionLabel = u.position && u.position !== 'brak' ? POSITION_LABELS[u.position] || u.position : null;
        
        return `
            <div class="card user-card ${roleClass}" data-user-id="${u.id}">
                <div class="card-header">
                    <div>
                        <div class="card-title">${roleEmoji} ${escapeHtml(u.full_name)} ${isCurrentUser ? '<span class="you-badge">(Ty)</span>' : ''}</div>
                        <div class="card-subtitle">📧 ${escapeHtml(u.email)}</div>
                    </div>
                    <span class="card-tag role-${u.role}">${getRoleLabel(u.role)}</span>
                </div>
                <div class="card-body">
                    <div class="user-details">
                        <span class="${u.is_active ? 'status-active' : 'status-inactive'}">
                            ${u.is_active ? '✅ Aktywny' : '❌ Nieaktywny'}
                        </span>
                        ${positionLabel ? `<span class="user-position">🎭 ${positionLabel}</span>` : ''}
                        <span class="user-date">📅 Dołączył: ${formatDate(u.created_at)}</span>
                    </div>
                </div>
                <div class="card-footer">
                    <div class="card-actions">
                        ${!isCurrentUser ? `
                        <button class="btn btn-small btn-primary" onclick="openDirectMessage(${u.id})" title="Wyślij wiadomość">
                            💬 Wiadomość
                        </button>
                        ` : ''}
                        ${canManage ? `
                        <button class="btn btn-small btn-secondary" onclick="editUser(${u.id})" title="Edytuj użytkownika">
                            ✏️ Edytuj
                        </button>
                        <button class="btn btn-small btn-danger" onclick="deleteUser(${u.id})" title="Usuń użytkownika">
                            🗑️ Usuń
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openDirectMessage(userId) {
    showPrivateMessagesPanel();
    setTimeout(() => openConversation(userId), 300);
}

function addUser() {
    const isOwner = state.user.role === 'owner';
    
    const positionOptions = Object.entries(POSITION_LABELS).map(([value, label]) => 
        `<option value="${value}">${label}</option>`
    ).join('');
    
    const html = `
        <form id="user-form">
            <div class="form-group">
                <label>Imię i nazwisko *</label>
                <input type="text" name="full_name" required placeholder="np. Jan Kowalski">
            </div>
            <div class="form-group">
                <label>Adres email *</label>
                <input type="email" name="email" required placeholder="np. jan@example.com">
            </div>
            <div class="form-group">
                <label>Hasło *</label>
                <input type="password" name="password" required minlength="6" placeholder="Minimum 6 znaków">
            </div>
            <div class="form-group">
                <label>Rola</label>
                <select name="role" class="form-select">
                    <option value="worker">👤 Pracownik</option>
                    ${isOwner ? `
                    <option value="manager">🎯 Manager</option>
                    <option value="owner">👑 Właściciel</option>
                    ` : ''}
                </select>
                ${!isOwner ? '<small class="form-hint">Jako manager możesz dodawać tylko pracowników</small>' : ''}
            </div>
            <div class="form-group">
                <label>Stanowisko</label>
                <select name="position" class="form-select">
                    ${positionOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="is_active" checked>
                    <span>Konto aktywne</span>
                </label>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">➕ Dodaj użytkownika</button>
            </div>
        </form>
    `;
    
    showModal('Dodaj nowego użytkownika', html);
    
    $('#user-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Dodawanie...';
        
        try {
            await api('/api/users', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: formData.get('full_name').trim(),
                    email: formData.get('email').trim().toLowerCase(),
                    password: formData.get('password'),
                    role: formData.get('role'),
                    position: formData.get('position'),
                    is_active: formData.has('is_active')
                })
            });
            toast('✅ Użytkownik został dodany!', 'success');
            hideModal();
            await loadUsers();
            renderUsers();
        } catch (error) {
            toast(error.message || 'Błąd podczas dodawania użytkownika', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '➕ Dodaj użytkownika';
        }
    };
}

function editUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    
    const isOwner = state.user.role === 'owner';
    const canChangeRole = isOwner && user.id !== state.user.id;
    const canChangePosition = ['owner', 'manager'].includes(state.user.role);
    
    const positionOptions = Object.entries(POSITION_LABELS).map(([value, label]) => 
        `<option value="${value}" ${user.position === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    
    const html = `
        <form id="user-form">
            <div class="form-group">
                <label>Imię i nazwisko *</label>
                <input type="text" name="full_name" value="${escapeHtml(user.full_name)}" required>
            </div>
            <div class="form-group">
                <label>Adres email *</label>
                <input type="email" name="email" value="${escapeHtml(user.email)}" required>
            </div>
            <div class="form-group">
                <label>Nowe hasło <small>(zostaw puste aby nie zmieniać)</small></label>
                <input type="password" name="password" minlength="6" placeholder="Minimum 6 znaków">
            </div>
            <div class="form-group">
                <label>Rola</label>
                <select name="role" class="form-select" ${!canChangeRole ? 'disabled' : ''}>
                    <option value="worker" ${user.role === 'worker' ? 'selected' : ''}>👤 Pracownik</option>
                    ${isOwner ? `
                    <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>🎯 Manager</option>
                    <option value="owner" ${user.role === 'owner' ? 'selected' : ''}>👑 Właściciel</option>
                    ` : ''}
                </select>
                ${!canChangeRole ? '<small class="form-hint">Nie możesz zmienić tej roli</small>' : ''}
            </div>
            <div class="form-group">
                <label>Stanowisko</label>
                <select name="position" class="form-select" ${!canChangePosition ? 'disabled' : ''}>
                    ${positionOptions}
                </select>
                ${!canChangePosition ? '<small class="form-hint">Tylko właściciel lub manager może zmienić stanowisko</small>' : ''}
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" name="is_active" ${user.is_active ? 'checked' : ''}>
                    <span>Konto aktywne</span>
                </label>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">💾 Zapisz zmiany</button>
            </div>
        </form>
    `;
    
    showModal(`Edytuj: ${user.full_name}`, html);
    
    $('#user-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Zapisywanie...';
        
        const updateData = {
            full_name: formData.get('full_name').trim(),
            email: formData.get('email').trim().toLowerCase(),
            is_active: formData.has('is_active')
        };
        
        // Dodaj hasło tylko jeśli podane
        const password = formData.get('password');
        if (password && password.length > 0) {
            updateData.password = password;
        }
        
        // Dodaj rolę tylko jeśli można ją zmienić
        if (canChangeRole) {
            updateData.role = formData.get('role');
        }
        
        // Dodaj stanowisko tylko jeśli można je zmienić
        if (canChangePosition) {
            updateData.position = formData.get('position');
        }
        
        try {
            await api(`/api/users/${user.id}`, {
                method: 'PUT',
                body: JSON.stringify(updateData)
            });
            toast('✅ Użytkownik zaktualizowany!', 'success');
            hideModal();
            await loadUsers();
            renderUsers();
        } catch (error) {
            toast(error.message || 'Błąd podczas aktualizacji', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Zapisz zmiany';
        }
    };
}

async function deleteUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    
    const confirmMsg = `⚠️ Czy na pewno chcesz usunąć użytkownika?\n\n` +
                      `Imię: ${user.full_name}\n` +
                      `Email: ${user.email}\n` +
                      `Rola: ${getRoleLabel(user.role)}\n\n` +
                      `Ta operacja jest nieodwracalna!`;
    
    if (!confirm(confirmMsg)) return;
    
    try {
        const result = await api(`/api/users/${id}`, { method: 'DELETE' });
        toast(`✅ ${result.message || 'Użytkownik usunięty'}`, 'success');
        await loadUsers();
        renderUsers();
    } catch (error) {
        toast(error.message || 'Błąd podczas usuwania', 'error');
    }
}

// ==================== NAVIGATION ====================

function switchView(viewName) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#${viewName}-view`).classList.add('active');
    
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    $(`[data-view="${viewName}"]`).classList.add('active');
    
    // Load view data
    switch (viewName) {
        case 'events':
            renderEvents();
            break;
        case 'costs':
            loadCosts();
            break;
        case 'revenue':
            loadRevenue();
            break;
        case 'receipts':
            loadReceipts();
            break;
        case 'reports':
            $('#report-content').innerHTML = '<p class="text-center" style="color: var(--text-muted)">Wybierz wydarzenie</p>';
            break;
        case 'users':
            loadUsers().then(renderUsers);
            break;
    }
    
    // Close sidebar on mobile
    $('#sidebar').classList.remove('active');
}

function toggleChat() {
    const panel = $('#chat-panel');
    const isOpening = !panel.classList.contains('active');
    
    panel.classList.toggle('active');
    
    if (isOpening) {
        markMessagesRead();
        loadChatHistory();
        $('#chat-input').focus();
    }
}

// ==================== EVENT LISTENERS ====================

document.addEventListener('DOMContentLoaded', () => {
    // Login form
    $('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('#login-email').value;
        const password = $('#login-password').value;
        
        try {
            await login(email, password);
        } catch (error) {
            $('#login-error').textContent = error.message;
        }
    });
    
    // Logout
    $('#logout-btn').addEventListener('click', logout);
    
    // Menu toggle
    $('#menu-toggle').addEventListener('click', () => {
        $('#sidebar').classList.toggle('active');
    });
    
    // Navigation
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            if (view) switchView(view);
        });
    });
    
    // Chat toggle
    $('#chat-toggle').addEventListener('click', toggleChat);
    $('#chat-close').addEventListener('click', toggleChat);
    
    // Chat form
    $('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('#chat-input');
        const content = input.value.trim();
        if (content) {
            sendChatMessage(content);
            input.value = '';
        }
    });
    
    // Typing indicator
    let typingThrottle = null;
    $('#chat-input').addEventListener('input', () => {
        if (!typingThrottle) {
            sendTypingIndicator();
            typingThrottle = setTimeout(() => { typingThrottle = null; }, 2000);
        }
    });
    
    // Modal close
    $('.modal-close').addEventListener('click', hideModal);
    $('#modal').addEventListener('click', (e) => {
        if (e.target === $('#modal')) hideModal();
    });
    
    // Action buttons
    $('#add-event-btn').addEventListener('click', () => showEventForm());
    $('#add-cost-btn').addEventListener('click', () => showCostForm());
    $('#add-revenue-btn').addEventListener('click', () => showRevenueForm());
    $('#add-receipt-btn').addEventListener('click', () => showReceiptForm());
    
    // User management button (only visible for owners/managers)
    const addUserBtn = $('#add-user-btn');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => addUser());
    }
    
    // Filters
    $('#cost-event-filter').addEventListener('change', (e) => loadCosts(e.target.value || null));
    $('#revenue-event-filter').addEventListener('change', (e) => loadRevenue(e.target.value || null));
    $('#report-event-select').addEventListener('change', (e) => loadReport(e.target.value));
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        const sidebar = $('#sidebar');
        const menuBtn = $('#menu-toggle');
        if (window.innerWidth <= 768 && 
            sidebar.classList.contains('active') && 
            !sidebar.contains(e.target) && 
            !menuBtn.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideModal();
            $('#chat-panel').classList.remove('active');
            $('#sidebar').classList.remove('active');
        }
    });
    
    // Check auth on load (async for URL login support)
    checkAuth().catch(err => console.error('Auth check failed:', err));
});
