/**
 * Music Venue Management System - Frontend Application
 * Complete SPA with authentication, events, costs, revenue, and reports management
 */

// ==================== CONFIGURATION ====================
// API_URL is loaded from config.js - edit that file to change the backend URL
const API_URL = typeof CONFIG !== 'undefined' && CONFIG.API_URL 
    ? CONFIG.API_URL 
    : 'http://localhost:8000';

// ==================== STATE ====================
let currentUser = null;
let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');
let events = [];
let costs = [];
let revenues = [];

// ==================== UTILITIES ====================
function formatCurrency(amount) {
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN'
    }).format(amount);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatShortDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function getCategoryLabel(category) {
    const labels = {
        supplies: '📦 Zatowarowanie',
        equipment: '🎸 Sprzęt',
        services: '🛠️ Usługi',
        personnel: '👥 Personel',
        transport: '🚚 Transport',
        other: '📋 Inne'
    };
    return labels[category] || category;
}

function getSourceLabel(source) {
    const labels = {
        box_office: '🎟️ Bramka',
        bar: '🍺 Bar',
        merchandise: '👕 Merchandise',
        other: '📋 Inne'
    };
    return labels[source] || source;
}

function getRoleBadge(role) {
    const badges = {
        owner: '<span class="badge badge-primary">👑 Owner</span>',
        manager: '<span class="badge badge-success">📊 Manager</span>',
        worker: '<span class="badge badge-info">👷 Worker</span>'
    };
    return badges[role] || `<span class="badge">${role}</span>`;
}

// ==================== UI HELPERS ====================
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ==================== API HELPERS ====================
async function apiRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
        
        if (response.status === 401) {
            // Try to refresh token
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${accessToken}`;
                return fetch(`${API_URL}${endpoint}`, { ...options, headers });
            } else {
                logout();
                throw new Error('Session expired');
            }
        }
        
        return response;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

async function refreshAccessToken() {
    if (!refreshToken) return false;
    
    try {
        const response = await fetch(`${API_URL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        
        if (response.ok) {
            const data = await response.json();
            accessToken = data.access_token;
            refreshToken = data.refresh_token;
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            return true;
        }
    } catch (error) {
        console.error('Token refresh failed:', error);
    }
    
    return false;
}

// ==================== AUTHENTICATION ====================
async function login(email, password) {
    showLoading();
    try {
        const response = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
        }
        
        const data = await response.json();
        accessToken = data.access_token;
        refreshToken = data.refresh_token;
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        
        await loadCurrentUser();
        showApp();
        showToast('Zalogowano pomyślnie!', 'success');
    } catch (error) {
        document.getElementById('login-error').textContent = error.message;
        document.getElementById('login-error').classList.remove('hidden');
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function register(fullName, email, password) {
    showLoading();
    try {
        const response = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: fullName, email, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Registration failed');
        }
        
        closeModal('register-modal');
        showToast('Rejestracja udana! Możesz się teraz zalogować.', 'success');
    } catch (error) {
        document.getElementById('register-error').textContent = error.message;
        document.getElementById('register-error').classList.remove('hidden');
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

function logout() {
    accessToken = null;
    refreshToken = null;
    currentUser = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    showLogin();
    showToast('Wylogowano pomyślnie', 'info');
}

async function loadCurrentUser() {
    const response = await apiRequest('/api/auth/me');
    if (response.ok) {
        currentUser = await response.json();
        updateUserUI();
    }
}

function updateUserUI() {
    if (!currentUser) return;
    
    document.getElementById('user-name').textContent = currentUser.full_name;
    document.getElementById('user-role').textContent = currentUser.role;
    document.getElementById('user-avatar').textContent = currentUser.full_name.charAt(0).toUpperCase();
    
    // Show/hide admin section based on role
    const adminSection = document.getElementById('admin-section');
    if (currentUser.role === 'owner') {
        adminSection.classList.remove('hidden');
    } else {
        adminSection.classList.add('hidden');
    }
    
    // Show/hide action buttons based on role
    const canManage = ['owner', 'manager'].includes(currentUser.role);
    document.querySelectorAll('#add-event-btn, #add-cost-btn, #add-revenue-btn').forEach(btn => {
        btn.style.display = canManage ? '' : 'none';
    });
}

// ==================== NAVIGATION ====================
function showLogin() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    navigate('dashboard');
}

function showRegister() {
    openModal('register-modal');
}

function navigate(page) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.add('hidden');
    });
    document.getElementById(`page-${page}`).classList.remove('hidden');
    
    // Close mobile menu
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('mobile-overlay').classList.remove('active');
    
    // Load page data
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'events':
            loadEvents();
            break;
        case 'costs':
            loadCosts();
            break;
        case 'revenue':
            loadRevenue();
            break;
        case 'reports':
            initReportForm();
            break;
        case 'users':
            loadUsers();
            break;
    }
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
    showLoading();
    try {
        const [eventsRes, costsRes, revenueRes] = await Promise.all([
            apiRequest('/api/events'),
            apiRequest('/api/costs'),
            apiRequest('/api/revenue')
        ]);
        
        const eventsData = await eventsRes.json();
        const costsData = await costsRes.json();
        const revenueData = await revenueRes.json();
        
        events = eventsData.events || [];
        
        const totalCosts = costsData.total_amount || 0;
        const totalRevenue = revenueData.total_amount || 0;
        const netProfit = totalRevenue - totalCosts;
        
        document.getElementById('dashboard-stats').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon primary"><i class="fas fa-calendar-alt"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Wydarzenia</div>
                    <div class="stat-value">${events.length}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon accent"><i class="fas fa-receipt"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Łączne koszty</div>
                    <div class="stat-value">${formatCurrency(totalCosts)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon info"><i class="fas fa-coins"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Łączne przychody</div>
                    <div class="stat-value">${formatCurrency(totalRevenue)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon ${netProfit >= 0 ? 'success' : 'accent'}"><i class="fas fa-chart-line"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Zysk netto</div>
                    <div class="stat-value ${netProfit >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(netProfit)}</div>
                </div>
            </div>
        `;
        
        // Recent events
        const recentEvents = events.slice(0, 5);
        if (recentEvents.length === 0) {
            document.getElementById('recent-events').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-calendar-plus"></i></div>
                    <h4 class="empty-state-title">Brak wydarzeń</h4>
                    <p class="empty-state-text">Dodaj swoje pierwsze wydarzenie, aby rozpocząć.</p>
                </div>
            `;
        } else {
            document.getElementById('recent-events').innerHTML = `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Nazwa</th>
                                <th>Data</th>
                                <th>Zysk</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentEvents.map(event => `
                                <tr>
                                    <td><strong>${event.name}</strong></td>
                                    <td>${formatShortDate(event.date)}</td>
                                    <td class="${event.net_profit >= 0 ? 'text-success' : 'text-danger'}">
                                        ${formatCurrency(event.net_profit)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    } catch (error) {
        showToast('Błąd ładowania danych', 'error');
    } finally {
        hideLoading();
    }
}

// ==================== EVENTS ====================
async function loadEvents() {
    showLoading();
    try {
        const response = await apiRequest('/api/events');
        const data = await response.json();
        events = data.events || [];
        
        if (events.length === 0) {
            document.getElementById('events-table').innerHTML = `
                <tr>
                    <td colspan="8" class="text-center">
                        <div class="empty-state">
                            <div class="empty-state-icon"><i class="fas fa-calendar-plus"></i></div>
                            <h4 class="empty-state-title">Brak wydarzeń</h4>
                            <p class="empty-state-text">Kliknij "Dodaj wydarzenie", aby utworzyć pierwsze.</p>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            document.getElementById('events-table').innerHTML = events.map(event => `
                <tr>
                    <td><strong>${event.name}</strong></td>
                    <td>${formatShortDate(event.date)}</td>
                    <td>${event.capacity}</td>
                    <td>${formatCurrency(event.entry_fee)}</td>
                    <td class="text-danger">${formatCurrency(event.total_costs)}</td>
                    <td class="text-success">${formatCurrency(event.total_revenue)}</td>
                    <td class="${event.net_profit >= 0 ? 'text-success' : 'text-danger'} font-bold">
                        ${formatCurrency(event.net_profit)}
                    </td>
                    <td>
                        <div class="flex gap-sm">
                            ${['owner', 'manager'].includes(currentUser?.role) ? `
                                <button class="btn btn-sm btn-secondary" onclick="editEvent(${event.id})" title="Edytuj">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-danger" onclick="deleteEvent(${event.id})" title="Usuń">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        showToast('Błąd ładowania wydarzeń', 'error');
    } finally {
        hideLoading();
    }
}

function showEventModal(eventId = null) {
    const modal = document.getElementById('event-modal');
    const form = document.getElementById('event-form');
    const title = document.getElementById('event-modal-title');
    
    form.reset();
    document.getElementById('event-id').value = '';
    
    if (eventId) {
        const event = events.find(e => e.id === eventId);
        if (event) {
            title.textContent = 'Edytuj wydarzenie';
            document.getElementById('event-id').value = event.id;
            document.getElementById('event-name').value = event.name;
            document.getElementById('event-date').value = new Date(event.date).toISOString().slice(0, 16);
            document.getElementById('event-capacity').value = event.capacity;
            document.getElementById('event-fee').value = event.entry_fee;
            document.getElementById('event-description').value = event.description || '';
        }
    } else {
        title.textContent = 'Dodaj wydarzenie';
    }
    
    openModal('event-modal');
}

function editEvent(eventId) {
    showEventModal(eventId);
}

async function saveEvent(formData) {
    const eventId = document.getElementById('event-id').value;
    const data = {
        name: formData.get('name') || document.getElementById('event-name').value,
        date: new Date(document.getElementById('event-date').value).toISOString(),
        capacity: parseInt(document.getElementById('event-capacity').value) || 0,
        entry_fee: parseFloat(document.getElementById('event-fee').value) || 0,
        description: document.getElementById('event-description').value || null
    };
    
    showLoading();
    try {
        const response = await apiRequest(
            eventId ? `/api/events/${eventId}` : '/api/events',
            {
                method: eventId ? 'PATCH' : 'POST',
                body: JSON.stringify(data)
            }
        );
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save event');
        }
        
        closeModal('event-modal');
        loadEvents();
        showToast(eventId ? 'Wydarzenie zaktualizowane!' : 'Wydarzenie dodane!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteEvent(eventId) {
    if (!confirm('Czy na pewno chcesz usunąć to wydarzenie? Wszystkie powiązane koszty i przychody zostaną również usunięte.')) {
        return;
    }
    
    showLoading();
    try {
        const response = await apiRequest(`/api/events/${eventId}`, { method: 'DELETE' });
        
        if (!response.ok) {
            throw new Error('Failed to delete event');
        }
        
        loadEvents();
        showToast('Wydarzenie usunięte!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== COSTS ====================
async function loadCosts() {
    showLoading();
    try {
        const [costsRes, eventsRes] = await Promise.all([
            apiRequest('/api/costs'),
            apiRequest('/api/events')
        ]);
        
        const costsData = await costsRes.json();
        const eventsData = await eventsRes.json();
        
        costs = costsData.costs || [];
        events = eventsData.events || [];
        
        // Stats
        document.getElementById('costs-stats').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon accent"><i class="fas fa-receipt"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Łączne koszty</div>
                    <div class="stat-value">${formatCurrency(costsData.total_amount || 0)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon primary"><i class="fas fa-list"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Liczba wpisów</div>
                    <div class="stat-value">${costsData.total || 0}</div>
                </div>
            </div>
        `;
        
        // Update event selects
        updateEventSelects();
        
        if (costs.length === 0) {
            document.getElementById('costs-table').innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">
                        <div class="empty-state">
                            <div class="empty-state-icon"><i class="fas fa-receipt"></i></div>
                            <h4 class="empty-state-title">Brak kosztów</h4>
                            <p class="empty-state-text">Kliknij "Dodaj koszt", aby dodać pierwszy wpis.</p>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            document.getElementById('costs-table').innerHTML = costs.map(cost => {
                const event = events.find(e => e.id === cost.event_id);
                return `
                    <tr>
                        <td>${event?.name || 'N/A'}</td>
                        <td>${getCategoryLabel(cost.category)}</td>
                        <td class="text-danger font-bold">${formatCurrency(cost.amount)}</td>
                        <td>${cost.description || '-'}</td>
                        <td>${formatShortDate(cost.created_at)}</td>
                        <td>
                            ${['owner', 'manager'].includes(currentUser?.role) ? `
                                <button class="btn btn-sm btn-danger" onclick="deleteCost(${cost.id})" title="Usuń">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (error) {
        showToast('Błąd ładowania kosztów', 'error');
    } finally {
        hideLoading();
    }
}

function showCostModal() {
    document.getElementById('cost-form').reset();
    updateEventSelects();
    openModal('cost-modal');
}

async function saveCost() {
    const data = {
        event_id: parseInt(document.getElementById('cost-event').value),
        category: document.getElementById('cost-category').value,
        amount: parseFloat(document.getElementById('cost-amount').value),
        description: document.getElementById('cost-description').value || null
    };
    
    showLoading();
    try {
        const response = await apiRequest('/api/costs', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save cost');
        }
        
        closeModal('cost-modal');
        loadCosts();
        showToast('Koszt dodany!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteCost(costId) {
    if (!confirm('Czy na pewno chcesz usunąć ten koszt?')) return;
    
    showLoading();
    try {
        const response = await apiRequest(`/api/costs/${costId}`, { method: 'DELETE' });
        
        if (!response.ok) throw new Error('Failed to delete cost');
        
        loadCosts();
        showToast('Koszt usunięty!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== REVENUE ====================
async function loadRevenue() {
    showLoading();
    try {
        const [revenueRes, eventsRes] = await Promise.all([
            apiRequest('/api/revenue'),
            apiRequest('/api/events')
        ]);
        
        const revenueData = await revenueRes.json();
        const eventsData = await eventsRes.json();
        
        revenues = revenueData.revenues || [];
        events = eventsData.events || [];
        
        // Stats
        document.getElementById('revenue-stats').innerHTML = `
            <div class="stat-card">
                <div class="stat-icon success"><i class="fas fa-coins"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Łączne przychody</div>
                    <div class="stat-value">${formatCurrency(revenueData.total_amount || 0)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon primary"><i class="fas fa-list"></i></div>
                <div class="stat-content">
                    <div class="stat-label">Liczba wpisów</div>
                    <div class="stat-value">${revenueData.total || 0}</div>
                </div>
            </div>
        `;
        
        // Update event selects
        updateEventSelects();
        
        if (revenues.length === 0) {
            document.getElementById('revenue-table').innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">
                        <div class="empty-state">
                            <div class="empty-state-icon"><i class="fas fa-coins"></i></div>
                            <h4 class="empty-state-title">Brak przychodów</h4>
                            <p class="empty-state-text">Kliknij "Dodaj przychód", aby dodać pierwszy wpis.</p>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            document.getElementById('revenue-table').innerHTML = revenues.map(rev => {
                const event = events.find(e => e.id === rev.event_id);
                return `
                    <tr>
                        <td>${event?.name || 'N/A'}</td>
                        <td>${getSourceLabel(rev.source)}</td>
                        <td class="text-success font-bold">${formatCurrency(rev.amount)}</td>
                        <td>${rev.description || '-'}</td>
                        <td>${formatShortDate(rev.created_at)}</td>
                        <td>
                            ${['owner', 'manager'].includes(currentUser?.role) ? `
                                <button class="btn btn-sm btn-danger" onclick="deleteRevenue(${rev.id})" title="Usuń">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (error) {
        showToast('Błąd ładowania przychodów', 'error');
    } finally {
        hideLoading();
    }
}

function showRevenueModal() {
    document.getElementById('revenue-form').reset();
    updateEventSelects();
    openModal('revenue-modal');
}

async function saveRevenue() {
    const data = {
        event_id: parseInt(document.getElementById('revenue-event').value),
        source: document.getElementById('revenue-source').value,
        amount: parseFloat(document.getElementById('revenue-amount').value),
        description: document.getElementById('revenue-description').value || null
    };
    
    showLoading();
    try {
        const response = await apiRequest('/api/revenue', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save revenue');
        }
        
        closeModal('revenue-modal');
        loadRevenue();
        showToast('Przychód dodany!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteRevenue(revenueId) {
    if (!confirm('Czy na pewno chcesz usunąć ten przychód?')) return;
    
    showLoading();
    try {
        const response = await apiRequest(`/api/revenue/${revenueId}`, { method: 'DELETE' });
        
        if (!response.ok) throw new Error('Failed to delete revenue');
        
        loadRevenue();
        showToast('Przychód usunięty!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== REPORTS ====================
function initReportForm() {
    const today = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    document.getElementById('report-from').value = monthAgo.toISOString().split('T')[0];
    document.getElementById('report-to').value = today.toISOString().split('T')[0];
    document.getElementById('report-results').innerHTML = '';
}

async function generateReport() {
    const dateFrom = document.getElementById('report-from').value;
    const dateTo = document.getElementById('report-to').value;
    
    if (!dateFrom || !dateTo) {
        showToast('Wybierz daty zakresu', 'warning');
        return;
    }
    
    showLoading();
    try {
        const response = await apiRequest(
            `/api/reports/period?date_from=${dateFrom}T00:00:00&date_to=${dateTo}T23:59:59`
        );
        
        if (!response.ok) throw new Error('Failed to generate report');
        
        const report = await response.json();
        
        const resultsHtml = `
            <div class="stats-grid mb-lg">
                <div class="stat-card">
                    <div class="stat-icon primary"><i class="fas fa-calendar-check"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Wydarzenia w okresie</div>
                        <div class="stat-value">${report.total_events}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon accent"><i class="fas fa-arrow-down"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Łączne koszty</div>
                        <div class="stat-value">${formatCurrency(report.total_costs)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon success"><i class="fas fa-arrow-up"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Łączne przychody</div>
                        <div class="stat-value">${formatCurrency(report.total_revenue)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon ${report.net_profit >= 0 ? 'success' : 'accent'}">
                        <i class="fas fa-${report.net_profit >= 0 ? 'chart-line' : 'chart-line'}"></i>
                    </div>
                    <div class="stat-content">
                        <div class="stat-label">Zysk netto (${report.profit_margin}%)</div>
                        <div class="stat-value ${report.net_profit >= 0 ? 'text-success' : 'text-danger'}">
                            ${formatCurrency(report.net_profit)}
                        </div>
                    </div>
                </div>
            </div>
            
            ${report.events.length > 0 ? `
                <div class="card">
                    <div class="card-header">
                        <h3>Szczegóły wydarzeń</h3>
                    </div>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Wydarzenie</th>
                                    <th>Data</th>
                                    <th>Koszty</th>
                                    <th>Przychody</th>
                                    <th>Zysk</th>
                                    <th>Marża</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${report.events.map(e => `
                                    <tr>
                                        <td><strong>${e.event_name}</strong></td>
                                        <td>${formatShortDate(e.event_date)}</td>
                                        <td class="text-danger">${formatCurrency(e.total_costs)}</td>
                                        <td class="text-success">${formatCurrency(e.total_revenue)}</td>
                                        <td class="${e.net_profit >= 0 ? 'text-success' : 'text-danger'} font-bold">
                                            ${formatCurrency(e.net_profit)}
                                        </td>
                                        <td>${e.profit_margin}%</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            ` : `
                <div class="card">
                    <div class="card-body">
                        <div class="empty-state">
                            <div class="empty-state-icon"><i class="fas fa-calendar-times"></i></div>
                            <h4 class="empty-state-title">Brak wydarzeń w tym okresie</h4>
                            <p class="empty-state-text">Wybierz inny zakres dat lub dodaj wydarzenia.</p>
                        </div>
                    </div>
                </div>
            `}
        `;
        
        document.getElementById('report-results').innerHTML = resultsHtml;
        showToast('Raport wygenerowany!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== USERS ====================
async function loadUsers() {
    if (currentUser?.role !== 'owner') {
        document.getElementById('users-table').innerHTML = `
            <tr>
                <td colspan="6" class="text-center">
                    <div class="alert alert-warning">
                        <i class="fas fa-lock"></i>
                        Brak uprawnień do zarządzania użytkownikami
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    showLoading();
    try {
        const response = await apiRequest('/api/users');
        const data = await response.json();
        const users = data.users || [];
        
        document.getElementById('users-table').innerHTML = users.map(user => `
            <tr>
                <td>
                    <div class="flex items-center gap-md">
                        <div class="user-avatar" style="width: 32px; height: 32px; font-size: 0.875rem;">
                            ${user.full_name.charAt(0).toUpperCase()}
                        </div>
                        <strong>${user.full_name}</strong>
                    </div>
                </td>
                <td>${user.email}</td>
                <td>${getRoleBadge(user.role)}</td>
                <td>
                    <span class="badge ${user.is_active ? 'badge-success' : 'badge-danger'}">
                        ${user.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                </td>
                <td>${formatShortDate(user.created_at)}</td>
                <td>
                    <div class="flex gap-sm">
                        <button class="btn btn-sm btn-secondary" onclick="showUserModal(${user.id}, '${user.role}')" title="Zmień rolę">
                            <i class="fas fa-user-edit"></i>
                        </button>
                        ${user.id !== currentUser.id ? `
                            <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})" title="Usuń">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showToast('Błąd ładowania użytkowników', 'error');
    } finally {
        hideLoading();
    }
}

function showUserModal(userId, currentRole) {
    document.getElementById('user-edit-id').value = userId;
    document.getElementById('user-role-select').value = currentRole;
    openModal('user-modal');
}

async function updateUserRole() {
    const userId = document.getElementById('user-edit-id').value;
    const newRole = document.getElementById('user-role-select').value;
    
    showLoading();
    try {
        const response = await apiRequest(`/api/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: newRole })
        });
        
        if (!response.ok) throw new Error('Failed to update user role');
        
        closeModal('user-modal');
        loadUsers();
        showToast('Rola użytkownika zaktualizowana!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteUser(userId) {
    if (!confirm('Czy na pewno chcesz usunąć tego użytkownika?')) return;
    
    showLoading();
    try {
        const response = await apiRequest(`/api/users/${userId}`, { method: 'DELETE' });
        
        if (!response.ok) throw new Error('Failed to delete user');
        
        loadUsers();
        showToast('Użytkownik usunięty!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ==================== HELPERS ====================
function updateEventSelects() {
    const options = events.map(e => `<option value="${e.id}">${e.name} (${formatShortDate(e.date)})</option>`).join('');
    
    document.getElementById('cost-event').innerHTML = '<option value="">Wybierz wydarzenie</option>' + options;
    document.getElementById('revenue-event').innerHTML = '<option value="">Wybierz wydarzenie</option>' + options;
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    // Login form
    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        login(email, password);
    });
    
    // Register form
    document.getElementById('register-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        register(formData.get('full_name'), formData.get('email'), formData.get('password'));
    });
    
    // Event form
    document.getElementById('event-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveEvent(new FormData(e.target));
    });
    
    // Cost form
    document.getElementById('cost-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveCost();
    });
    
    // Revenue form
    document.getElementById('revenue-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveRevenue();
    });
    
    // Report form
    document.getElementById('report-form').addEventListener('submit', (e) => {
        e.preventDefault();
        generateReport();
    });
    
    // User form
    document.getElementById('user-form').addEventListener('submit', (e) => {
        e.preventDefault();
        updateUserRole();
    });
    
    // Mobile menu
    document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('mobile-overlay').classList.toggle('active');
    });
    
    document.getElementById('mobile-overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobile-overlay').classList.remove('active');
    });
    
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
    
    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(modal => {
                modal.classList.remove('active');
            });
        }
    });
    
    // Check authentication on load
    if (accessToken) {
        loadCurrentUser().then(() => {
            if (currentUser) {
                showApp();
            } else {
                showLogin();
            }
        }).catch(() => {
            showLogin();
        });
    } else {
        showLogin();
    }
});
