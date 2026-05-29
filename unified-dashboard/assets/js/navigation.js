/**
 * Legacy navigation for static sidebars (pre–Somo shell).
 * Provider pages use provider-shell.js + mountProviderPage() instead.
 * Renders navigation sidebar from TENANT_CONFIG.navItems (tenant-aware).
 */

function renderNavigation(activeId = null) {
    if (document.getElementById('ppSidebarNav')) {
        if (typeof window.renderProviderSidebar === 'function' && activeId) {
            window.renderProviderSidebar(activeId);
        }
        return;
    }
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
            sidebarSubtitle: tenantType === 'shop' ? '24/7 Medical Assistant' : "Doctor's Portal"
        };
    }

    if (!window.TENANT_CONFIG.navItems || !Array.isArray(window.TENANT_CONFIG.navItems)) {
        window.TENANT_CONFIG.navItems = defaultNav;
    }

    // Keep settings fallback when profile is not present.
    const rawNavItems = Array.isArray(window.TENANT_CONFIG.navItems) ? window.TENANT_CONFIG.navItems : [];
    const hasProfileTab = rawNavItems.some((item) => item && item.id === 'profile');
    const navItems = rawNavItems.filter((item) => {
      if (!item) return false;
      if (item.id === 'settings' && hasProfileTab) return false;
      return true;
    });

    // Determine active item if not provided
    if (!activeId) {
        const currentPath = window.location.pathname;
        const currentFile = currentPath.split('/').pop() || 'today.html';
        const urlParams = new URLSearchParams(window.location.search);
        const section = urlParams.get('section');

        if (currentFile === 'today.html') {
            activeId = 'today';
        }
        if (currentFile === 'claims.html' && navItems.some((item) => item.id === 'claims')) {
            activeId = 'claims';
        }
        if (currentFile === 'agent.html' && navItems.some((item) => item.id === 'agent')) {
            activeId = 'agent';
        }
        if (currentFile === 'billing.html' && section) {
            const sectionToNavId = { scan: 'claims', invoices: 'billing', claims: 'claims', overview: 'claims', payments: 'billing', commerce: 'billing' };
            if (sectionToNavId[section] && navItems.some(item => item.id === sectionToNavId[section])) {
                activeId = sectionToNavId[section];
            }
        }
        if (!activeId && currentFile === 'invoice-detail.html' && navItems.some(item => item.id === 'billing')) {
            activeId = 'billing';
        }
        if (!activeId && currentFile === 'business-dashboard.html' && navItems.some(item => item.id === 'today')) {
            activeId = 'today';
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

    const normalizeIconKey = (icon) => {
        const raw = String(icon || '').trim();
        const byEmoji = {
            '🏠': 'home',
            '📊': 'chart-bar',
            '📅': 'calendar-days',
            '👥': 'user-group',
            '👤': 'user',
            '⚙️': 'user',
            '💳': 'wallet',
            '📋': 'clipboard-document-list',
            '💰': 'banknotes',
            '🎥': 'video-camera',
            '📹': 'video-camera'
        };
        return byEmoji[raw] || raw;
    };

    navEl.innerHTML = navItems.map(item => {
        const isActive = item.id === activeId;
        const href = resolveHref(item.href);
        const normalizedIcon = normalizeIconKey(item.icon);
        const iconHtml = (typeof window.getNavIcon === 'function' ? window.getNavIcon(normalizedIcon) : normalizedIcon) || normalizedIcon;
        return `
            <a href="${href}" class="nav-item ${isActive ? 'active' : ''}">
                <span class="nav-icon nav-icon-svg">${iconHtml}</span>
                <span>${item.id === 'settings' ? 'Profile' : item.label}</span>
            </a>
        `;
    }).join('');

    // Update sidebar subtitle if available
    const subtitleEl = document.querySelector('.sidebar-subtitle');
    if (subtitleEl && window.TENANT_CONFIG.sidebarSubtitle) {
        subtitleEl.textContent = window.TENANT_CONFIG.sidebarSubtitle;
    }

    // Provider portal: dark sidebar + Plus Jakarta when stylesheet loaded
    if (document.body.classList.contains('provider-portal')) {
        const logoEl = document.querySelector('.sidebar-logo');
        if (logoEl) {
            logoEl.style.color = '#fff';
            logoEl.style.fontWeight = '700';
            logoEl.style.fontSize = '13.5px';
            logoEl.style.letterSpacing = '-0.02em';
        }
    } else {
        const logoEl = document.querySelector('.sidebar-logo');
        if (logoEl) {
            logoEl.style.color = '#1d4ed8';
            logoEl.style.fontWeight = '700';
        }
    }

    mountBusinessBottomTabs(activeId, navItems);
    ensureBusinessMobileSidebarControls();

    // Initialize profile/footer menu if present
    initProfileMenu();
}

function ensureBusinessMobileSidebarControls() {
    const pathname = String(window.location.pathname || '');
    if (!pathname.includes('/business/')) return;

    const sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar');
    if (!sidebar) return;
    if (!sidebar.id) sidebar.id = 'sidebar';

    // Inject shared mobile control styles once.
    if (!document.getElementById('businessMobileSidebarStyle')) {
        const style = document.createElement('style');
        style.id = 'businessMobileSidebarStyle';
        style.textContent = `
            .biz-mobile-menu-toggle { display:none; position:fixed; top:16px; left:16px; z-index:1301; background:#1d4ed8; color:#fff; border:none; width:44px; height:44px; border-radius:10px; box-shadow:0 4px 12px rgba(29,78,216,.35); font-size:22px; line-height:1; }
            .biz-sidebar-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:1205; opacity:0; transition:opacity .25s ease; }
            .biz-sidebar-overlay.active { display:block; opacity:1; }
            @media (max-width:768px) {
              .biz-mobile-menu-toggle { display:block; }
              #sidebar { position:fixed !important; left:0; top:0; height:100vh; width:280px; max-width:85vw; transform:translateX(-100%); transition:transform .25s ease; z-index:1210; }
              #sidebar.open { transform:translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    let toggle = document.getElementById('bizMobileMenuToggle');
    if (!toggle) {
        toggle = document.createElement('button');
        toggle.id = 'bizMobileMenuToggle';
        toggle.className = 'biz-mobile-menu-toggle';
        toggle.setAttribute('aria-label', 'Toggle menu');
        toggle.type = 'button';
        toggle.textContent = '☰';
        document.body.appendChild(toggle);
    }

    let overlay = document.getElementById('bizSidebarOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'bizSidebarOverlay';
        overlay.className = 'biz-sidebar-overlay';
        document.body.appendChild(overlay);
    }

    if (toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';

    const close = () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    };
    const open = () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    };

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (sidebar.classList.contains('open')) close();
      else open();
    });
    overlay.addEventListener('click', close);

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (window.innerWidth > 768) return;
      const navItem = target.closest('.nav-item');
      if (navItem) close();
    });
}

function mountBusinessBottomTabs(activeId, navItems = []) {
    const pathname = String(window.location.pathname || '');
    if (!pathname.includes('/business/')) return;

    let tabs = document.getElementById('businessBottomTabs');
    if (!tabs) {
        tabs = document.createElement('nav');
        tabs.id = 'businessBottomTabs';
        tabs.setAttribute('aria-label', 'Doctor mobile navigation');
        tabs.innerHTML = `
            <div class="tabs-inner"></div>
        `;
        document.body.appendChild(tabs);
    }

    if (!document.getElementById('businessBottomTabsStyle')) {
        const style = document.createElement('style');
        style.id = 'businessBottomTabsStyle';
        style.textContent = `
            #businessBottomTabs { display:none; position:fixed; left:0; right:0; bottom:0; z-index:1200; background:#fff; border-top:1px solid #e5e7eb; box-shadow:0 -4px 16px rgba(0,0,0,.08); padding-bottom:max(env(safe-area-inset-bottom),8px); }
            #businessBottomTabs .tabs-inner { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); align-items:center; }
            #businessBottomTabs .tab { text-decoration:none; color:#6b7280; min-height:58px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; font-size:11px; font-weight:600; }
            #businessBottomTabs .tab svg { width:20px; height:20px; stroke-width:2; stroke:currentColor; fill:none; }
            #businessBottomTabs .tab.active { color:#1d4ed8; }
            @media (max-width: 768px) { #businessBottomTabs { display:block; } .main-content { padding-bottom:92px !important; } }
        `;
        document.head.appendChild(style);
    }

    // Keep bottom nav focused and touch-friendly (5 primary actions).
    const findAny = (...ids) => ids.map((id) => navItems.find((n) => n.id === id)).find(Boolean);
    const selected = [];
    selected.push(findAny('today') || { id: 'today', label: 'Today', href: 'today.html' });
    selected.push(findAny('calendar') || { id: 'calendar', label: 'Calendar', href: 'calendar.html' });
    selected.push(findAny('patients') || { id: 'patients', label: 'Patients', href: 'patients.html' });
    selected.push(findAny('billing') || { id: 'billing', label: 'Revenue', href: 'billing.html?section=overview' });
    selected.push(findAny('profile', 'settings') || { id: 'profile', label: 'Profile', href: 'settings.html' });
    const inner = tabs.querySelector('.tabs-inner');
    if (!inner) return;
    // 5 tabs like patient shell.
    inner.style.gridTemplateColumns = `repeat(${Math.max(1, selected.length)}, minmax(0, 1fr))`;
    inner.innerHTML = selected.map((item) => {
        const href = (typeof window.resolveBusinessPath === 'function') ? window.resolveBusinessPath(item.href) : item.href;
        // Force deterministic icon set for bottom bar regardless of tenant payload icon values.
        const iconById = {
          today: 'home',
          dashboard: 'home',
          calendar: 'calendar-days',
          patients: 'user-group',
          billing: 'banknotes',
          profile: 'user',
          settings: 'user'
        };
        const forcedIcon = iconById[item.id] || 'home';
        const iconHtml = (typeof window.getNavIcon === 'function' ? window.getNavIcon(forcedIcon) : forcedIcon) || forcedIcon;
        const isActive = item.id === activeId || ((item.id === 'profile' || item.id === 'settings') && activeId === 'settings');
        const labelMap = { billing: 'Revenue', profile: 'Profile', settings: 'Profile' };
        const label = labelMap[item.id] || item.label;
        return `
            <a class="tab ${isActive ? 'active' : ''}" href="${href}">
                <span class="icon">${iconHtml}</span>
                <span>${label}</span>
            </a>
        `;
    }).join('');
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
    const icon = (name) => (typeof window.getNavIcon === 'function' ? window.getNavIcon(name) : '');
    menu.innerHTML = `
        <a href="${resolve('settings.html')}" style="display:flex;align-items:center;gap:8px;padding:10px 16px;color:#1f2937;text-decoration:none;"><span style="width:16px;height:16px;display:inline-flex;">${icon('user')}</span><span>Profile & Settings</span></a>
        <a href="${resolve('agent.html')}" style="display:flex;align-items:center;gap:8px;padding:10px 16px;color:#1f2937;text-decoration:none;"><span style="width:16px;height:16px;display:inline-flex;">${icon('microphone')}</span><span>Voice Agent</span></a>
        <a href="${resolve('billing.html?section=invoices')}" style="display:flex;align-items:center;gap:8px;padding:10px 16px;color:#1f2937;text-decoration:none;"><span style="width:16px;height:16px;display:inline-flex;">${icon('document-text')}</span><span>Usage & Invoices</span></a>
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

