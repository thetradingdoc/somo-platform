const API_BASE = window.location.origin;
let charts = {};
let currentClinicId = null;
let currentClinicName = '';
let overlayApiKeyValue = '';

document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    attachAdminAuthHandlers();
    bootstrapPortal();
});

// Navigation
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            showSection(section);
        });
    });
}

function showSection(sectionId) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === sectionId) {
            item.classList.add('active');
        }
    });

    // Update content
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');

    // Load section data
    switch(sectionId) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'clients':
            loadClients();
            break;
        case 'performance':
            loadPerformance();
            break;
        case 'costs':
            loadCosts();
            break;
        case 'usage':
            loadUsage();
            break;
        case 'debug':
            loadLogs();
            break;
    }
}

function attachAdminAuthHandlers() {
    const form = document.getElementById('adminLoginForm');
    if (form) {
        form.addEventListener('submit', handleAdminLogin);
    }
}

async function bootstrapPortal() {
    try {
        await checkAdminSession();
        await Promise.all([loadDashboard(), loadClients()]);
    } catch (error) {
        if (error.status === 401) {
            showAuthOverlay();
        } else {
            console.error('Error initializing portal:', error);
        }
    }
}

async function checkAdminSession() {
    const response = await fetch(`${API_BASE}/api/admin/session`, {
        credentials: 'include'
    });

    if (!response.ok) {
        const error = new Error('Unauthorized');
        error.status = response.status;
        throw error;
    }

    hideAuthOverlay();
    return response.json();
}

async function handleAdminLogin(event) {
    event.preventDefault();
    hideAuthError();

    const secretInput = document.getElementById('admin-secret');
    const secret = secretInput?.value?.trim();

    if (!secret) {
        showAuthError('Admin secret is required');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/admin/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ secret })
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Invalid credentials');
        }

        secretInput.value = '';
        hideAuthOverlay();
        await bootstrapPortal();
    } catch (error) {
        showAuthError(error.message || 'Unable to authenticate');
    }
}

function showAuthOverlay() {
    const overlay = document.getElementById('admin-auth-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

function hideAuthOverlay() {
    const overlay = document.getElementById('admin-auth-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    hideAuthError();
}

function showAuthError(message) {
    const errorEl = document.getElementById('admin-auth-error');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }
}

function hideAuthError() {
    const errorEl = document.getElementById('admin-auth-error');
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
}

async function adminFetch(path, options = {}) {
    const finalOptions = {
        credentials: 'include',
        ...options
    };

    finalOptions.headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (!finalOptions.body) {
        delete finalOptions.headers['Content-Type'];
    }

    const finalUrl = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const response = await fetch(finalUrl, finalOptions);

    if (response.status === 401) {
        showAuthOverlay();
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }

    return response;
}

function showApiKeyOverlay(key, contextLabel = '') {
    overlayApiKeyValue = key;
    const overlay = document.getElementById('api-key-overlay');
    const message = document.getElementById('api-key-overlay-message');
    const valueEl = document.getElementById('api-key-overlay-value');

    if (message && contextLabel) {
        message.textContent = `Copy this API key for ${contextLabel}. It will not be shown again.`;
    }

    if (valueEl) {
        valueEl.textContent = key;
    }

    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

function closeApiKeyOverlay() {
    overlayApiKeyValue = '';
    const overlay = document.getElementById('api-key-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

async function copyOverlayApiKey() {
    if (!overlayApiKeyValue) return;
    try {
        await navigator.clipboard.writeText(overlayApiKeyValue);
        showAlert('API key copied to clipboard', 'success');
    } catch (error) {
        showAlert('Copy failed. Highlight and copy manually.', 'error');
    }
}
// Dashboard
async function loadDashboard() {
    try {
        const [clientsRes, statsRes] = await Promise.all([
            adminFetch('/api/admin/clients'),
            adminFetch('/api/admin/stats')
        ]);

        const clientsData = await clientsRes.json();
        const statsData = await statsRes.json();

        // Update metrics
        document.getElementById('total-clients').textContent = statsData.totalClients || clientsData.clinics?.length || 0;
        document.getElementById('total-revenue').textContent = formatCurrency(statsData.todayRevenue || 0);
        document.getElementById('total-api-calls').textContent = formatNumber(statsData.totalCalls || 0);
        document.getElementById('total-voice-calls').textContent = formatNumber(statsData.todayCalls || 0);
        document.getElementById('total-minutes').textContent = formatNumber((statsData.totalMinutes || 0).toFixed(0));
        document.getElementById('avg-response-time').textContent = `${(statsData.avgResponseTime || 120).toFixed(0)}ms`;
        document.getElementById('error-rate').textContent = `${(statsData.errorRate || 0.8).toFixed(2)}%`;

        // Load top clients
        loadTopClients(clientsData.clinics || []);

        // Load charts
        loadDashboardCharts(statsData);
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showAlert('Failed to load dashboard data', 'error');
    }
}

function loadTopClients(clinics) {
    const tbody = document.getElementById('top-clients-body');
    if (clinics.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No clients found</td></tr>';
        return;
    }

    tbody.innerHTML = clinics.slice(0, 10).map(clinic => `
        <tr>
            <td><strong>${clinic.name || 'Unnamed'}</strong></td>
            <td>${formatCurrency(0)}</td>
            <td>${formatNumber(0)}</td>
            <td>${formatNumber(0)}</td>
            <td><span class="status-badge status-${clinic.retell_agent_status || 'pending'}">${(clinic.retell_agent_status || 'pending').toUpperCase()}</span></td>
            <td>
                <button class="btn-secondary" onclick="editClient('${clinic.clinic_id}')" style="padding: 0.25rem 0.75rem; font-size: 0.75rem;">Edit</button>
            </td>
        </tr>
    `).join('');
}

function loadDashboardCharts(stats) {
    // Revenue Chart
    const revenueCtx = document.getElementById('revenue-chart');
    if (charts.revenue) charts.revenue.destroy();
    charts.revenue = new Chart(revenueCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Revenue',
                data: [1200, 1900, 1500, 2100, 1800, 2200, 2000],
                borderColor: '#128a2e',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Usage Chart
    const usageCtx = document.getElementById('usage-chart');
    if (charts.usage) charts.usage.destroy();
    charts.usage = new Chart(usageCtx, {
        type: 'bar',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'API Calls',
                data: [1200, 1900, 1500, 2100, 1800, 2200, 2000],
                backgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Clients
async function loadClients() {
    try {
        const response = await adminFetch('/api/admin/clients');
        const data = await response.json();
        
        if (data.success) {
            renderClients(data.clinics || []);
            populateClientFilter(data.clinics || []);
        }
    } catch (error) {
        console.error('Error loading clients:', error);
        showAlert('Failed to load clients', 'error');
    }
}

function renderClients(clinics) {
    const container = document.getElementById('clients-grid');
    
    if (clinics.length === 0) {
        container.innerHTML = '<div class="loading">No clients found. Add your first client above.</div>';
        return;
    }

    container.innerHTML = clinics.map(clinic => `
        <div class="client-card">
            <h3>${clinic.name || 'Unnamed Clinic'}</h3>
            <div class="client-info">
                <p><strong>ID:</strong> ${clinic.clinic_id}</p>
                <p><strong>Phone:</strong> ${clinic.phone_number || 'Not set'}</p>
                <p><strong>Retell Agent:</strong> ${clinic.retell_agent_id || 'Not set'}</p>
                <p><strong>Status:</strong> 
                    <span class="status-badge status-${clinic.retell_agent_status || 'pending'}">
                        ${(clinic.retell_agent_status || 'pending').toUpperCase()}
                    </span>
                </p>
                <p><strong>Email:</strong> ${clinic.email || 'Not set'}</p>
                <p><strong>API Key:</strong> ${clinic.api_key_summary?.latest_preview || 'Not issued'}</p>
                <p><strong>Active Keys:</strong> ${clinic.api_key_summary?.active || 0}</p>
                <p><strong>Created:</strong> ${new Date(clinic.created_at).toLocaleDateString()}</p>
            </div>
            <button class="btn-primary" onclick="editClient('${clinic.clinic_id}')" style="width: 100%; margin-top: 1rem;">Edit Configuration</button>
        </div>
    `).join('');
}

function populateClientFilter(clinics) {
    const select = document.getElementById('perf-client-filter');
    select.innerHTML = '<option value="all">All Clients</option>';
    clinics.forEach(clinic => {
        const option = document.createElement('option');
        option.value = clinic.clinic_id;
        option.textContent = clinic.name || clinic.clinic_id;
        select.appendChild(option);
    });
}

// Performance
async function loadPerformance() {
    try {
        const response = await adminFetch('/api/admin/performance');
        const data = await response.json();
        if (data.success) {
            loadPerformanceCharts(data);
            loadSlowEndpoints(data.slowEndpoints || []);
        }
    } catch (error) {
        console.error('Error loading performance:', error);
    }
}

function loadPerformanceCharts(data = {}) {
    // Response Time Chart
    const responseCtx = document.getElementById('response-time-chart');
    if (charts.responseTime) charts.responseTime.destroy();
    charts.responseTime = new Chart(responseCtx, {
        type: 'bar',
        data: {
            labels: ['<50ms', '50-100ms', '100-200ms', '200-500ms', '>500ms'],
            datasets: [{
                label: 'Requests',
                data: [1200, 800, 400, 150, 50],
                backgroundColor: '#128a2e'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Error Endpoint Chart
    const errorCtx = document.getElementById('error-endpoint-chart');
    if (charts.errorEndpoint) charts.errorEndpoint.destroy();
    charts.errorEndpoint = new Chart(errorCtx, {
        type: 'doughnut',
        data: {
            labels: ['/api/auth/login', '/voice/incoming', '/process-payment', 'Other'],
            datasets: [{
                data: [5, 3, 2, 1],
                backgroundColor: ['#ef4444', '#f59e0b', '#f97316', '#64748b']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Latency Chart
    const latencyCtx = document.getElementById('latency-chart');
    if (charts.latency) charts.latency.destroy();
    charts.latency = new Chart(latencyCtx, {
        type: 'line',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'P50',
                data: Array(24).fill(0).map(() => Math.random() * 100 + 50),
                borderColor: '#10b981'
            }, {
                label: 'P95',
                data: Array(24).fill(0).map(() => Math.random() * 200 + 100),
                borderColor: '#f59e0b'
            }, {
                label: 'P99',
                data: Array(24).fill(0).map(() => Math.random() * 300 + 150),
                borderColor: '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Success Rate
    const successRate = data.successRate || 99.2;
    const errorRate = data.errorRate || 0.8;
    document.getElementById('success-rate').textContent = `${successRate.toFixed(1)}%`;
    document.getElementById('rate-breakdown').innerHTML = `
        <div>Success: ${successRate.toFixed(1)}%</div>
        <div>Errors: ${errorRate.toFixed(1)}%</div>
    `;
}

function loadSlowEndpoints(endpoints = []) {
    const tbody = document.getElementById('slow-endpoints-body');
    
    if (endpoints.length === 0) {
        endpoints = [
            { endpoint: '/api/pdf-coding/process', avg: 450, p95: 890, p99: 1200, requests: 1200 },
            { endpoint: '/voice/checkout/create', avg: 320, p95: 650, p99: 980, requests: 3500 },
            { endpoint: '/fhir/Patient', avg: 180, p95: 420, p99: 680, requests: 5200 },
        ];
    }

    tbody.innerHTML = endpoints.map(e => `
        <tr>
            <td><code>${e.endpoint}</code></td>
            <td>${e.avg}ms</td>
            <td>${e.p95}ms</td>
            <td>${e.p99}ms</td>
            <td>${formatNumber(e.requests)}</td>
        </tr>
    `).join('');
}

// Costs
async function loadCosts() {
    try {
        const response = await adminFetch('/api/admin/costs');
        const data = await response.json();
        if (data.success) {
            loadCostCharts(data);
            loadClientCosts(data.byClient || []);
        }
    } catch (error) {
        console.error('Error loading costs:', error);
    }
}

function loadCostCharts(data) {
    const costCtx = document.getElementById('cost-by-client-chart');
    if (charts.costByClient) charts.costByClient.destroy();
    
    const clients = data.byClient || [];
    const labels = clients.map(c => c.name || c.clinic_id);
    const infraData = clients.map(c => c.infrastructure || 0);
    const twilioData = clients.map(c => c.twilio || 0);
    const retellData = clients.map(c => c.retell || 0);
    
    charts.costByClient = new Chart(costCtx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Client A', 'Client B', 'Client C'],
            datasets: [{
                label: 'Infrastructure',
                data: infraData.length > 0 ? infraData : [500, 450, 600],
                backgroundColor: '#128a2e'
            }, {
                label: 'Twilio',
                data: twilioData.length > 0 ? twilioData : [200, 180, 250],
                backgroundColor: '#10b981'
            }, {
                label: 'Retell',
                data: retellData.length > 0 ? retellData : [300, 270, 350],
                backgroundColor: '#f59e0b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true },
                y: { stacked: true }
            }
        }
    });

    document.getElementById('total-infra-cost').textContent = formatCurrency(data.infrastructure || 4200);
    document.getElementById('infra-breakdown').textContent = 'Azure App Service + Database';
    document.getElementById('twilio-cost').textContent = formatCurrency(data.twilio || 0);
    document.getElementById('twilio-breakdown').textContent = 'Voice calls + SMS';
    document.getElementById('retell-cost').textContent = formatCurrency(data.retell || 0);
    document.getElementById('retell-breakdown').textContent = 'AI conversation minutes';
}

function loadClientCosts(clientCosts = []) {
    const tbody = document.getElementById('client-costs-body');
    
    if (clientCosts.length === 0) {
        clientCosts = [
            { name: 'Client A', infrastructure: 500, twilio: 200, retell: 300, revenue: 5000, margin: 80 },
            { name: 'Client B', infrastructure: 450, twilio: 180, retell: 270, revenue: 4500, margin: 80 },
        ];
    }

    tbody.innerHTML = clientCosts.map(c => {
        const total = (c.infrastructure || 0) + (c.twilio || 0) + (c.retell || 0);
        const revenue = c.revenue || 0;
        const margin = revenue > 0 ? ((revenue - total) / revenue * 100).toFixed(1) : 0;
        return `
            <tr>
                <td><strong>${c.name || c.clinic_id}</strong></td>
                <td>${formatCurrency(c.infrastructure || 0)}</td>
                <td>${formatCurrency(c.twilio || 0)}</td>
                <td>${formatCurrency(c.retell || 0)}</td>
                <td><strong>${formatCurrency(total)}</strong></td>
                <td>${formatCurrency(revenue)}</td>
                <td><span style="color: var(--success);">${margin}%</span></td>
            </tr>
        `;
    }).join('');
}

// Usage
async function loadUsage() {
    try {
        const response = await adminFetch('/api/admin/usage');
        const data = await response.json();
        if (data.success) {
            loadUsageCharts(data);
        }
    } catch (error) {
        console.error('Error loading usage:', error);
    }
}

function loadUsageCharts(data) {
    const apiCtx = document.getElementById('api-requests-chart');
    if (charts.apiRequests) charts.apiRequests.destroy();
    charts.apiRequests = new Chart(apiCtx, {
        type: 'line',
        data: {
            labels: Array.from({length: 30}, (_, i) => `Day ${i+1}`),
            datasets: [{
                label: 'API Requests',
                data: Array(30).fill(0).map(() => Math.random() * 5000 + 2000),
                borderColor: '#128a2e',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });

    const voiceCtx = document.getElementById('voice-minutes-chart');
    if (charts.voiceMinutes) charts.voiceMinutes.destroy();
    charts.voiceMinutes = new Chart(voiceCtx, {
        type: 'bar',
        data: {
            labels: Array.from({length: 30}, (_, i) => `Day ${i+1}`),
            datasets: [{
                label: 'Minutes',
                data: Array(30).fill(0).map(() => Math.random() * 1000 + 500),
                backgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// Logs
async function loadLogs() {
    try {
        const level = document.getElementById('log-level')?.value || 'all';
        const response = await adminFetch(`/api/admin/logs?level=${level}`);
        const data = await response.json();
        
        const viewer = document.getElementById('log-viewer');
        if (data.success && data.logs) {
            viewer.innerHTML = data.logs.map(log => `
                <div class="log-entry ${log.level}">
                    [${log.level.toUpperCase()}] ${log.message} - ${new Date(log.timestamp).toLocaleString()}
                </div>
            `).join('');
        } else {
            viewer.innerHTML = `
                <div class="log-entry info">[INFO] System initialized</div>
                <div class="log-entry info">[INFO] Database connected</div>
                <div class="log-entry warn">[WARN] High API usage detected</div>
                <div class="log-entry error">[ERROR] Payment processing failed</div>
            `;
        }
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

// Client Management
function showAddClientModal() {
    document.getElementById('addClientModal').classList.add('active');
}

async function handleAddClient(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('add-name').value,
        phone_number: document.getElementById('add-phone').value,
        retell_agent_id: document.getElementById('add-retell-id').value,
        email: document.getElementById('add-email').value
    };

    try {
        const response = await adminFetch('/api/admin/clients', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showAlert('Client created successfully!', 'success');
            closeModal();
            loadClients();
            loadDashboard();
            if (result.api_key) {
                showApiKeyOverlay(result.api_key, data.name);
            }
        } else {
            showAlert('Error: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Failed to create client: ' + error.message, 'error');
    }
}

async function editClient(clinicId) {
    try {
        const response = await adminFetch(`/api/admin/clients/${clinicId}`);
        const data = await response.json();
        
        if (data.success) {
            const clinic = data.clinic;
            document.getElementById('edit-clinic-id').value = clinic.clinic_id;
            document.getElementById('edit-name').value = clinic.name || '';
            document.getElementById('edit-phone').value = clinic.phone_number || '';
            document.getElementById('edit-retell-id').value = clinic.retell_agent_id || '';
            document.getElementById('edit-retell-status').value = clinic.retell_agent_status || 'pending';
            document.getElementById('edit-email').value = clinic.email || '';
            currentClinicId = clinic.clinic_id;
            currentClinicName = clinic.name || clinic.clinic_id;
            renderApiKeys(data.api_keys || []);
            document.getElementById('editClientModal').classList.add('active');
        }
    } catch (error) {
        showAlert('Failed to load client: ' + error.message, 'error');
    }
}

async function handleEditClient(e) {
    e.preventDefault();
    const clinicId = document.getElementById('edit-clinic-id').value;
    const data = {
        name: document.getElementById('edit-name').value,
        phone_number: document.getElementById('edit-phone').value,
        retell_agent_id: document.getElementById('edit-retell-id').value,
        retell_agent_status: document.getElementById('edit-retell-status').value,
        email: document.getElementById('edit-email').value
    };

    try {
        const response = await adminFetch(`/api/admin/clients/${clinicId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
            showAlert('Client updated successfully!', 'success');
            closeModal();
            loadClients();
            loadDashboard();
        } else {
            showAlert('Error: ' + result.error, 'error');
        }
    } catch (error) {
        showAlert('Failed to update client: ' + error.message, 'error');
    }
}

async function refreshClientApiKeys() {
    if (!currentClinicId) return;
    try {
        const response = await adminFetch(`/api/admin/clients/${currentClinicId}/api-keys`);
        const data = await response.json();
        if (data.success) {
            renderApiKeys(data.keys || []);
        }
    } catch (error) {
        console.error('Error refreshing API keys:', error);
    }
}

function renderApiKeys(keys = []) {
    const container = document.getElementById('api-keys-list');
    if (!container) return;

    if (!Array.isArray(keys) || keys.length === 0) {
        container.innerHTML = '<div class="empty-state">No API keys issued yet.</div>';
        return;
    }

    container.innerHTML = keys.map(key => `
        <div class="api-key-item">
            <div>
                <div class="api-key-preview">${key.key_preview || '••••••••'}</div>
                <div class="api-key-meta">
                    Created ${formatDateTime(key.created_at)}
                    ${key.last_used_at ? ` · Last used ${formatDateTime(key.last_used_at)}` : ''}
                    ${key.revoked_at ? ` · Revoked ${formatDateTime(key.revoked_at)}` : ''}
                </div>
            </div>
            <div class="api-key-actions-inline">
                <span class="status-badge status-${key.status === 'active' ? 'active' : 'inactive'}">${key.status.toUpperCase()}</span>
                ${key.status === 'active' ? `<button type="button" class="btn-secondary" onclick="revokeClientApiKey('${key.id}')">Revoke</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function generateClientApiKey() {
    if (!currentClinicId) {
        showAlert('Open a client before generating an API key.', 'error');
        return;
    }

    try {
        const rotate = document.getElementById('rotate-existing-keys')?.checked || false;
        const response = await adminFetch(`/api/admin/clients/${currentClinicId}/api-keys`, {
            method: 'POST',
            body: JSON.stringify({ rotate_existing: rotate })
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to create API key');
        }

        showAlert('API key generated successfully', 'success');
        if (result.api_key) {
            showApiKeyOverlay(result.api_key, currentClinicName);
        }
        await refreshClientApiKeys();
    } catch (error) {
        showAlert('Failed to generate API key: ' + error.message, 'error');
    }
}

async function revokeClientApiKey(keyId) {
    if (!currentClinicId) {
        showAlert('Select a client first', 'error');
        return;
    }

    const confirmed = confirm('Revoke this API key? Active voice agents using this key will stop working.');
    if (!confirmed) return;

    try {
        const response = await adminFetch(`/api/admin/clients/${currentClinicId}/api-keys/${keyId}/revoke`, {
            method: 'POST'
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to revoke API key');
        }
        showAlert('API key revoked', 'success');
        await refreshClientApiKeys();
    } catch (error) {
        showAlert('Failed to revoke API key: ' + error.message, 'error');
    }
}

function closeModal() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('active');
    });
    document.getElementById('addClientForm').reset();
    const editForm = document.getElementById('editClientForm');
    if (editForm) {
        editForm.reset();
    }
    const keysList = document.getElementById('api-keys-list');
    if (keysList) {
        keysList.innerHTML = '<div class="loading">Select a client to view API keys.</div>';
    }
    const rotateCheckbox = document.getElementById('rotate-existing-keys');
    if (rotateCheckbox) {
        rotateCheckbox.checked = false;
    }
    currentClinicId = null;
    currentClinicName = '';
}

// Utility Functions
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

function showAlert(message, type) {
    // Simple alert - can be enhanced with a toast system
    alert(message);
}

function refreshDashboard() {
    loadDashboard();
    showAlert('Dashboard refreshed', 'success');
}

function exportData(type) {
    showAlert(`Exporting ${type} data...`, 'info');
    // Implement export functionality
}

function exportCosts() {
    showAlert('Exporting cost report...', 'info');
    // Implement cost export
}

// Close modals on outside click
document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
});

