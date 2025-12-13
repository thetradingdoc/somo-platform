/**
 * Shared Navigation Component
 * Renders navigation sidebar from TENANT_CONFIG.navItems
 * Single source of truth for navigation across all pages
 */

function renderNavigation(activeId = null) {
    const navEl = document.getElementById('sidebarNav');
    if (!navEl) {
        console.warn('⚠️ Sidebar nav element not found');
        return;
    }

    // Ensure TENANT_CONFIG exists, use fallback if not
    if (!window.TENANT_CONFIG) {
        console.warn('⚠️ TENANT_CONFIG not available, using defaults');
        window.TENANT_CONFIG = {
            tenant_type: 'shop',
            navItems: [
                { id: 'dashboard', label: 'Dashboard', icon: '📊', href: 'business-dashboard.html' },
                { id: 'products', label: 'Products', icon: '📦', href: 'products.html' },
                { id: 'orders', label: 'Orders', icon: '🛒', href: 'orders.html' },
                { id: 'patients', label: 'Customers', icon: '👥', href: 'patients.html' },
                { id: 'billing', label: 'Billing', icon: '💳', href: 'billing.html' }
            ],
            sidebarSubtitle: 'Cannabis E-Commerce'
        };
    }

    // Ensure navItems exists and is an array
    if (!window.TENANT_CONFIG.navItems || !Array.isArray(window.TENANT_CONFIG.navItems)) {
        console.warn('⚠️ navItems missing or invalid, using defaults');
        window.TENANT_CONFIG.navItems = [
            { id: 'dashboard', label: 'Dashboard', icon: '📊', href: 'business-dashboard.html' },
            { id: 'products', label: 'Products', icon: '📦', href: 'products.html' },
            { id: 'orders', label: 'Orders', icon: '🛒', href: 'orders.html' },
            { id: 'patients', label: 'Customers', icon: '👥', href: 'patients.html' },
            { id: 'billing', label: 'Billing', icon: '💳', href: 'billing.html' }
        ];
    }

    // Remove items that should live under profile/footer
    window.TENANT_CONFIG.navItems = window.TENANT_CONFIG.navItems.filter(item => item.id !== 'agent' && item.id !== 'settings');

    // Determine active item if not provided
    if (!activeId) {
        const currentPath = window.location.pathname;
        const currentFile = currentPath.split('/').pop() || 'business-dashboard.html';

        // Find matching nav item
        const matchingItem = window.TENANT_CONFIG.navItems.find(item => {
            const itemFile = item.href.split('/').pop();
            return itemFile === currentFile || currentFile.includes(item.id);
        });

        if (matchingItem) {
            activeId = matchingItem.id;
        }
    }

    // Filter out items that should live under profile/footer
    const filteredNavItems = (window.TENANT_CONFIG.navItems || []).filter(item => item.id !== 'agent' && item.id !== 'settings');

    // Render navigation items
    navEl.innerHTML = filteredNavItems.map(item => {
        const isActive = item.id === activeId;
        return `
            <a href="${item.href}" class="nav-item ${isActive ? 'active' : ''}">
                <span class="nav-icon">${item.icon}</span>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');

    // Update sidebar subtitle if available
    const subtitleEl = document.querySelector('.sidebar-subtitle');
    if (subtitleEl && window.TENANT_CONFIG.sidebarSubtitle) {
        subtitleEl.textContent = window.TENANT_CONFIG.sidebarSubtitle;
    }

    // Initialize profile/footer menu if present
    initProfileMenu();
}

// Auto-render on DOMContentLoaded if script is included
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Wait a bit for TENANT_CONFIG to be loaded by config.js
        setTimeout(() => renderNavigation(), 100);
    });
} else {
    // DOM already loaded
    setTimeout(() => renderNavigation(), 100);
}

// Profile/footer menu for Settings and Voice Agent
function initProfileMenu() {
    const footerUser = document.querySelector('.sidebar-footer .user-info');
    if (!footerUser || footerUser.dataset.profileMenuAttached === 'true') return;
    footerUser.dataset.profileMenuAttached = 'true';

    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    menu.style.bottom = '70px';
    menu.style.left = '16px';
    menu.style.background = 'white';
    menu.style.border = '1px solid #e2e8f0';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
    menu.style.padding = '8px 0';
    menu.style.minWidth = '180px';
    menu.style.display = 'none';
    menu.style.zIndex = '2000';
    menu.innerHTML = `
        <a href="settings.html" style="display:block;padding:10px 16px;color:#1f2937;text-decoration:none;">⚙️ Profile & Settings</a>
        <a href="agent.html" style="display:block;padding:10px 16px;color:#1f2937;text-decoration:none;">🎙️ Voice Agent</a>
    `;
    document.body.appendChild(menu);

    function closeMenu() {
        menu.style.display = 'none';
    }

    footerUser.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !footerUser.contains(e.target)) {
            closeMenu();
        }
    });
}

