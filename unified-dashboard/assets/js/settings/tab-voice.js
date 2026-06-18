window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;
        async function loadVoiceAgentSettingsSummary() {
            const statusEl = document.getElementById('vaSettingsStatusSummary');
            const greetEl = document.getElementById('vaSettingsGreetingSummary');
            const outboundEl = document.getElementById('vaSettingsOutboundSummary');
            const hoursEl = document.getElementById('vaSettingsHoursSummary');
            try {
                const [settingsRes, kellyRes] = await Promise.all([
                    fetch(`${SP.API_BASE}/api/voice-agent/settings`, { credentials: 'include' }),
                    fetch(`${SP.API_BASE}/api/kelly/status`, { credentials: 'include' })
                ]);
                const settingsData = await settingsRes.json();
                const kellyData = kellyRes.ok ? await kellyRes.json() : null;
                const s = settingsData.success ? settingsData.settings : null;
                const kellyOn = kellyData?.status !== 'paused';
                if (statusEl) {
                    statusEl.textContent = kellyOn
                        ? (s?.enabled === 0 || s?.enabled === false ? 'Paused in voice settings' : 'Active — taking calls')
                        : 'Paused — not taking calls';
                }
                if (greetEl) {
                    greetEl.textContent = s?.greeting
                        ? (s.greeting.length > 120 ? s.greeting.slice(0, 120) + '…' : s.greeting)
                        : 'Default greeting (edit on Voice Agent page)';
                }
                if (outboundEl) {
                    outboundEl.textContent = s?.outbound_opener
                        ? (s.outbound_opener.length > 120 ? s.outbound_opener.slice(0, 120) + '…' : s.outbound_opener)
                        : 'Default outbound opener (edit on Voice Agent page)';
                }
                if (hoursEl && window.VoiceHoursPicker) {
                    hoursEl.textContent = VoiceHoursPicker.formatHoursSummary(s?.business_hours);
                } else if (hoursEl) {
                    hoursEl.textContent = s?.business_hours ? 'Configured' : 'Not set';
                }
            } catch (error) {
                console.error('Voice settings summary:', error);
                if (statusEl) statusEl.textContent = 'Could not load voice agent summary';
            }
        }

        // Sync label when toggling enabled checkbox
        const vaEnabledEl = document.getElementById('vaEnabled');
        if (vaEnabledEl) {
            vaEnabledEl.addEventListener('change', () => {
                const label = document.getElementById('vaEnabledLabel');
                if (label) label.textContent = vaEnabledEl.checked ? 'Enabled' : 'Disabled';
            });
        }

        // Business Information
window.loadVoiceAgentSettingsSummary = loadVoiceAgentSettingsSummary;