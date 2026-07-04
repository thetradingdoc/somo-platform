/**
 * Settings — Kelly tab (FD-204, FD-229): full voice config editors.
 */
(function () {
  let hoursApi = null;
  let cachedSettings = null;

  function kellyClinicId() {
    return typeof window.ppGetClinicId === 'function'
      ? window.ppGetClinicId()
      : localStorage.getItem('clinic_id') || 'clinic-default';
  }

  async function loadKellyPrompt() {
    const el = document.getElementById('kellyPrompt');
    if (!el) return;
    try {
      const base = (window.API_BASE || window.location.origin).replace(/\/$/, '');
      const res = await fetch(`${base}/api/customer/agent/prompt`, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      if (json.prompt) el.value = json.prompt;
    } catch (_) {}
  }

  async function loadKellySettingsTab() {
    const mount = document.getElementById('kellySettingsMount');
    if (!mount || !window.VoiceAgentPage) return;
    if (!mount.dataset.ready) {
      mount.innerHTML = `
        <div class="sfd-card">
          <h3 style="margin:0 0 8px">Inbound greeting</h3>
          <textarea id="kellyGreeting" class="va-textarea" rows="3" style="width:100%"></textarea>
          <div id="kellyPreview" style="margin-top:12px"></div>
        </div>
        <div class="sfd-card">
          <h3 style="margin:0 0 8px">Office hours &amp; coverage</h3>
          <label class="sfd-label" for="kellyCoverageMode">Coverage mode</label>
          <select id="kellyCoverageMode" class="va-textarea" style="width:100%;padding:8px 10px;margin-bottom:12px">
            <option value="scheduled">Scheduled hours — Kelly on during office hours only</option>
            <option value="full_replacement">Full-time — Kelly answers whenever forwarded</option>
          </select>
          <div id="kellyHoursPicker"></div>
          <label class="sfd-label" style="margin-top:12px" for="kellyAfterHours">After-hours message</label>
          <textarea id="kellyAfterHours" class="va-textarea" rows="2" style="width:100%"></textarea>
        </div>
        <div class="sfd-card">
          <h3 style="margin:0 0 8px">Languages &amp; handoff</h3>
          <label class="sfd-label" for="kellyLanguageMode">Languages Kelly supports</label>
          <select id="kellyLanguageMode" class="va-textarea" style="width:100%;padding:8px 10px;margin-bottom:8px">
            <option value="en_only">English only</option>
            <option value="en_es">English + Spanish</option>
            <option value="en_ru">English + Russian</option>
            <option value="en_zh">English + Mandarin (Chinese)</option>
          </select>
          <label class="sfd-label" for="kellyTransferNumber">Warm transfer number</label>
          <input type="tel" id="kellyTransferNumber" class="va-textarea" style="width:100%;padding:8px 10px" placeholder="+1… office line for live handoffs" />
          <label class="sfd-label" style="margin-top:8px" for="kellyOverflowPhone">Overflow line</label>
          <input type="tel" id="kellyOverflowPhone" class="va-textarea" style="width:100%;padding:8px 10px" placeholder="+1… when all Kelly slots are busy" />
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <input type="checkbox" id="kellyOverflowEnabled" checked /> Forward overflow &amp; credits-exhausted to office line
          </label>
          <label class="sfd-label" style="margin-top:8px" for="kellyClinicEmail">Practice email (handoff alerts)</label>
          <input type="email" id="kellyClinicEmail" class="va-textarea" style="width:100%;padding:8px 10px" placeholder="frontdesk@yourpractice.com" />
        </div>
        <div class="sfd-card">
          <h3 style="margin:0 0 8px">Outbound (optional)</h3>
          <label><input type="checkbox" id="kellyOutboundEnabled" /> Enable outbound opener</label>
          <textarea id="kellyOutboundOpener" class="va-textarea" rows="2" style="width:100%;margin-top:8px" placeholder="First line on outbound calls…"></textarea>
        </div>
        <details class="sfd-card">
          <summary style="cursor:pointer;font-weight:600">Advanced behavior (optional)</summary>
          <p class="sfd-muted" style="margin:8px 0 0;font-size:0.88rem">Applies after the greeting or outbound opener — not the first line callers hear.</p>
          <textarea id="kellyPrompt" class="va-textarea" rows="6" style="width:100%;margin-top:8px"></textarea>
          <button type="button" class="sfd-btn sfd-btn-secondary" id="kellySavePromptBtn" style="margin-top:8px">Save prompt only</button>
        </details>
        <button type="button" class="sfd-btn sfd-btn-primary" id="kellySaveBtn" style="margin-top:12px">Save Kelly settings</button>
        <p class="sfd-muted" style="margin-top:12px">Pause, shadow week, and line status: <a href="agent.html">Kelly control center</a></p>`;
      mount.dataset.ready = '1';
      hoursApi = window.VoiceHoursPicker?.mount(document.getElementById('kellyHoursPicker'), {});
      document.getElementById('kellySaveBtn')?.addEventListener('click', saveKellySettings);
      document.getElementById('kellySavePromptBtn')?.addEventListener('click', saveKellyPrompt);
      document.getElementById('kellyGreeting')?.addEventListener('input', scheduleKellyPreview);
      document.getElementById('kellyOutboundOpener')?.addEventListener('input', scheduleKellyPreview);
      document.getElementById('kellyOutboundEnabled')?.addEventListener('change', scheduleKellyPreview);
    }
    try {
      const settings = await VoiceAgentPage.fetchVoiceSettings();
      cachedSettings = settings;
      if (!settings) return;
      document.getElementById('kellyGreeting').value = settings.greeting || '';
      document.getElementById('kellyAfterHours').value = settings.after_hours_message || '';
      document.getElementById('kellyOutboundEnabled').checked = !!settings.outbound_enabled;
      document.getElementById('kellyOutboundOpener').value = settings.outbound_opener || '';
      if (settings.coverage_mode) {
        document.getElementById('kellyCoverageMode').value = settings.coverage_mode;
      }
      if (settings.language_mode) {
        document.getElementById('kellyLanguageMode').value = settings.language_mode;
      }
      if (settings.transfer_number) {
        document.getElementById('kellyTransferNumber').value = settings.transfer_number;
      }
      if (settings.overflow_phone) {
        document.getElementById('kellyOverflowPhone').value = settings.overflow_phone;
      }
      document.getElementById('kellyOverflowEnabled').checked = settings.overflow_enabled !== false;
      if (settings.clinic_email) {
        document.getElementById('kellyClinicEmail').value = settings.clinic_email;
      }
      if (hoursApi?.setValue && settings.business_hours) hoursApi.setValue(settings.business_hours);
      scheduleKellyPreview();
      await loadKellyPrompt();
      const status = await VoiceAgentPage.fetchVoiceAgentStatus().catch(() => null);
      if (status && window.SfdNameplate) {
        const badge = document.getElementById('kellyTabStatus');
        if (badge) badge.innerHTML = SfdNameplate.renderNameplate(status.nameplate || status.label || 'LIVE');
      }
    } catch (e) {
      console.warn('Kelly settings tab:', e.message);
    }
  }

  let previewTimer;
  function scheduleKellyPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!window.VoicePreview) return;
      try {
        const data = await VoicePreview.fetchPreview({
          greeting: document.getElementById('kellyGreeting')?.value?.trim(),
          outbound_opener: document.getElementById('kellyOutboundOpener')?.value?.trim(),
          outbound_enabled: document.getElementById('kellyOutboundEnabled')?.checked
        });
        VoicePreview.renderPreviewCards(document.getElementById('kellyPreview'), data);
      } catch (_) {}
    }, 300);
  }

  async function saveKellySettings() {
    const existing = cachedSettings || (await VoiceAgentPage.fetchVoiceSettings());
    await VoiceAgentPage.saveVoiceSettings({
      enabled: existing?.enabled !== false,
      clinic_id: kellyClinicId(),
      retell_agent_id: existing?.retell_agent_id || null,
      settings_version: existing?.settings_version ?? null,
      greeting: document.getElementById('kellyGreeting')?.value?.trim(),
      after_hours_message: document.getElementById('kellyAfterHours')?.value?.trim(),
      business_hours: hoursApi?.getValue?.() || existing?.business_hours,
      coverage_mode: document.getElementById('kellyCoverageMode')?.value,
      language_mode: document.getElementById('kellyLanguageMode')?.value || 'en_only',
      transfer_number: document.getElementById('kellyTransferNumber')?.value?.trim() || null,
      overflow_phone: document.getElementById('kellyOverflowPhone')?.value?.trim() || null,
      overflow_enabled: document.getElementById('kellyOverflowEnabled')?.checked !== false,
      clinic_email: document.getElementById('kellyClinicEmail')?.value?.trim() || null,
      outbound_enabled: document.getElementById('kellyOutboundEnabled')?.checked,
      outbound_opener: document.getElementById('kellyOutboundOpener')?.value?.trim()
    });
    alert('Kelly settings saved.');
  }

  async function saveKellyPrompt() {
    const text = document.getElementById('kellyPrompt')?.value?.trim() || '';
    await VoiceAgentPage.savePrompt(text);
    alert('Advanced prompt saved.');
  }

  window.loadKellySettingsTab = loadKellySettingsTab;
})();
