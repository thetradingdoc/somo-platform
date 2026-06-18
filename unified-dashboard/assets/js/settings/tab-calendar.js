window.SettingsPage = window.SettingsPage || {};
const SP = window.SettingsPage;
        async function loadCalendarStatus() {
            const statusEl = document.getElementById('googleCalendarStatus');
            const detailsEl = document.getElementById('googleCalendarDetails');
            const actionsEl = document.getElementById('googleCalendarActions');
            const errorEl = document.getElementById('googleCalendarError');

            if (!SP.userData || !SP.userData.email) {
                statusEl.textContent = 'Please sign in to manage calendar sync.';
                actionsEl.innerHTML = '';
                return;
            }

            if (!SP.API_BASE) {
                statusEl.textContent = 'API configuration error.';
                detailsEl.textContent = 'SP.API_BASE is not set. Please check your configuration.';
                actionsEl.innerHTML = `
                    <button class="btn btn-secondary btn-sm" onclick="loadCalendarStatus()">
                        Retry
                    </button>
                `;
                return;
            }

            statusEl.textContent = 'Checking connection...';
            detailsEl.textContent = '';
            errorEl.style.display = 'none';
            errorEl.textContent = '';

            try {
                const url = `${SP.API_BASE}/api/calendar/status?email=${encodeURIComponent(SP.userData.email)}`;
                console.log('Fetching calendar status from:', url);

                const response = await fetch(url);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Response error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (!data.success) {
                    statusEl.textContent = 'Failed to load calendar status.';
                    if (data.error) {
                        detailsEl.textContent = data.error;
                    }
                    actionsEl.innerHTML = `
                        <button class="btn btn-secondary btn-sm" onclick="loadCalendarStatus()">
                            Retry
                        </button>
                    `;
                    return;
                }

                if (!data.connected) {
                    statusEl.textContent = 'Not connected';
                    detailsEl.textContent = 'Sync appointments to your Google Calendar to avoid double bookings.';
                    actionsEl.innerHTML = `
                        <button class="btn btn-primary btn-sm" onclick="connectGoogleCalendar()">
                            Connect Google Calendar
                        </button>
                    `;
                    if (data.message) {
                        errorEl.style.display = 'block';
                        errorEl.textContent = data.message;
                    }
                    return;
                }

                statusEl.classList.add('connected');
                statusEl.textContent = `✅ Connected as ${data.calendar_email || SP.userData.email}`;
                const detailParts = [];
                if (data.calendar_name) {
                    detailParts.push(`Calendar: ${data.calendar_name}`);
                }
                if (data.calendar_timezone) {
                    detailParts.push(`Timezone: ${data.calendar_timezone}`);
                }
                if (data.last_sync_at) {
                    detailParts.push(`Last sync: ${new Date(data.last_sync_at).toLocaleString()}`);
                }
                detailsEl.textContent = detailParts.join(' • ') || 'Sync is active.';

                const calendarOptions = (data.calendars || [])
                    .map(cal => `<option value="${cal.id}" ${cal.selected ? 'selected' : ''}>${cal.name || cal.id}${cal.primary ? ' (Primary)' : ''}</option>`)
                    .join('');

                const needsReconnect = data.needsReconnect;
                actionsEl.innerHTML = `
                    ${calendarOptions ? `
                        <select id="calendarSelect" class="btn btn-secondary btn-sm" onchange="changeCalendarSelection(event)">
                            ${calendarOptions}
                        </select>
                    ` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="refreshGoogleCalendar()">
                        Refresh
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="disconnectGoogleCalendar()">
                        Disconnect
                    </button>
                `;

                if (needsReconnect && data.message) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = data.message;
                }
            } catch (error) {
                console.error('Calendar status error:', error);
                console.error('SP.API_BASE:', SP.API_BASE);
                console.error('User email:', SP.userData?.email);

                // Provide more helpful error messages
                let errorMessage = 'Please try again.';
                if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                    errorMessage = `Cannot connect to server at ${SP.API_BASE}. Make sure the backend server is running on port 4000.`;
                } else if (error.message) {
                    errorMessage = error.message;
                }

                statusEl.textContent = 'Failed to load calendar status.';
                detailsEl.textContent = errorMessage;
                actionsEl.innerHTML = `
                    <button class="btn btn-secondary btn-sm" onclick="loadCalendarStatus()">
                        Retry
                    </button>
                `;
            }
        }

        function readinessBadge(row) {
            if (row.calendar_connected) return '<span class="readiness-badge live">Live calendar connected</span>';
            if (row.has_availability_blocks) return '<span class="readiness-badge blocks">Availability blocks only</span>';
            return '<span class="readiness-badge unavailable">Unavailable</span>';
        }

        function readinessChecks(row) {
            const checks = [
                `online: ${row.is_online ? 'pass' : 'fail'}`,
                `profile: ${row.is_active ? 'pass' : 'fail'}`,
                `calendar: ${row.calendar_connected ? 'pass' : 'not connected'}`,
                `blocks: ${row.has_availability_blocks ? 'pass' : 'missing'}`
            ];
            return checks.join(' | ');
        }

        async function loadProviderBookingReadiness() {
            const statusEl = document.getElementById('providerReadinessStatus');
            const rowsEl = document.getElementById('providerReadinessRows');
            const warnEl = document.getElementById('providerReadinessWarning');
            const obsEl = document.getElementById('bookingObservabilitySummary');
            if (!statusEl || !rowsEl) return;
            statusEl.textContent = 'Checking specialist readiness...';
            rowsEl.innerHTML = '';
            if (warnEl) warnEl.style.display = 'none';
            if (obsEl) obsEl.textContent = '';

            try {
                const clinicId = (window.DEFAULT_CLINIC_ID || localStorage.getItem('clinicId') || '').trim();
                const qs = clinicId ? `?clinic_id=${encodeURIComponent(clinicId)}` : '';
                const readinessRes = await fetch(`${SP.API_BASE}/api/provider/booking-readiness${qs}`);
                const readiness = await readinessRes.json();
                if (!readinessRes.ok || !readiness.success) {
                    throw new Error(readiness.error || 'Failed to load readiness');
                }

                const providers = Array.isArray(readiness.providers) ? readiness.providers : [];
                if (!providers.length) {
                    statusEl.textContent = 'No specialists found. Add at least one active specialist profile.';
                } else {
                    statusEl.textContent = `Ready specialists: ${providers.filter((p) => p.booking_ready).length}/${providers.length}`;
                }

                rowsEl.innerHTML = providers.map((p) => `
                    <div class="readiness-row">
                        <div>
                            <div style="font-weight:600;">${p.display_name || p.email || 'Specialist'}</div>
                            <div style="color:var(--gray-600); font-size:12px;">${readinessChecks(p)}</div>
                        </div>
                        ${readinessBadge(p)}
                    </div>
                `).join('');

                const hasBlocksOnly = providers.some((p) => !p.calendar_connected && p.has_availability_blocks);
                if (hasBlocksOnly && warnEl) warnEl.style.display = 'block';

                const obsRes = await fetch(`${SP.API_BASE}/api/provider/booking-observability`);
                const obsJson = await obsRes.json();
                if (obsRes.ok && obsJson.success && obsEl) {
                    const o = obsJson.observability || {};
                    const pct = o.confidence_percentages || {};
                    const ratio = Number(o.blocks_only_ratio || 0) * 100;
                    obsEl.textContent = `Confidence mix: high ${pct.high || 0}% / medium ${pct.medium || 0}% / low ${pct.low || 0}% · Blocks-only bookings: ${ratio.toFixed(1)}%`;
                }
            } catch (error) {
                console.error('Provider readiness error:', error);
                statusEl.textContent = 'Failed to load specialist readiness.';
                rowsEl.innerHTML = `<div class="readiness-row">Please retry after backend is available.</div>`;
            }
        }

        function connectGoogleCalendar() {
            if (!SP.userData || !SP.userData.email) {
                alert('You must be signed in to connect your calendar.');
                return;
            }
            const returnUrl = window.location.href;
            window.location.href = `${SP.API_BASE}/auth/google/calendar/connect?email=${encodeURIComponent(SP.userData.email)}&returnUrl=${encodeURIComponent(returnUrl)}`;
        }

        async function disconnectGoogleCalendar() {
            if (!confirm('Disconnect Google Calendar?')) {
                return;
            }

            try {
                const response = await fetch(`${SP.API_BASE}/api/calendar/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: SP.userData.email })
                });
                const data = await response.json();
                if (data.success) {
                    alert('Google Calendar disconnected.');
                    loadCalendarStatus();
                } else {
                    alert(data.error || 'Failed to disconnect calendar.');
                }
            } catch (error) {
                console.error('Disconnect error:', error);
                alert('Failed to disconnect calendar.');
            }
        }

        async function refreshGoogleCalendar() {
            if (!SP.userData || !SP.userData.email) {
                return;
            }
            // Simply reload status; backend refreshes tokens when needed
            loadCalendarStatus();
        }

        async function changeCalendarSelection(event) {
            const calendarId = event.target.value;
            const calendarName = event.target.options[event.target.selectedIndex]?.text || calendarId;

            try {
                const response = await fetch(`${SP.API_BASE}/api/calendar/select`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: SP.userData.email,
                        calendar_id: calendarId,
                        calendar_name: calendarName
                    })
                });
                const data = await response.json();
                if (data.success) {
                    loadCalendarStatus();
                } else {
                    alert(data.error || 'Failed to update calendar selection.');
                }
            } catch (error) {
                console.error('Calendar selection error:', error);
                alert('Failed to update calendar selection.');
            }
        }

window.loadCalendarStatus = loadCalendarStatus;
window.readinessBadge = readinessBadge;
window.readinessChecks = readinessChecks;
window.loadProviderBookingReadiness = loadProviderBookingReadiness;
window.connectGoogleCalendar = connectGoogleCalendar;
window.disconnectGoogleCalendar = disconnectGoogleCalendar;
window.refreshGoogleCalendar = refreshGoogleCalendar;
window.changeCalendarSelection = changeCalendarSelection;