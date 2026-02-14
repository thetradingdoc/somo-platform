/**
 * Shared Navigation Component
 * Renders navigation sidebar from TENANT_CONFIG.navItems (tenant-aware)
 * Single source of truth for navigation across all pages
 */

function renderNavigation(activeId = null) {
    const navEl = document.getElementById('sidebarNav');
    if (!navEl) {
        console.warn('⚠️ Sidebar nav element not found');
        return;
    }

    // Ensure TENANT_CONFIG exists - use tenant-aware fallback
    const tenantType = (window.TENANT_CONFIG && window.TENANT_CONFIG.tenant_type) || 'clinic';
    const defaultNav = (window.NAV_BY_TENANT && window.NAV_BY_TENANT[tenantType]) || (window.MEDICAL_NAV_ITEMS || []);

    if (!window.TENANT_CONFIG) {
        window.TENANT_CONFIG = {
            tenant_type: tenantType,
            navItems: defaultNav,
            sidebarSubtitle: tenantType === 'shop' ? '24/7 Medical Assistant' : 'Medical Coding Assistant'
        };
    }

    if (!window.TENANT_CONFIG.navItems || !Array.isArray(window.TENANT_CONFIG.navItems)) {
        window.TENANT_CONFIG.navItems = defaultNav;
    }

    // Filter: agent and settings live under profile menu; wallets removed from provider nav
    const navItems = window.TENANT_CONFIG.navItems.filter(
      item => item.id !== 'settings' && item.id !== 'wallets'
    );

    // Determine active item if not provided
    if (!activeId) {
        const currentPath = window.location.pathname;
        const currentFile = currentPath.split('/').pop() || 'business-dashboard.html';
        const urlParams = new URLSearchParams(window.location.search);
        const section = urlParams.get('section');

        if (currentFile === 'billing.html' && section) {
            const sectionToNavId = { scan: 'claims', invoices: 'billing', claims: 'claims', overview: 'billing', payments: 'billing', commerce: 'billing' };
            if (sectionToNavId[section] && navItems.some(item => item.id === sectionToNavId[section])) {
                activeId = sectionToNavId[section];
            }
        }
        if (!activeId) {
            const matchingItem = navItems.find(item => {
                const itemHref = item.href.split('/').pop() || '';
                const itemFile = (itemHref.split('?')[0] || '').toLowerCase();
                return itemFile === currentFile.toLowerCase() || currentFile.toLowerCase().includes(item.id);
            });
            if (matchingItem) activeId = matchingItem.id;
        }
    }

    // Resolve hrefs - use absolute path when in subdir (e.g. /business/provider/)
    const resolveHref = (href) => {
        if (typeof window.resolveBusinessPath === 'function') {
            return window.resolveBusinessPath(href);
        }
        return href;
    };

    navEl.innerHTML = navItems.map(item => {
        const isActive = item.id === activeId;
        const href = resolveHref(item.href);
        return `
            <a href="${href}" class="nav-item ${isActive ? 'active' : ''}">
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
    const resolve = (p) => (typeof window.resolveBusinessPath === 'function' ? window.resolveBusinessPath(p) : p);
    menu.innerHTML = `
        <a href="${resolve('settings.html')}" style="display:block;padding:10px 16px;color:#1f2937;text-decoration:none;">⚙️ Profile & Settings</a>
        <a href="${resolve('agent.html')}" style="display:block;padding:10px 16px;color:#1f2937;text-decoration:none;">🎙️ Voice Agent</a>
        <a href="${resolve('billing.html?section=invoices')}" style="display:block;padding:10px 16px;color:#1f2937;text-decoration:none;">🧾 Usage & Invoices</a>
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

