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
    positions: {},
    // Calendar
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarEvents: [],
    selectedDate: null
};

// Position labels - loaded dynamically from server
let POSITION_LABELS = {
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
        case 'chat_message':
        case 'new_message':
            // Handle both flat and nested format
            const chatMsg = data.data || data;
            addChatMessage(chatMsg);
            if (chatMsg.sender_id !== state.user.id && !$('#chat-panel')?.classList.contains('active')) {
                state.unreadCount++;
                updateChatBadge();
                playNotificationSound();
                toast(`${chatMsg.sender_name}: ${(chatMsg.content || '').substring(0, 50)}...`, 'info');
            }
            break;
            
        case 'private_message':
            handlePrivateMessage(data.message || data);
            break;
            
        case 'user_online':
            // Handle flat format from backend
            updateUserStatus(data.user_id, true, data.user_name);
            break;
            
        case 'user_offline':
            // Handle flat format from backend
            updateUserStatus(data.user_id, false, data.user_name);
            break;
            
        case 'user_typing':
            const typingName = data.data?.full_name || data.full_name || data.user_name;
            if (typingName) showTypingIndicator(typingName);
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
        state.chatMessages = data.messages || [];
        state.chatUsers = data.users_online || [];
        state.unreadCount = data.total_unread || 0;
        
        renderChatMessages();
        renderChatUsers();
        updateChatBadge();
    } catch (error) {
        console.error('Failed to load chat history:', error);
        state.chatMessages = [];
        state.chatUsers = [];
        state.unreadCount = 0;
    }
}

function renderChatMessages() {
    const container = $('#chat-messages');
    if (!container) return;
    container.innerHTML = '';
    
    const messages = state.chatMessages || [];
    messages.forEach(msg => {
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
    if (!container) return;
    container.innerHTML = '';
    
    const users = state.chatUsers || [];
    const onlineUsers = users.filter(u => u.is_online);
    const offlineUsers = users.filter(u => !u.is_online);
    
    const onlineCountEl = $('#online-count');
    if (onlineCountEl) onlineCountEl.textContent = onlineUsers.length;
    
    [...onlineUsers, ...offlineUsers].forEach(user => {
        const chip = document.createElement('div');
        chip.className = `user-chip ${user.role || 'worker'} ${user.is_online ? 'online' : ''}`;
        chip.title = `Kliknij aby rozpocząć prywatną rozmowę z ${user.full_name}`;
        chip.style.cursor = 'pointer';
        chip.innerHTML = `
            <span class="status-dot ${user.is_online ? 'online' : ''}"></span>
            <span>${escapeHtml(user.full_name)}</span>
        `;
        chip.onclick = () => startPrivateChat(user.user_id, user.full_name);
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

function startPrivateChat(userId, userName) {
    // Close chat panel if open
    const chatPanel = $('#chat-panel');
    if (chatPanel) chatPanel.classList.remove('active');
    
    // Open private messages panel and load conversation
    showPrivateMessagesPanel();
    
    // Wait for modal to render, then open conversation
    setTimeout(() => {
        // Check if conversation exists, if not create placeholder
        const conversations = state.conversations || [];
        const existingConv = conversations.find(c => c.user_id === userId);
        
        if (!existingConv) {
            // Add placeholder conversation for new chat
            state.conversations.push({
                user_id: userId,
                user_name: userName,
                user_role: 'worker',
                last_message: null,
                last_message_time: null,
                unread_count: 0
            });
            renderConversations();
        }
        
        openConversation(userId);
    }, 300);
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
        state.conversations = data.conversations || [];
        state.privateUnreadCount = data.total_unread || 0;
        updatePrivateBadge();
        renderConversations();
    } catch (error) {
        console.error('Failed to load conversations:', error);
        state.conversations = [];
        state.privateUnreadCount = 0;
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
    
    const conversations = state.conversations || [];
    if (!conversations.length) {
        container.innerHTML = '<p class="text-center" style="color: var(--text-muted); padding: 1rem;">Brak konwersacji</p>';
        return;
    }
    
    container.innerHTML = conversations.map(conv => `
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
    const conversations = state.conversations || [];
    const user = conversations.find(c => c.user_id === userId);
    
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
                    <div class="pm-header-buttons">
                        <button class="btn btn-small btn-primary" onclick="showNewConversationSelector()" title="Nowa rozmowa">➕</button>
                        <button class="btn btn-small" id="sound-toggle" onclick="toggleSoundNotifications()" title="${state.soundEnabled ? 'Wyłącz dźwięki' : 'Włącz dźwięki'}">
                            ${state.soundEnabled ? '🔔' : '🔕'}
                        </button>
                    </div>
                </div>
                <div id="new-conversation-selector" class="new-conversation-selector hidden">
                    <div class="selector-header">
                        <span>Wybierz użytkownika:</span>
                        <button class="btn btn-small" onclick="hideNewConversationSelector()">✕</button>
                    </div>
                    <div id="users-for-chat" class="users-for-chat"></div>
                </div>
                <div id="conversations-list" class="conversations-list">
                    <p class="text-center" style="color: var(--text-muted); padding: 1rem;">Ładowanie...</p>
                </div>
            </div>
            <div class="pm-main">
                <div id="no-conversation-selected" class="no-conversation">
                    <div class="no-conversation-icon">💬</div>
                    <p>Wybierz rozmowę z listy lub kliknij ➕ aby rozpocząć nową</p>
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

function showNewConversationSelector() {
    const selector = $('#new-conversation-selector');
    const container = $('#users-for-chat');
    if (!selector || !container) return;
    
    selector.classList.remove('hidden');
    
    // Show all users (from chatUsers which has all users)
    const users = state.chatUsers || [];
    const existingConvUserIds = (state.conversations || []).map(c => c.user_id);
    
    // Filter out users already in conversations (show all for simplicity, but mark existing)
    container.innerHTML = users.map(u => `
        <div class="user-select-item ${u.is_online ? 'online' : ''}" onclick="selectUserForChat(${u.user_id}, '${escapeHtml(u.full_name).replace(/'/g, "\\'")}')">
            <span class="status-dot ${u.is_online ? 'online' : ''}"></span>
            <span class="user-select-name">${escapeHtml(u.full_name)}</span>
            <span class="user-select-role">${getRoleLabel(u.role)}</span>
        </div>
    `).join('') || '<p style="padding: 1rem; color: var(--text-muted);">Brak dostępnych użytkowników</p>';
}

function hideNewConversationSelector() {
    const selector = $('#new-conversation-selector');
    if (selector) selector.classList.add('hidden');
}

function selectUserForChat(userId, userName) {
    hideNewConversationSelector();
    
    // Check if conversation exists
    const conversations = state.conversations || [];
    const existingConv = conversations.find(c => c.user_id === userId);
    
    if (!existingConv) {
        // Add new conversation placeholder
        state.conversations.unshift({
            user_id: userId,
            user_name: userName,
            user_role: 'worker',
            last_message: null,
            last_message_time: null,
            unread_count: 0
        });
        renderConversations();
    }
    
    openConversation(userId);
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
        $('#positions-nav').classList.remove('hidden');
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
            loadCategories(),
            loadPositions()
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

async function loadPositions() {
    try {
        const data = await api('/api/staff/positions');
        if (data && data.positions) {
            POSITION_LABELS = data.positions;
            state.positions = data.positions;
        }
    } catch (error) {
        console.error('Failed to load positions:', error);
    }
}

async function loadPositionsFull() {
    try {
        const positions = await api('/api/staff/positions/all');
        return positions;
    } catch (error) {
        console.error('Failed to load full positions:', error);
        return [];
    }
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
        list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak eventów</p>';
        return;
    }
    
    const canEdit = ['owner', 'manager'].includes(state.user?.role);
    
    list.innerHTML = state.events.map(e => {
        const lineupCount = e.lineup?.length || 0;
        const hasRider = e.rider_stage1 || e.rider_stage2 || e.has_rider_file;
        const statusBadge = {
            'upcoming': 'primary',
            'ongoing': 'warning',
            'completed': 'success',
            'cancelled': 'danger'
        }[e.status] || 'secondary';
        
        return `
        <div class="card" style="border-left: 4px solid ${e.color || '#3d6a99'}; cursor: pointer;" onclick="showEventDetails(${e.id})">
            <div class="card-header">
                <div>
                    <div class="card-title">🎪 ${escapeHtml(e.name)}</div>
                    <div class="card-subtitle">
                        📅 ${formatDateTime(e.event_date)} · 📍 ${e.venue || 'Sala Główna'}
                    </div>
                </div>
                <span class="badge badge-${statusBadge}">${e.status}</span>
            </div>
            <div class="card-body">
                <div class="card-meta" style="display: flex; gap: 1rem; flex-wrap: wrap;">
                    <span>👥 ${e.expected_attendees || 0} osób</span>
                    <span>🎫 ${formatMoney(e.ticket_price)}</span>
                    ${lineupCount > 0 ? `<span>🎤 ${lineupCount} artystów</span>` : ''}
                    ${hasRider ? '<span>🎸 Rider</span>' : ''}
                </div>
                ${e.description ? `<p style="margin-top: 0.5rem; color: var(--text-muted)">${escapeHtml(e.description.substring(0, 100))}${e.description.length > 100 ? '...' : ''}</p>` : ''}
            </div>
            ${canEdit ? `
            <div class="card-footer" onclick="event.stopPropagation()">
                <span></span>
                <div class="card-actions">
                    <button class="btn btn-small btn-secondary" onclick="event.stopPropagation(); editEvent(${e.id})">✏️ Edytuj</button>
                    <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); deleteEvent(${e.id})">🗑️</button>
                </div>
            </div>
            ` : ''}
        </div>
    `}).join('');
}

function showEventForm(event = null) {
    const isEdit = !!event;
    const defaultDate = event ? new Date(event.event_date).toISOString().slice(0, 16) : '';
    const endDate = event?.end_date ? new Date(event.end_date).toISOString().slice(0, 16) : '';
    
    const html = `
        <form id="event-form">
            <div class="form-group">
                <label>Nazwa eventu *</label>
                <input type="text" name="name" value="${event?.name || ''}" required placeholder="np. Jazz Night">
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Data i godzina rozpoczęcia *</label>
                    <input type="datetime-local" name="event_date" value="${defaultDate}" required>
                </div>
                <div class="form-group">
                    <label>Data i godzina zakończenia</label>
                    <input type="datetime-local" name="end_date" value="${endDate}">
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Miejsce / Sala</label>
                    <select name="venue">
                        <option value="BOWL" ${event?.venue === 'BOWL' ? 'selected' : ''}>BOWL</option>
                        <option value="OSTRO" ${event?.venue === 'OSTRO' ? 'selected' : ''}>OSTRO</option>
                        <option value="BOWL + OSTRO" ${event?.venue === 'BOWL + OSTRO' ? 'selected' : ''}>BOWL + OSTRO (całość)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="upcoming" ${event?.status === 'upcoming' ? 'selected' : ''}>Nadchodzący</option>
                        <option value="ongoing" ${event?.status === 'ongoing' ? 'selected' : ''}>W trakcie</option>
                        <option value="completed" ${event?.status === 'completed' ? 'selected' : ''}>Zakończony</option>
                        <option value="cancelled" ${event?.status === 'cancelled' ? 'selected' : ''}>Odwołany</option>
                    </select>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Oczekiwana liczba gości</label>
                    <input type="number" name="expected_attendees" value="${event?.expected_attendees || 0}" min="0">
                </div>
                <div class="form-group">
                    <label>Cena biletu (PLN)</label>
                    <input type="number" name="ticket_price" value="${event?.ticket_price || 0}" min="0" step="0.01">
                </div>
            </div>
            
            <div class="form-group">
                <label>Kolor w kalendarzu</label>
                <div class="color-picker-wrapper">
                    <input type="color" name="color" value="${event?.color || '#3d6a99'}">
                    <span style="color: var(--text-muted)">Wybierz kolor dla kalendarza</span>
                </div>
            </div>
            
            <div class="form-group">
                <label>Opis</label>
                <textarea name="description" class="form-textarea" placeholder="Opis eventu...">${event?.description || ''}</textarea>
            </div>
            
            <div class="form-section">
                <div class="form-section-title">🎸 Rider techniczny (opcjonalnie)</div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Sprzęt - BOWL</label>
                        <textarea name="rider_stage1" class="form-textarea" rows="3" placeholder="np. Piano, DI Box...">${event?.rider_stage1 || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Sprzęt - OSTRO</label>
                        <textarea name="rider_stage2" class="form-textarea" rows="3" placeholder="np. Keyboard...">${event?.rider_stage2 || ''}</textarea>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Uwagi do ridera</label>
                    <textarea name="rider_notes" class="form-textarea" rows="2" placeholder="Dodatkowe wymagania...">${event?.rider_notes || ''}</textarea>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Zapisz zmiany' : 'Dodaj event'}</button>
            </div>
        </form>
    `;
    
    showModal(isEdit ? 'Edytuj event' : 'Nowy event', html);
    
    $('#event-form').onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            event_date: new Date(formData.get('event_date')).toISOString(),
            end_date: formData.get('end_date') ? new Date(formData.get('end_date')).toISOString() : null,
            venue: formData.get('venue'),
            status: formData.get('status'),
            expected_attendees: parseInt(formData.get('expected_attendees')) || 0,
            ticket_price: parseFloat(formData.get('ticket_price')) || 0,
            color: formData.get('color'),
            description: formData.get('description'),
            rider_stage1: formData.get('rider_stage1') || null,
            rider_stage2: formData.get('rider_stage2') || null,
            rider_notes: formData.get('rider_notes') || null
        };
        
        try {
            if (isEdit) {
                await api(`/api/events/${event.id}`, { method: 'PUT', body: JSON.stringify(data) });
                toast('Event zaktualizowany', 'success');
            } else {
                await api('/api/events', { method: 'POST', body: JSON.stringify(data) });
                toast('Event dodany', 'success');
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

// ==================== POSITIONS MANAGEMENT ====================

async function renderPositions() {
    const list = $('#positions-list');
    if (!list) return;
    
    try {
        const positions = await loadPositionsFull();
        
        if (!positions || positions.length === 0) {
            list.innerHTML = '<p class="text-center" style="color: var(--text-muted)">Brak stanowisk. Dodaj pierwsze stanowisko!</p>';
            return;
        }
        
        // Sortuj alfabetycznie, ale "brak" na końcu
        const sorted = [...positions].sort((a, b) => {
            if (a.code === 'brak') return 1;
            if (b.code === 'brak') return -1;
            return a.name.localeCompare(b.name, 'pl');
        });
        
        list.innerHTML = sorted.map(pos => `
            <div class="card position-card ${!pos.is_active ? 'inactive' : ''}" data-position-id="${pos.id}">
                <div class="card-header">
                    <div>
                        <div class="card-title">🎭 ${escapeHtml(pos.name)}</div>
                        <div class="card-subtitle">Kod: <code>${escapeHtml(pos.code)}</code></div>
                    </div>
                    <span class="card-tag ${pos.is_active ? 'status-active' : 'status-inactive'}">
                        ${pos.is_active ? '✅ Aktywne' : '❌ Nieaktywne'}
                    </span>
                </div>
                ${pos.description ? `
                <div class="card-body">
                    <p style="color: var(--text-muted); margin: 0;">${escapeHtml(pos.description)}</p>
                </div>
                ` : ''}
                <div class="card-footer">
                    <div class="card-actions">
                        ${pos.code !== 'brak' ? `
                        <button class="btn btn-small btn-secondary" onclick="editPosition(${pos.id})" title="Edytuj stanowisko">
                            ✏️ Edytuj
                        </button>
                        <button class="btn btn-small btn-danger" onclick="deletePosition(${pos.id})" title="Usuń stanowisko">
                            🗑️ Usuń
                        </button>
                        ` : '<span style="color: var(--text-muted); font-size: 12px;">Domyślne stanowisko</span>'}
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = '<p class="text-center" style="color: var(--danger)">Błąd ładowania stanowisk</p>';
        console.error('Error loading positions:', error);
    }
}

function addPosition() {
    const html = `
        <form id="position-form">
            <div class="form-group">
                <label>Nazwa stanowiska *</label>
                <input type="text" name="name" required placeholder="np. DJ, Kierownik zmiany" maxlength="100">
            </div>
            <div class="form-group">
                <label>Kod (identyfikator) *</label>
                <input type="text" name="code" required placeholder="np. dj, kierownik_zmiany" maxlength="50" pattern="[a-z0-9_]+" title="Tylko małe litery, cyfry i podkreślenia">
                <small class="form-hint">Tylko małe litery, cyfry i podkreślenia (np. dj_rezydent)</small>
            </div>
            <div class="form-group">
                <label>Opis (opcjonalny)</label>
                <input type="text" name="description" placeholder="Krótki opis stanowiska" maxlength="255">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">💾 Dodaj stanowisko</button>
            </div>
        </form>
    `;
    
    showModal('➕ Dodaj nowe stanowisko', html);
    
    $('#position-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            code: formData.get('code').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
            description: formData.get('description') || ''
        };
        
        try {
            await api('/api/staff/positions', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            hideModal();
            await loadPositions();
            renderPositions();
            toast('✅ Stanowisko dodane pomyślnie!');
        } catch (error) {
            toast('❌ ' + (error.message || 'Błąd dodawania stanowiska'), 'error');
        }
    });
}

async function editPosition(id) {
    const positions = await loadPositionsFull();
    const position = positions.find(p => p.id === id);
    if (!position) {
        toast('❌ Nie znaleziono stanowiska', 'error');
        return;
    }
    
    const html = `
        <form id="position-form">
            <div class="form-group">
                <label>Nazwa stanowiska *</label>
                <input type="text" name="name" required value="${escapeHtml(position.name)}" maxlength="100">
            </div>
            <div class="form-group">
                <label>Kod (identyfikator)</label>
                <input type="text" name="code" value="${escapeHtml(position.code)}" disabled>
                <small class="form-hint">Kod nie może być zmieniony</small>
            </div>
            <div class="form-group">
                <label>Opis</label>
                <input type="text" name="description" value="${escapeHtml(position.description || '')}" maxlength="255">
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="is_active" ${position.is_active ? 'checked' : ''}>
                    Stanowisko aktywne
                </label>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="hideModal()">Anuluj</button>
                <button type="submit" class="btn btn-primary">💾 Zapisz zmiany</button>
            </div>
        </form>
    `;
    
    showModal('✏️ Edytuj stanowisko', html);
    
    $('#position-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            description: formData.get('description') || '',
            is_active: formData.get('is_active') === 'on'
        };
        
        try {
            await api(`/api/staff/positions/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            hideModal();
            await loadPositions();
            renderPositions();
            toast('✅ Stanowisko zaktualizowane!');
        } catch (error) {
            toast('❌ ' + (error.message || 'Błąd aktualizacji stanowiska'), 'error');
        }
    });
}

async function deletePosition(id) {
    const positions = await loadPositionsFull();
    const position = positions.find(p => p.id === id);
    if (!position) return;
    
    if (!confirm(`Czy na pewno chcesz usunąć stanowisko "${position.name}"?\n\nJeśli są przypisani użytkownicy, stanowisko zostanie dezaktywowane zamiast usunięte.`)) {
        return;
    }
    
    try {
        const result = await api(`/api/staff/positions/${id}`, {
            method: 'DELETE'
        });
        await loadPositions();
        renderPositions();
        toast('✅ ' + (result.message || 'Stanowisko usunięte'));
    } catch (error) {
        toast('❌ ' + (error.message || 'Błąd usuwania stanowiska'), 'error');
    }
}

function openDirectMessage(userId) {
    showPrivateMessagesPanel();
    setTimeout(() => openConversation(userId), 300);
}

async function addUser() {
    const isOwner = state.user.role === 'owner';
    
    // Ensure positions are loaded
    if (!POSITION_LABELS || Object.keys(POSITION_LABELS).length <= 1) {
        await loadPositions();
    }
    
    const positions = POSITION_LABELS || {'brak': 'Brak stanowiska'};
    const positionOptions = Object.entries(positions).map(([value, label]) => 
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

async function editUser(id) {
    const user = state.users.find(u => u.id === id);
    if (!user) return;
    
    // Ensure positions are loaded
    if (!POSITION_LABELS || Object.keys(POSITION_LABELS).length <= 1) {
        await loadPositions();
    }
    
    const isOwner = state.user.role === 'owner';
    const canChangeRole = isOwner && user.id !== state.user.id;
    const canChangePosition = ['owner', 'manager'].includes(state.user.role);
    
    const positions = POSITION_LABELS || {'brak': 'Brak stanowiska'};
    const positionOptions = Object.entries(positions).map(([value, label]) => 
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
        case 'calendar':
            renderCalendar();
            break;
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
            $('#report-content').innerHTML = '<p class="text-center" style="color: var(--text-muted)">Wybierz event</p>';
            break;
        case 'positions':
            renderPositions();
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

// ==================== CALENDAR ====================

const MONTH_NAMES = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 
                     'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const DAY_NAMES = ['Pon', 'Wto', 'Śro', 'Czw', 'Pią', 'Sob', 'Nie'];

async function renderCalendar() {
    const year = state.calendarYear;
    const month = state.calendarMonth;
    
    // Update label
    $('#calendar-month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;
    
    // Load events for this month
    try {
        state.calendarEvents = await api(`/api/calendar/${year}/${month}`);
    } catch (err) {
        state.calendarEvents = [];
    }
    
    const grid = $('#calendar-grid');
    grid.innerHTML = '';
    
    // Header row
    DAY_NAMES.forEach(day => {
        grid.innerHTML += `<div class="calendar-header">${day}</div>`;
    });
    
    // Get first day of month and total days
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
    const totalDays = lastDay.getDate();
    
    // Previous month days
    const prevMonth = new Date(year, month - 1, 0);
    for (let i = startWeekday - 1; i >= 0; i--) {
        const day = prevMonth.getDate() - i;
        grid.innerHTML += `<div class="calendar-day other-month"><div class="calendar-day-number">${day}</div></div>`;
    }
    
    // Current month days
    const today = new Date();
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = today.getFullYear() === year && today.getMonth() === month - 1 && today.getDate() === day;
        const isSelected = state.selectedDate === dateStr;
        
        const dayEvents = state.calendarEvents.filter(e => e.event_date.startsWith(dateStr));
        
        let eventsHtml = '';
        dayEvents.slice(0, 3).forEach(e => {
            eventsHtml += `<div class="calendar-event-dot" style="background: ${e.color || '#3d6a99'}">${e.name.substring(0, 15)}</div>`;
        });
        if (dayEvents.length > 3) {
            eventsHtml += `<div class="calendar-event-dot" style="background: var(--text-muted)">+${dayEvents.length - 3}</div>`;
        }
        
        grid.innerHTML += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" 
                 onclick="selectCalendarDay('${dateStr}')">
                <div class="calendar-day-number">${day}</div>
                <div class="calendar-day-events">${eventsHtml}</div>
            </div>
        `;
    }
    
    // Next month days
    const totalCells = startWeekday + totalDays;
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
            grid.innerHTML += `<div class="calendar-day other-month"><div class="calendar-day-number">${i}</div></div>`;
        }
    }
}

function changeMonth(delta) {
    state.calendarMonth += delta;
    if (state.calendarMonth > 12) {
        state.calendarMonth = 1;
        state.calendarYear++;
    } else if (state.calendarMonth < 1) {
        state.calendarMonth = 12;
        state.calendarYear--;
    }
    renderCalendar();
}

function selectCalendarDay(dateStr) {
    state.selectedDate = dateStr;
    renderCalendar();
    
    // Show events for this day
    const dayEvents = state.calendarEvents.filter(e => e.event_date.startsWith(dateStr));
    const container = $('#day-events-list');
    
    if (dayEvents.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted)">Brak eventów w tym dniu</p>';
        return;
    }
    
    container.innerHTML = dayEvents.map(e => `
        <div class="card" onclick="showEventDetails(${e.id})" style="border-left: 4px solid ${e.color || '#3d6a99'}; cursor: pointer;">
            <div class="card-header">
                <h4>${e.name}</h4>
                <span class="badge">${e.status}</span>
            </div>
            <div class="card-meta">
                <span>📍 ${e.venue}</span>
                <span>👥 ${e.expected_attendees} osób</span>
                <span>🕐 ${formatTime(e.event_date)}</span>
            </div>
        </div>
    `).join('');
}

// ==================== EVENT DETAILS WITH LINE-UP & RIDER ====================

async function showEventDetails(eventId) {
    try {
        const event = await api(`/api/events/${eventId}`);
        
        const content = `
            <div class="event-detail-header">
                <div>
                    <h2 class="event-detail-title">${event.name}</h2>
                    <div class="event-detail-meta">
                        <span>📅 ${formatDate(event.event_date)}</span>
                        <span>🕐 ${formatTime(event.event_date)}${event.end_date ? ' - ' + formatTime(event.end_date) : ''}</span>
                        <span>📍 ${event.venue}</span>
                        <span>👥 ${event.expected_attendees} osób</span>
                        <span>🎫 ${event.ticket_price} zł</span>
                    </div>
                </div>
                <span class="badge badge-${event.status === 'upcoming' ? 'primary' : event.status === 'completed' ? 'success' : 'warning'}">${event.status}</span>
            </div>
            
            ${event.description ? `<p style="margin-bottom: 1.5rem; color: var(--text-secondary)">${event.description}</p>` : ''}
            
            <div class="event-tabs">
                <button class="event-tab active" onclick="showEventTab('lineup', ${eventId})">🎤 Line-up</button>
                <button class="event-tab" onclick="showEventTab('rider', ${eventId})">🎸 Rider techniczny</button>
                <button class="event-tab" onclick="showEventTab('costs', ${eventId})">💸 Koszty</button>
            </div>
            
            <div id="event-tab-lineup" class="event-tab-content active">
                ${renderEventLineup(event)}
            </div>
            
            <div id="event-tab-rider" class="event-tab-content">
                ${renderEventRider(event)}
            </div>
            
            <div id="event-tab-costs" class="event-tab-content">
                <p style="color: var(--text-muted)">Ładowanie kosztów...</p>
            </div>
            
            ${['owner', 'manager'].includes(state.user.role) ? `
                <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <button class="btn btn-primary" onclick="editEvent(${eventId})">✏️ Edytuj event</button>
                    <button class="btn btn-danger" onclick="deleteEvent(${eventId})" style="margin-left: 0.5rem;">🗑️ Usuń</button>
                </div>
            ` : ''}
        `;
        
        showModal(event.name, content);
        
        // Load costs for this event
        loadEventCosts(eventId);
        
    } catch (err) {
        toast('Błąd ładowania eventu', 'error');
    }
}

function showEventTab(tab, eventId) {
    $$('.event-tab').forEach(t => t.classList.remove('active'));
    $$('.event-tab-content').forEach(c => c.classList.remove('active'));
    
    event.target.classList.add('active');
    $(`#event-tab-${tab}`).classList.add('active');
}

function renderEventLineup(event) {
    const lineup = event.lineup || [];
    const canEdit = ['owner', 'manager'].includes(state.user?.role);
    
    if (lineup.length === 0) {
        return `
            <p style="color: var(--text-muted)">Brak pozycji w line-upie</p>
            ${canEdit ? `<button class="btn btn-small btn-primary" onclick="addLineupEntry(${event.id})">+ Dodaj artystę</button>` : ''}
        `;
    }
    
    let html = '<div class="lineup-list">';
    lineup.forEach(entry => {
        const startTime = formatTime(entry.start_time);
        const endTime = entry.end_time ? formatTime(entry.end_time) : '';
        
        html += `
            <div class="lineup-entry ${entry.is_headliner ? 'headliner' : ''}">
                <div class="lineup-time">${startTime}${endTime ? ' - ' + endTime : ''}</div>
                <div class="lineup-artist">
                    ${entry.artist_name}
                    ${entry.is_headliner ? '<span class="headliner-badge">⭐ HEADLINER</span>' : ''}
                    ${entry.description ? `<div style="font-size: 0.85rem; color: var(--text-muted)">${entry.description}</div>` : ''}
                </div>
                <div class="lineup-stage">📍 ${entry.stage}</div>
                ${canEdit ? `
                    <div class="lineup-actions">
                        <button class="btn btn-small" onclick="editLineupEntry(${event.id}, ${entry.id})">✏️</button>
                        <button class="btn btn-small btn-danger" onclick="deleteLineupEntry(${event.id}, ${entry.id})">🗑️</button>
                    </div>
                ` : ''}
            </div>
        `;
    });
    html += '</div>';
    
    if (canEdit) {
        html += `<button class="btn btn-small btn-primary" style="margin-top: 1rem;" onclick="addLineupEntry(${event.id})">+ Dodaj artystę</button>`;
    }
    
    return html;
}

function renderEventRider(event) {
    const canEdit = ['owner', 'manager'].includes(state.user?.role);
    
    let html = '<div class="rider-grid">';
    
    // Stage 1
    html += `
        <div class="rider-box">
            <h5>🎸 BOWL - Sprzęt</h5>
            <pre>${event.rider_stage1 || 'Brak informacji'}</pre>
        </div>
    `;
    
    // Stage 2
    html += `
        <div class="rider-box">
            <h5>🎹 OSTRO - Sprzęt</h5>
            <pre>${event.rider_stage2 || 'Brak informacji'}</pre>
        </div>
    `;
    
    html += '</div>';
    
    // Notes
    if (event.rider_notes) {
        html += `
            <div class="rider-box" style="margin-top: 1rem;">
                <h5>📝 Uwagi dodatkowe</h5>
                <pre>${event.rider_notes}</pre>
            </div>
        `;
    }
    
    // Uploaded file
    if (event.has_rider_file && event.rider_file_name) {
        html += `
            <div class="rider-file">
                <div class="rider-file-icon">${event.rider_file_name.endsWith('.pdf') ? '📄' : '📝'}</div>
                <div class="rider-file-info">
                    <div class="rider-file-name">${event.rider_file_name}</div>
                    <div class="rider-file-type">Plik ridera technicznego</div>
                </div>
                <a href="${API_URL}/api/events/${event.id}/rider-file" class="btn btn-small" target="_blank">📥 Pobierz</a>
                ${canEdit ? `<button class="btn btn-small btn-danger" onclick="deleteRiderFile(${event.id})">🗑️</button>` : ''}
            </div>
        `;
    } else if (canEdit) {
        html += `
            <div style="margin-top: 1rem;">
                <label class="btn btn-small btn-primary" style="cursor: pointer;">
                    📤 Wgraj plik ridera (PDF/TXT)
                    <input type="file" accept=".pdf,.txt" style="display: none;" onchange="uploadRiderFile(${event.id}, this.files[0])">
                </label>
            </div>
        `;
    }
    
    if (canEdit) {
        html += `<button class="btn btn-small" style="margin-top: 1rem;" onclick="editEventRider(${event.id})">✏️ Edytuj rider</button>`;
    }
    
    return html;
}

async function loadEventCosts(eventId) {
    try {
        const costs = await api(`/api/costs?event_id=${eventId}`);
        const container = $('#event-tab-costs');
        
        if (costs.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted)">Brak kosztów dla tego eventu</p>';
            return;
        }
        
        const total = costs.reduce((sum, c) => sum + c.amount, 0);
        
        container.innerHTML = `
            <div class="costs-summary" style="margin-bottom: 1rem; padding: 1rem; background: var(--bg-tertiary); border-radius: var(--radius);">
                <strong>Suma kosztów:</strong> ${formatCurrency(total)}
            </div>
            <div class="card-list">
                ${costs.map(c => `
                    <div class="card">
                        <div class="card-header">
                            <span>${getCategoryLabel(c.category)}</span>
                            <span class="badge">${formatCurrency(c.amount)}</span>
                        </div>
                        ${c.description ? `<p style="color: var(--text-muted); margin-top: 0.5rem;">${c.description}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    } catch (err) {
        $('#event-tab-costs').innerHTML = '<p style="color: var(--danger)">Błąd ładowania kosztów</p>';
    }
}

// ==================== LINE-UP MANAGEMENT ====================

async function addLineupEntry(eventId) {
    const event = state.events.find(e => e.id === eventId) || await api(`/api/events/${eventId}`);
    const eventDate = new Date(event.event_date);
    const defaultStart = eventDate.toISOString().slice(0, 16);
    
    const content = `
        <form id="lineup-form">
            <div class="form-group">
                <label>Nazwa artysty / zespołu *</label>
                <input type="text" name="artist_name" required placeholder="np. DJ Nazwa">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Scena</label>
                    <select name="stage">
                        <option value="BOWL">BOWL</option>
                        <option value="OSTRO">OSTRO</option>
                    </select>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" name="is_headliner"> Headliner</label>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Start *</label>
                    <input type="datetime-local" name="start_time" required value="${defaultStart}">
                </div>
                <div class="form-group">
                    <label>Koniec</label>
                    <input type="datetime-local" name="end_time">
                </div>
            </div>
            <div class="form-group">
                <label>Opis / gatunek</label>
                <input type="text" name="description" placeholder="np. Techno / House">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Dodaj do line-upu</button>
        </form>
    `;
    
    showModal('Dodaj artystę do line-upu', content);
    
    $('#lineup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        
        try {
            await api(`/api/events/${eventId}/lineup`, {
                method: 'POST',
                body: JSON.stringify({
                    artist_name: form.artist_name.value,
                    stage: form.stage.value,
                    start_time: form.start_time.value,
                    end_time: form.end_time.value || null,
                    description: form.description.value || null,
                    is_headliner: form.is_headliner.checked
                })
            });
            
            toast('Artysta dodany do line-upu');
            hideModal();
            showEventDetails(eventId);
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function editLineupEntry(eventId, entryId) {
    try {
        const lineup = await api(`/api/events/${eventId}/lineup`);
        const entry = lineup.find(l => l.id === entryId);
        if (!entry) return;
        
        const content = `
            <form id="lineup-edit-form">
                <div class="form-group">
                    <label>Nazwa artysty / zespołu *</label>
                    <input type="text" name="artist_name" required value="${entry.artist_name}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Scena</label>
                        <select name="stage">
                            <option value="BOWL" ${entry.stage === 'BOWL' ? 'selected' : ''}>BOWL</option>
                            <option value="OSTRO" ${entry.stage === 'OSTRO' ? 'selected' : ''}>OSTRO</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label><input type="checkbox" name="is_headliner" ${entry.is_headliner ? 'checked' : ''}> Headliner</label>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Start *</label>
                        <input type="datetime-local" name="start_time" required value="${entry.start_time.slice(0, 16)}">
                    </div>
                    <div class="form-group">
                        <label>Koniec</label>
                        <input type="datetime-local" name="end_time" value="${entry.end_time ? entry.end_time.slice(0, 16) : ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Opis / gatunek</label>
                    <input type="text" name="description" value="${entry.description || ''}">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Zapisz zmiany</button>
            </form>
        `;
        
        showModal('Edytuj wpis line-upu', content);
        
        $('#lineup-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            
            try {
                await api(`/api/events/${eventId}/lineup/${entryId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        artist_name: form.artist_name.value,
                        stage: form.stage.value,
                        start_time: form.start_time.value,
                        end_time: form.end_time.value || null,
                        description: form.description.value || null,
                        is_headliner: form.is_headliner.checked
                    })
                });
                
                toast('Wpis zaktualizowany');
                hideModal();
                showEventDetails(eventId);
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    } catch (err) {
        toast('Błąd ładowania', 'error');
    }
}

async function deleteLineupEntry(eventId, entryId) {
    if (!confirm('Usunąć ten wpis z line-upu?')) return;
    
    try {
        await api(`/api/events/${eventId}/lineup/${entryId}`, { method: 'DELETE' });
        toast('Wpis usunięty');
        showEventDetails(eventId);
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ==================== RIDER FILE MANAGEMENT ====================

async function uploadRiderFile(eventId, file) {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${API_URL}/api/events/${eventId}/rider-file`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Błąd uploadu');
        }
        
        toast('Plik ridera wgrany');
        showEventDetails(eventId);
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteRiderFile(eventId) {
    if (!confirm('Usunąć plik ridera?')) return;
    
    try {
        await api(`/api/events/${eventId}/rider-file`, { method: 'DELETE' });
        toast('Plik usunięty');
        showEventDetails(eventId);
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function editEventRider(eventId) {
    try {
        const event = await api(`/api/events/${eventId}`);
        
        const content = `
            <form id="rider-form">
                <div class="form-section-title">🎸 Rider techniczny - edycja</div>
                
                <div class="form-group">
                    <label>Sprzęt - BOWL</label>
                    <textarea name="rider_stage1" class="form-textarea" rows="4" placeholder="np. Piano Steinway, DI Box x2...">${event.rider_stage1 || ''}</textarea>
                </div>
                
                <div class="form-group">
                    <label>Sprzęt - OSTRO</label>
                    <textarea name="rider_stage2" class="form-textarea" rows="4" placeholder="np. Keyboard, statyw...">${event.rider_stage2 || ''}</textarea>
                </div>
                
                <div class="form-group">
                    <label>Uwagi dodatkowe</label>
                    <textarea name="rider_notes" class="form-textarea" rows="3" placeholder="Dodatkowe wymagania...">${event.rider_notes || ''}</textarea>
                </div>
                
                <button type="submit" class="btn btn-primary btn-block">Zapisz rider</button>
            </form>
        `;
        
        showModal('Edytuj rider techniczny', content);
        
        $('#rider-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            
            try {
                await api(`/api/events/${eventId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        rider_stage1: form.rider_stage1.value || null,
                        rider_stage2: form.rider_stage2.value || null,
                        rider_notes: form.rider_notes.value || null
                    })
                });
                
                toast('Rider zapisany');
                hideModal();
                showEventDetails(eventId);
            } catch (err) {
                toast(err.message, 'error');
            }
        });
    } catch (err) {
        toast('Błąd ładowania', 'error');
    }
}

// ==================== SOUND NOTIFICATIONS ====================

async function toggleSoundNotifications() {
    state.soundEnabled = !state.soundEnabled;
    
    const btn = $('#sound-toggle');
    btn.textContent = state.soundEnabled ? '🔔' : '🔕';
    
    try {
        await api('/api/users/me/sound-notifications', {
            method: 'PUT',
            body: JSON.stringify({ enabled: state.soundEnabled })
        });
    } catch (err) {
        // Silently fail
    }
    
    toast(state.soundEnabled ? 'Dźwięki włączone' : 'Dźwięki wyłączone');
}

// ==================== HELPER FUNCTIONS ====================

function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
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
