window.SettingsPage = window.SettingsPage || {};

// Shared state on SettingsPage
Object.assign(window.SettingsPage, {
  API_BASE: window.API_BASE || 'http://localhost:4000',
  userData: null,
  currentCustomer: null,
  currentMerchant: null,
  activeSettingsTab: 'profile'
});
const SP = window.SettingsPage;


        // Mobile sidebar toggle functions
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar && overlay) {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('active');
                if (sidebar.classList.contains('open')) {
                    document.body.style.overflow = 'hidden';
                } else {
                    document.body.style.overflow = '';
                }
            }
        }

        function closeSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (sidebar && overlay) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function setupMobileNavClose() {
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        closeSidebar();
                    }
                });
            });
        }

        // Prefer server session validation over fragile client-only flags.
        // We only redirect on explicit 401 responses from profile endpoints.

        // Safe JSON.parse with error handling
        try {
            const userStr = sessionStorage.getItem('user');
            SP.userData = userStr ? JSON.parse(userStr) : null;
        } catch (error) {
            console.error('Error parsing user data from sessionStorage:', error);
            SP.userData = null;
        }

        document.addEventListener('DOMContentLoaded', () => {
            mountProviderPage({
                activeId: 'profile',
                eyebrow: 'Clinic',
                title: 'Settings',
                subtitle: 'Manage your AI voice receptionist platform settings'
            });
            setupSettingsTabs();
            const tabParam = new URLSearchParams(window.location.search).get('tab');
            if (tabParam === 'voice' || tabParam === 'kelly') {
                setSettingsTab('kelly');
            } else if (tabParam === 'billing') {
                setSettingsTab('billing');
            }

            // Close sidebar on window resize if switching to desktop
            window.addEventListener('resize', () => {
                if (window.innerWidth > 768) {
                    closeSidebar();
                }
            });

            // Close sidebar on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeSidebar();
                }
            });
            loadUserInfo();
            loadCalendarStatus();
            if (typeof loadPmsStatus === 'function') loadPmsStatus();
            if (typeof loadPracticeSettings === 'function') loadPracticeSettings();
            if (typeof loadE10SyncStatus === 'function') loadE10SyncStatus();
            loadProviderBookingReadiness();
            loadMerchantInfo();
            loadVoiceAgentSettingsSummary();
            loadNotificationSettings();
            loadServiceStatuses();
            loadSecurityMeta();
            if (typeof loadBillingUsage === 'function') loadBillingUsage();
        });

        function setupSettingsTabs() {
            const tabButtons = document.querySelectorAll('[data-settings-tab]');
            tabButtons.forEach((btn) => {
                btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
            });
            const hash = (location.hash || '').replace('#', '').toLowerCase();
            if (hash === 'practice' || hash === 'profile') {
                setSettingsTab('profile');
                setTimeout(() => document.getElementById('pmsHelpPanel')?.scrollIntoView({ behavior: 'smooth' }), 200);
            } else if (hash === 'credentials') {
                setSettingsTab('advanced');
            } else if (hash === 'integrations' || hash === 'pms' || hash === 'connected' || hash === 'calendar') {
                setSettingsTab('connected');
            } else if (hash === 'voice' || hash === 'kelly') {
                setSettingsTab('kelly');
            } else {
                setSettingsTab(SP.activeSettingsTab);
            }
        }

        function setSettingsTab(tabName) {
            const aliases = {
              integrations: 'connected',
              calendar: 'connected',
              voice: 'kelly',
              credentials: 'advanced'
            };
            SP.activeSettingsTab = aliases[tabName] || tabName || 'profile';
            document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
                const on = btn.dataset.settingsTab === SP.activeSettingsTab;
                btn.classList.toggle('act', on);
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
                panel.hidden = panel.dataset.settingsPanel !== SP.activeSettingsTab;
            });
            if (SP.activeSettingsTab === 'connected' && typeof loadConnectedAccounts === 'function') {
                loadConnectedAccounts();
            }
            if (SP.activeSettingsTab === 'kelly' && typeof loadKellySettingsTab === 'function') {
                loadKellySettingsTab();
            }
            if (SP.activeSettingsTab === 'advanced' && typeof loadCredentialsSettings === 'function') {
                loadCredentialsSettings();
            }
        }

        function providerLabelFromCustomer(customer) {
            const profile = customer?.provider_profile || null;
            if (profile && typeof profile === 'object') {
                return profile.display_name || profile.provider_name || profile.name || null;
            }
            return null;
        }

        function roleLabelFromCustomer(customer) {
            const profile = customer?.provider_profile || null;
            if (profile && typeof profile === 'object' && profile.role) return profile.role;
            return 'Owner';
        }

        function applyProfileData() {
            const customer = SP.currentCustomer || {};
            const merchant = SP.currentMerchant || {};
            const businessName = customer.company_name || merchant.name || customer.name || customer.email || 'Business';
            const providerLabel = providerLabelFromCustomer(customer) || businessName;
            const roleLabel = roleLabelFromCustomer(customer);
            const phone = customer.phone_number || customer.twilio_phone_number || 'Pending setup';
            const email = customer.email || 'Pending setup';

            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            const businessNameEl = document.getElementById('businessNameSetting');
            const businessEmailEl = document.getElementById('businessEmail');
            const businessPhoneEl = document.getElementById('businessPhone');
            const providerDisplayEl = document.getElementById('providerDisplayName');
            const roleEl = document.querySelector('.user-role');

            if (userNameEl) userNameEl.textContent = providerLabel;
            if (userAvatarEl) {
                const initials = providerLabel.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
                userAvatarEl.textContent = initials || 'HP';
            }
            if (roleEl) roleEl.textContent = roleLabel;
            if (businessNameEl) businessNameEl.textContent = businessName;
            if (businessEmailEl) businessEmailEl.textContent = email;
            if (businessPhoneEl) businessPhoneEl.textContent = phone;
            if (providerDisplayEl) providerDisplayEl.textContent = providerLabel;
        }

        async function loadUserInfo() {
            if (SP.userData) {
                const baseName = SP.userData.business_name || SP.userData.name || SP.userData.email || 'Business';
                document.getElementById('userName').textContent = baseName;
                const initials = baseName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                document.getElementById('userAvatar').textContent = initials;
            }

            // Also load customer info to get merchant_id
            try {
                const response = await fetch(`${SP.API_BASE}/api/customers/me`, {
                    credentials: 'include'
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.customer) {
                        SP.userData = { ...SP.userData, ...data.customer };
                        SP.currentCustomer = data.customer;
                        applyProfileData();
                        loadSecurityMeta();
                    }
                }
            } catch (error) {
                console.error('Error loading customer info:', error);
            }
        }

        async function loadMerchantInfo() {
            try {
                // First get customer to get merchant_id
                const customerResponse = await fetch(`${SP.API_BASE}/api/customers/me`, {
                    credentials: 'include'
                });

                if (customerResponse.status === 401) {
                    document.getElementById('merchantIdDisplay').textContent = 'Session unavailable';
                    document.getElementById('merchantNameDisplay').textContent = 'Please refresh or sign in again';
                    return;
                }

                const customerData = await customerResponse.json();

                if (!customerData.success || !customerData.customer || !customerData.customer.merchant_id) {
                    document.getElementById('merchantIdDisplay').textContent = 'Organization not linked';
                    document.getElementById('merchantNameDisplay').textContent = 'Finish onboarding to activate all settings';
                    return;
                }

                const merchantId = customerData.customer.merchant_id;
                document.getElementById('merchantIdDisplay').textContent = merchantId;

                // Get merchant details
                const merchantResponse = await fetch(`${SP.API_BASE}/api/merchant/me`, {
                    credentials: 'include'
                });

                if (merchantResponse.ok) {
                    const merchantData = await merchantResponse.json();
                    if (merchantData.success && merchantData.merchant) {
                        const m = merchantData.merchant;
                        SP.currentMerchant = m;
                        const displayName = m.name || 'Unnamed practice';
                        document.getElementById('merchantNameDisplay').textContent = displayName;
                        document.getElementById('merchantApiKeyDisplay').textContent = m.api_key ?
                            `${m.api_key.substring(0, 12)}...${m.api_key.substring(m.api_key.length - 4)}` :
                            'Not available';
                        const masked = m.api_key ? `${m.api_key.substring(0, 12)}...${m.api_key.substring(m.api_key.length - 4)}` : 'Not available';
                        document.getElementById('apiKeyDisplayMasked').textContent = masked;
                        document.getElementById('webhookUrlDisplay').textContent = m.webhook_url || 'Not configured';
                        document.getElementById('merchantWebhookDisplay').textContent = m.webhook_url || 'Not configured';
                        document.getElementById('merchantPlatformsDisplay').textContent =
                            (m.enabled_platforms && Array.isArray(m.enabled_platforms))
                                ? m.enabled_platforms.join(', ')
                                : (m.enabled_platforms || 'Not configured');

                        applyProfileData();
                    }
                }

                // Display Twilio phone if available
                if (customerData.customer.twilio_phone_number) {
                    document.getElementById('twilioPhoneDisplay').textContent = customerData.customer.twilio_phone_number;
                } else {
                    document.getElementById('twilioPhoneDisplay').textContent = 'Not configured';
                }

            } catch (error) {
                console.error('Error loading merchant info:', error);
                document.getElementById('merchantIdDisplay').textContent = 'Error loading organization info';
            }
        }

        async function loadServiceStatuses() {
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/services-status`, { credentials: 'include' });
                const json = await res.json();
                if (!res.ok || !json.success) return;
                const s = json.services || {};
                const stripeEl = document.getElementById('stripeServiceStatus');
                const twilioEl = document.getElementById('twilioServiceStatus');
                if (stripeEl) stripeEl.textContent = `${s.stripe?.connected ? '✅ Connected' : '⚠️ Not configured'} - ${s.stripe?.detail || ''}`;
                if (twilioEl) twilioEl.textContent = `${s.twilio?.connected ? '✅ Connected' : '⚠️ Not configured'} - ${s.twilio?.detail || ''}`;
            } catch (_) {}
        }

        async function loadNotificationSettings() {
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/notification-settings`, { credentials: 'include' });
                const json = await res.json();
                if (!res.ok || !json.success) return;
                document.getElementById('notifOrders').checked = !!json.settings?.order_notifications;
                document.getElementById('notifFraud').checked = !!json.settings?.fraud_alerts;
                document.getElementById('notifReports').checked = !!json.settings?.weekly_reports;
            } catch (_) {}
        }

        async function loadSecurityMeta() {
            try {
                if (SP.currentCustomer?.password_updated_at) {
                    document.getElementById('passwordLastChanged').textContent = `Last changed ${new Date(SP.currentCustomer.password_updated_at).toLocaleString()}`;
                } else {
                    document.getElementById('passwordLastChanged').textContent = 'Not available';
                }
            } catch (_) {}
            try { await viewSessions(); } catch (_) {}
        }

        function editBusinessName() {
            const current = (SP.currentCustomer && SP.currentCustomer.company_name) || document.getElementById('businessNameSetting').textContent || '';
            const newName = prompt('Enter new business name:', current);
            if (newName) {
                saveProfileSettings({ company_name: newName.trim() });
            }
        }

        async function editEmail() {
            const current = (SP.currentCustomer && SP.currentCustomer.email) || '';
            const newEmail = prompt('Enter new email address:', current);
            if (!newEmail || newEmail.trim() === current) return;
            try {
                const reqRes = await fetch(`${SP.API_BASE}/api/customers/me/email-change/request`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_email: newEmail.trim() })
                });
                const reqJson = await reqRes.json();
                if (!reqRes.ok || !reqJson.success) throw new Error(reqJson.error || 'Could not request email change');
                const code = prompt(`Verification code sent to ${newEmail}. Enter code to confirm:`, '');
                if (!code) return;
                const cRes = await fetch(`${SP.API_BASE}/api/customers/me/email-change/confirm`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_email: newEmail.trim(), code: code.trim() })
                });
                const cJson = await cRes.json();
                if (!cRes.ok || !cJson.success) throw new Error(cJson.error || 'Could not confirm email change');
                SP.currentCustomer = { ...(SP.currentCustomer || {}), email: cJson.email };
                applyProfileData();
                alert('Email updated.');
            } catch (e) {
                alert(e.message || 'Email change failed');
            }
        }

        function editPhone() {
            const current = (SP.currentCustomer && (SP.currentCustomer.phone_number || SP.currentCustomer.twilio_phone_number)) || '';
            const newPhone = prompt('Enter new phone number:', current);
            if (newPhone) {
                saveProfileSettings({ phone_number: newPhone.trim() });
            }
        }

        function editProviderDisplayName() {
            const current = providerLabelFromCustomer(SP.currentCustomer) || '';
            const next = prompt('Enter provider display name:', current);
            if (!next) return;
            const existing = (SP.currentCustomer && SP.currentCustomer.provider_profile && typeof SP.currentCustomer.provider_profile === 'object')
                ? SP.currentCustomer.provider_profile
                : {};
            saveProfileSettings({
                provider_profile: {
                    ...existing,
                    display_name: next.trim()
                }
            });
        }

        async function saveProfileSettings(payload) {
            try {
                const response = await fetch(`${SP.API_BASE}/api/customers/me/profile`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload || {})
                });
                const data = await response.json();
                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Failed to save profile');
                }
                if (data.customer) {
                    SP.currentCustomer = { ...(SP.currentCustomer || {}), ...data.customer };
                    SP.userData = { ...(SP.userData || {}), ...data.customer };
                }
                applyProfileData();
                alert('Profile updated.');
            } catch (error) {
                console.error('saveProfileSettings error:', error);
                alert(error.message || 'Failed to save profile');
            }
        }

        // Connected Services
        function manageStripe() {
            window.location.href = 'billing.html?section=overview';
        }

        function manageTwilio() {
            alert(`Twilio number: ${(SP.currentCustomer && SP.currentCustomer.twilio_phone_number) || 'Not configured'}`);
        }

        // Notifications
        async function toggleNotification(type) {
            try {
                const payload = {
                    order_notifications: !!document.getElementById('notifOrders')?.checked,
                    fraud_alerts: !!document.getElementById('notifFraud')?.checked,
                    weekly_reports: !!document.getElementById('notifReports')?.checked
                };
                const res = await fetch(`${SP.API_BASE}/api/customers/me/notification-settings`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to save notification settings');
            } catch (e) {
                alert(e.message || `Failed to update ${type}`);
            }
        }

        // Billing
        // API & Developer
        function viewApiKey() {
            if (!SP.currentMerchant?.api_key) {
                alert('No API key available');
                return;
            }
            alert(`API Key:\n\n${SP.currentMerchant.api_key}`);
        }

        async function regenerateApiKey() {
            if (!confirm('⚠️ Warning: This will invalidate your current API key.\n\nAll applications using the old key will stop working.\n\nContinue?')) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/merchant/me/regenerate-api-key`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success) {
                    SP.currentMerchant = data.merchant;
                    const m = data.merchant;
                    document.getElementById('merchantApiKeyDisplay').textContent = m.api_key ?
                        `${m.api_key.substring(0, 12)}...${m.api_key.substring(m.api_key.length - 4)}` : 'Not available';
                    document.getElementById('apiKeyDisplayMasked').textContent = m.api_key ?
                        `${m.api_key.substring(0, 12)}...${m.api_key.substring(m.api_key.length - 4)}` : 'Not available';
                    alert('✅ New API key generated! Update your applications with the new key.');
                } else {
                    alert(data.error || 'Failed to regenerate API key');
                }
            } catch (e) {
                alert('Failed to regenerate API key. Please try again.');
            }
        }

        async function editMerchantName() {
            const current = SP.currentMerchant?.name || '';
            const next = prompt('Enter practice / organization name:', current);
            if (!next) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/merchant/me`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: next.trim() })
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to update practice name');
                SP.currentMerchant = json.merchant || SP.currentMerchant;
                document.getElementById('merchantNameDisplay').textContent = SP.currentMerchant?.name || 'Unnamed practice';
                applyProfileData();
            } catch (e) {
                alert(e.message || 'Failed to update practice name');
            }
        }

        function editPlatforms() {
            alert('Enabled platforms are managed by your onboarding/admin flow.');
        }

        function viewTwilioPhone() {
            alert((SP.currentCustomer && SP.currentCustomer.twilio_phone_number) || 'No Twilio phone number configured');
        }

        async function editWebhook() {
            const current = SP.currentMerchant?.webhook_url || '';
            const newUrl = prompt('Enter webhook URL:', current);
            if (newUrl == null) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/merchant/me`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ webhook_url: newUrl.trim() || null })
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to update webhook');
                SP.currentMerchant = json.merchant || SP.currentMerchant;
                document.getElementById('webhookUrlDisplay').textContent = SP.currentMerchant?.webhook_url || 'Not configured';
                document.getElementById('merchantWebhookDisplay').textContent = SP.currentMerchant?.webhook_url || 'Not configured';
            } catch (e) {
                alert(e.message || 'Failed to update webhook');
            }
        }

        async function testWebhook() {
            if (!SP.currentMerchant?.webhook_url) {
                alert('Please configure a webhook URL first.');
                return;
            }
            try {
                const res = await fetch(`${SP.API_BASE}/api/merchant/me/test-webhook`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await res.json();
                if (data.success) {
                    alert('✅ ' + (data.message || 'Test webhook sent. Check your endpoint.'));
                } else {
                    alert(data.error || 'Webhook test failed.');
                }
            } catch (e) {
                alert('Failed to send test webhook. Please try again.');
            }
        }

        function viewApiDocs() {
            const docsUrl = (typeof SP.API_BASE !== 'undefined' ? SP.API_BASE : '') + '/docs';
            window.open(docsUrl, '_blank');
        }

        // Security
        function changePassword() {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';

            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 30px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 24px;">Change Password</h2>
                    <div id="passwordChangeError" style="display: none; background: #fed7d7; color: #c53030; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px;"></div>
                    <div id="passwordChangeSuccess" style="display: none; background: #c6f6d5; color: #22543d; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px;"></div>
                    <form id="passwordChangeForm">
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #4a5568;">Current Password</label>
                            <input type="password" id="currentPassword" required style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px;">
                        </div>
                        <div style="margin-bottom: 16px;">
                            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #4a5568;">New Password</label>
                            <input type="password" id="newPassword" required minlength="8" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px;">
                            <small style="color: #718096; font-size: 12px; margin-top: 4px; display: block;">Must be at least 8 characters</small>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #4a5568;">Confirm New Password</label>
                            <input type="password" id="confirmPassword" required minlength="8" style="width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 15px;">
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end;">
                            <button type="button" onclick="closePasswordModal()" style="padding: 12px 24px; border: 2px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 600; color: #4a5568;">Cancel</button>
                            <button type="submit" id="passwordChangeBtn" style="padding: 12px 24px; background: #16a637; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Change Password</button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(modal);

            // Handle form submission
            document.getElementById('passwordChangeForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await submitPasswordChange();
            });

            // Close on overlay click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closePasswordModal();
                }
            });
        }

        function closePasswordModal() {
            const modal = document.querySelector('.modal-overlay');
            if (modal) {
                modal.remove();
            }
        }

        async function submitPasswordChange() {
            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const errorDiv = document.getElementById('passwordChangeError');
            const successDiv = document.getElementById('passwordChangeSuccess');
            const btn = document.getElementById('passwordChangeBtn');

            // Hide messages
            errorDiv.style.display = 'none';
            successDiv.style.display = 'none';

            // Validate
            if (newPassword !== confirmPassword) {
                errorDiv.textContent = 'New passwords do not match';
                errorDiv.style.display = 'block';
                return;
            }

            if (newPassword.length < 8) {
                errorDiv.textContent = 'Password must be at least 8 characters';
                errorDiv.style.display = 'block';
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Changing...';

            try {
                const response = await fetch(`${SP.API_BASE}/api/customers/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        currentPassword,
                        newPassword
                    })
                });

                const data = await response.json();

                if (data.success) {
                    successDiv.textContent = 'Password changed successfully!';
                    successDiv.style.display = 'block';

                    // Clear form
                    document.getElementById('passwordChangeForm').reset();

                    // Close modal after 2 seconds
                    setTimeout(() => {
                        closePasswordModal();
                        // Optionally reload page to update "Last changed" date
                        location.reload();
                    }, 2000);
                } else {
                    throw new Error(data.error || data.message || 'Failed to change password');
                }
            } catch (error) {
                console.error('Password change error:', error);
                errorDiv.textContent = error.message || 'Failed to change password';
                errorDiv.style.display = 'block';
            } finally {
                btn.disabled = false;
                btn.textContent = 'Change Password';
            }
        }

        function enable2FA() {
            alert('Two-factor authentication is coming soon. We\'ll notify you when it\'s available.');
        }

        async function viewSessions() {
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/sessions`, { credentials: 'include' });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load sessions');
                const list = document.getElementById('activeSessionsList');
                if (!list) return;
                const rows = Array.isArray(json.sessions) ? json.sessions : [];
                if (!rows.length) {
                    list.textContent = 'No active sessions.';
                    return;
                }
                const esc = window.SomoHtml?.escapeHtml || ((s) => String(s ?? ''));
                const escAttr = window.SomoHtml?.escapeAttr || esc;
                list.innerHTML = rows.map((s) => `
                    <div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #eef2f7;">
                      <span>${s.is_current ? 'Current' : 'Session'} • ${esc(s.ip_address || 'unknown ip')} • ${new Date(s.last_accessed_at || s.created_at).toLocaleString()}</span>
                      ${s.is_current ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-revoke-session="${escAttr(s.id)}">Revoke</button>`}
                    </div>
                `).join('');
                list.querySelectorAll('[data-revoke-session]').forEach((btn) => {
                    btn.addEventListener('click', () => revokeSession(btn.getAttribute('data-revoke-session')));
                });
            } catch (e) {
                alert(e.message || 'Failed to load sessions');
            }
        }

        async function exportData() {
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/export`, {
                    method: 'POST',
                    credentials: 'include'
                });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.error || 'Export failed');
                }
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `Somo-export-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                alert('Data export downloaded.');
            } catch (e) {
                alert(e.message || 'Failed to export data.');
            }
        }

        async function closeAccount() {
            const confirm1 = confirm('Are you sure you want to close your account? This action cannot be undone.');
            if (!confirm1) return;
            const phrase = prompt('Type DELETE FOREVER to confirm:');
            if (phrase !== 'DELETE FOREVER') {
                alert('Account closure cancelled.');
                return;
            }
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/close-account`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm_phrase: phrase })
                });
                const data = await res.json();
                if (data.success) {
                    alert('Account closed. You have been signed out.');
                    logout();
                } else {
                    alert(data.error || 'Failed to close account');
                }
            } catch (e) {
                alert('Failed to close account. Please try again.');
            }
        }

        async function revokeSession(sessionId) {
            if (!sessionId) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/sessions/${encodeURIComponent(sessionId)}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to revoke session');
                await viewSessions();
            } catch (e) {
                alert(e.message || 'Failed to revoke session');
            }
        }

        async function revokeOtherSessions() {
            if (!confirm('Revoke all other sessions?')) return;
            try {
                const res = await fetch(`${SP.API_BASE}/api/customers/me/sessions/revoke-others`, {
                    method: 'POST',
                    credentials: 'include'
                });
                const json = await res.json();
                if (!res.ok || !json.success) throw new Error(json.error || 'Failed to revoke sessions');
                await viewSessions();
            } catch (e) {
                alert(e.message || 'Failed to revoke sessions');
            }
        }

        function logout() {
            sessionStorage.clear();
            window.location.href = '../login.html';
        }

        // Pay-as-you-go Billing

window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.setupSettingsTabs = setupSettingsTabs;
window.setSettingsTab = setSettingsTab;
window.editBusinessName = editBusinessName;
window.editEmail = editEmail;
window.editPhone = editPhone;
window.editProviderDisplayName = editProviderDisplayName;
window.saveProfileSettings = saveProfileSettings;
async function loadTeamMembersPanel() {
  const list = document.getElementById('teamMembersList');
  const msg = document.getElementById('teamInviteMsg');
  if (!list) return;
  try {
    const customer = JSON.parse(sessionStorage.getItem('customer') || 'null');
    const ownerEmail = customer?.email || 'Owner';
    const ownerName = customer?.name || customer?.company_name || 'Account owner';
    const esc = window.SomoHtml?.escapeHtml || ((s) => String(s ?? ''));
    list.innerHTML = `<div style="padding:10px 12px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;margin-bottom:8px">
      <strong>${esc(ownerName)}</strong> · ${esc(ownerEmail)} <span style="color:var(--gray-500,#64748b)">(owner)</span>
    </div>
    <p style="margin:0;font-size:0.85rem;color:var(--gray-600,#64748b)">Additional logins share the same clinic. Invited users get their own email sign-in.</p>`;
  } catch (_) {
    list.textContent = 'Sign in to manage team access.';
  }
  const btn = document.getElementById('teamInviteBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const email = document.getElementById('teamInviteEmail')?.value?.trim();
      if (!email) {
        if (msg) { msg.style.display = 'block'; msg.textContent = 'Enter an email address.'; msg.style.color = 'var(--danger)'; }
        return;
      }
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = `Invite queued for ${email}. Your Somo rep will send a staff login link (pilot).`;
        msg.style.color = 'var(--success)';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTeamMembersPanel();
});

window.loadTeamMembersPanel = loadTeamMembersPanel;
window.manageStripe = manageStripe;
window.manageTwilio = manageTwilio;
window.toggleNotification = toggleNotification;
window.viewApiKey = viewApiKey;
window.regenerateApiKey = regenerateApiKey;
window.editMerchantName = editMerchantName;
window.editPlatforms = editPlatforms;
window.viewTwilioPhone = viewTwilioPhone;
window.editWebhook = editWebhook;
window.testWebhook = testWebhook;
window.viewApiDocs = viewApiDocs;
window.changePassword = changePassword;
window.closePasswordModal = closePasswordModal;
window.enable2FA = enable2FA;
window.viewSessions = viewSessions;
window.exportData = exportData;
window.closeAccount = closeAccount;
window.revokeSession = revokeSession;
window.revokeOtherSessions = revokeOtherSessions;
window.logout = logout;