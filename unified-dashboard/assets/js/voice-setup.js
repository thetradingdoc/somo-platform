(function () {
  const API_BASE = (
    typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (window.API_BASE || window.location.origin)
  ).replace(/\/$/, '');
  const OnboardingApi = window.SomoOnboardingApi || {};
  const urlParams = new URLSearchParams(window.location.search);
  const urlStep = parseInt(urlParams.get('step'), 10);
  let step = Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= 6 ? urlStep : 1;
  let hoursApi = null;
  let customer = null;
  let previewTimer = null;
  let calendarChoice = null;
  let testCallPollTimer = null;
  let selectedCalendarId = null;
  let cachedTonePreset = null;

  const STEP_META = [
    { title: 'Your practice', sub: 'Confirm how Kelly introduces your office.' },
    { title: 'Connect systems', sub: 'Link your calendar or use Somo scheduling.' },
    { title: 'Inbound greeting', sub: 'What callers hear when they dial in.' },
    { title: 'Office hours', sub: 'When Kelly answers live vs after-hours.' },
    { title: 'Outbound calls', sub: 'Optional — what Kelly says when calling out.' },
    { title: 'Test your line', sub: 'Call your number and hear your greeting.' }
  ];

  const WIZARD_CANONICAL_STEP = ['profile', 'connect', 'voice', 'hours', 'outbound', 'live'];
  const WIZARD_STEPS = 6;
  const CANONICAL_TOTAL = 7;

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function showError(msg) {
    const el = document.getElementById('setupError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function showSuccess(msg) {
    const el = document.getElementById('setupSuccess');
    el.textContent = msg;
    el.className = 'signup-toast';
    el.classList.remove('hidden');
  }

  function canonicalStepNumber() {
    return step + 1;
  }

  function showStep(n) {
    step = n;
    for (let i = 1; i <= WIZARD_STEPS; i++) {
      document.getElementById(`step${i}`)?.classList.toggle('hidden', n !== i);
    }
    document.getElementById('setupEyebrow').textContent = `Step ${canonicalStepNumber()} of ${CANONICAL_TOTAL}`;
    document.getElementById('setupTitle').textContent = STEP_META[n - 1].title;
    document.getElementById('setupSub').textContent = STEP_META[n - 1].sub;
    const prog = document.getElementById('setupProgress');
    if (prog && window.SfdStepper?.renderStepper) {
      window.SfdStepper.renderStepper(prog, {
        current: WIZARD_CANONICAL_STEP[n - 1] || 'profile',
        completedThrough: 1
      });
    }
    if (n === 2) loadConnectStep();
    if (n === 3 || n === 5) schedulePreview();
    if (n === 5) syncOutboundUi();
    if (n === 6) {
      startTestCallPoll();
      loadForwardAck();
    }
    markWizardStarted();
  }

  async function markWizardStarted() {
    try {
      if (OnboardingApi.startWizardStep) {
        await OnboardingApi.startWizardStep(step, buildMetaPatch());
      } else {
        await fetch(`${API_BASE}/api/voice-agent/onboarding/wizard-started`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wizard_step: step, ...buildMetaPatch() })
        });
      }
    } catch (_) {}
  }

  function buildMetaPatch() {
    const patch = { wizard_step: step };
    if (calendarChoice) patch.calendar_connection = calendarChoice;
    const pms = document.getElementById('setupPmsType')?.value;
    if (pms) patch.pms_selection = pms;
    return patch;
  }

  async function persistConnectMeta(extra = {}) {
    const payload = { ...buildMetaPatch(), ...extra };
    if (OnboardingApi.patchConnectMeta) {
      return OnboardingApi.patchConnectMeta(payload);
    }
    const res = await fetch(`${API_BASE}/api/voice-agent/onboarding/connect`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Could not save progress');
    }
    return res.json();
  }

  function composeAddress() {
    const street = document.getElementById('setupAddressStreet')?.value?.trim() || '';
    const city = document.getElementById('setupAddressCity')?.value?.trim() || '';
    const state = document.getElementById('setupAddressState')?.value?.trim() || '';
    const zip = document.getElementById('setupAddressZip')?.value?.trim() || '';
    return [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', ');
  }

  function applyCoverageModeToHours() {
    const mode = document.getElementById('setupCoverageMode')?.value || 'scheduled';
    if (!hoursApi?.setValue) return;
    if (mode === 'full_time') {
      const allDay = {};
      ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((d) => {
        allDay[d] = { enabled: true, start: '08:00', end: '17:00' };
      });
      hoursApi.setValue(allDay);
    }
  }

  async function loadCustomer() {
    try {
      customer = JSON.parse(sessionStorage.getItem('customer') || 'null');
    } catch (_) {}
    if (!customer?.id && typeof hydrateProviderSession === 'function') {
      customer = await hydrateProviderSession(API_BASE);
    }
    if (!customer?.id) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return false;
    }

    let onboardMeta = {};
    try {
      const onboard = OnboardingApi.fetchOnboarding
        ? await OnboardingApi.fetchOnboarding()
        : await fetch(`${API_BASE}/api/voice-agent/onboarding`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null));
      onboardMeta = onboard?.onboarding_meta || onboard?.destination?.onboarding_meta || {};
      const urlStepParam = parseInt(urlParams.get('step'), 10);
      const hasExplicitUrlStep = Number.isFinite(urlStepParam) && urlStepParam >= 1;
      if (onboard?.destination?.wizard_step && !hasExplicitUrlStep) {
        const ws = parseInt(onboard.destination.wizard_step, 10);
        if (ws >= 1 && ws <= WIZARD_STEPS) step = ws;
      }
      calendarChoice = onboardMeta.calendar_connection || calendarChoice;
    } catch (_) {}

    const name = customer.company_name || customer.name || 'our office';
    document.getElementById('setupPracticeName').value = name;
    document.getElementById('setupGreeting').value = VoiceHoursPicker.defaultGreeting(name);
    document.getElementById('setupAfterHours').value =
      'Thank you for calling. We are currently closed. Please call back during our office hours.';
    document.getElementById('setupOutboundOpener').value =
      `Hi, I'm Kelly from ${name}. Is now still a good time to talk?`;

    const phone = customer.twilio_phone_number;
    if (phone) updatePhoneDisplay(phone);

    try {
      const settings = await VoiceAgentPage.fetchVoiceSettings();
      if (settings?.greeting) document.getElementById('setupGreeting').value = settings.greeting;
      if (settings?.outbound_opener) {
        document.getElementById('setupOutboundOpener').value = settings.outbound_opener;
      } else if (window.VoiceAgentPage?.applyOutboundOpenerDefault) {
        window.VoiceAgentPage.applyOutboundOpenerDefault(
          settings || {},
          'setupOutboundOpener',
          customer?.company_name
        );
      }
      if (settings?.outbound_enabled) {
        document.getElementById('setupOutboundEnabled').checked = true;
      }
      if (settings?.language_mode) document.getElementById('setupLanguageMode').value = settings.language_mode;
      if (settings?.transfer_number) document.getElementById('setupTransferNumber').value = settings.transfer_number;
      if (settings?.clinic_email) document.getElementById('setupClinicEmail').value = settings.clinic_email;
      else if (customer?.email) document.getElementById('setupClinicEmail').value = customer.email;
      if (settings?.npi) document.getElementById('setupNpi').value = settings.npi;
      if (settings?.coverage_mode) {
        const covEl = document.getElementById('setupCoverageMode');
        if (covEl) {
          covEl.value = settings.coverage_mode === 'coverage' ? 'scheduled' : 'full_time';
          applyCoverageModeToHours();
        }
      }
      if (settings?.practice_address) {
        const parts = String(settings.practice_address).split(',').map((p) => p.trim());
        if (parts[0]) document.getElementById('setupAddressStreet').value = parts[0];
      }
    } catch (_) {}

    if (onboardMeta.forward_line_ack) {
      const fwd = document.getElementById('setupForwardAck');
      if (fwd) fwd.checked = true;
    }

    return true;
  }

  function updatePhoneDisplay(phone) {
    const el = document.getElementById('setupPhone');
    const call = document.getElementById('setupCall');
    if (el) {
      el.textContent = phone;
      el.classList.add('sfd-mono');
    }
    if (call) call.href = 'tel:' + String(phone).replace(/\s/g, '');
  }

  function mapCoverageModeUiToApi(uiValue) {
    const v = String(uiValue || '').toLowerCase();
    if (v === 'scheduled' || v === 'coverage') return 'coverage';
    if (v === 'full_time' || v === 'full_replacement') return 'full_replacement';
    return 'full_replacement';
  }

  function draftSettings(partial) {
    const coverageUi = document.getElementById('setupCoverageMode')?.value;
    return {
      greeting: partial.greeting ?? document.getElementById('setupGreeting').value.trim(),
      after_hours_message:
        partial.after_hours_message ?? document.getElementById('setupAfterHours').value.trim(),
      business_hours: partial.business_hours ?? hoursApi?.getValue?.() ?? null,
      outbound_opener:
        partial.outbound_opener ?? document.getElementById('setupOutboundOpener').value.trim(),
      outbound_enabled:
        partial.outbound_enabled ?? document.getElementById('setupOutboundEnabled').checked,
      language_mode: partial.language_mode ?? document.getElementById('setupLanguageMode').value,
      transfer_number:
        partial.transfer_number ??
        (document.getElementById('setupTransferNumber').value.trim() || null),
      clinic_email:
        partial.clinic_email ??
        (document.getElementById('setupClinicEmail')?.value?.trim() || null),
      practice_address: partial.practice_address ?? (composeAddress() || null),
      npi: partial.npi ?? (document.getElementById('setupNpi')?.value?.trim() || null),
      coverage_mode: partial.coverage_mode ?? mapCoverageModeUiToApi(coverageUi)
    };
  }

  async function saveSettings(partial) {
    const existing = await VoiceAgentPage.fetchVoiceSettings();
    const draft = draftSettings(partial);
    await VoiceAgentPage.saveVoiceSettings({
      enabled: true,
      retell_agent_id: existing?.retell_agent_id || customer?.retell_agent_id || null,
      settings_version: existing?.settings_version ?? null,
      ...draft
    });
    showSuccess('Saved and syncing to live calls…');
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 300);
  }

  async function refreshPreview() {
    if (!globalThis.VoicePreview) return;
    const target = step === 5 ? 'setupOutboundPreview' : 'setupPreview';
    const el = document.getElementById(target);
    if (!el) return;
    try {
      if (cachedTonePreset == null) {
        const settings = await VoiceAgentPage.fetchVoiceSettings().catch(() => null);
        cachedTonePreset = settings?.tone_preset || undefined;
      }
      const previewPayload = {
        greeting: document.getElementById('setupGreeting').value.trim(),
        outbound_opener: document.getElementById('setupOutboundOpener').value.trim(),
        outbound_enabled: document.getElementById('setupOutboundEnabled').checked
      };
      if (cachedTonePreset) previewPayload.tone_preset = cachedTonePreset;
      const data = await VoicePreview.fetchPreview(previewPayload);
      VoicePreview.renderPreviewCards(el, data);
    } catch (_) {}
  }

  function syncOutboundUi() {
    const on = document.getElementById('setupOutboundEnabled')?.checked;
    const fields = document.getElementById('setupOutboundFields');
    const empty = document.getElementById('setupOutboundEmpty');
    if (fields) fields.hidden = !on;
    if (empty) empty.hidden = !!on;
  }

  async function setConnectChoice(choice, { persist = true } = {}) {
    calendarChoice = choice;
    document.getElementById('setupNext2')?.classList.remove('hidden');
    const status = document.getElementById('connectCalendarStatus');
    if (!status) return;
    status.hidden = false;
    if (choice === 'google') {
      status.innerHTML = '<b>Google Calendar connected.</b> Kelly will respect your calendar blocks.';
    } else if (choice === 'somo') {
      status.innerHTML = '<b>Somo calendar selected.</b> Connect Google or Dentrix anytime in Settings.';
    } else if (choice === 'skip') {
      status.innerHTML =
        '<b>Skipped for now.</b> Kelly uses Somo scheduling. Connect Google in Settings when ready.';
    }
    if (persist) {
      try {
        await persistConnectMeta({ calendar_connection: choice });
      } catch (e) {
        showError(e.message);
      }
    }
  }

  async function persistCalendarSelection(calendarId, calendarName) {
    if (!customer?.email || !calendarId) return;
    if (OnboardingApi.selectCalendar) {
      await OnboardingApi.selectCalendar(customer.email, calendarId, calendarName);
      return;
    }
    const res = await fetch(`${API_BASE}/api/calendar/select`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customer.email,
        calendar_id: calendarId,
        calendar_name: calendarName || calendarId
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not save calendar selection');
    }
  }

  async function renderCalendarPicker(calendars, selectedId) {
    const wrap = document.getElementById('calendarPickerWrap');
    if (!wrap || !calendars?.length) return;
    wrap.hidden = false;
    wrap.innerHTML = `
      <label class="va-field-label" for="setupCalendarPick">Which calendar should Kelly use?</label>
      <select id="setupCalendarPick" class="va-textarea" style="width:100%;padding:10px;margin-top:8px">
        ${calendars
          .map(
            (c) =>
              `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name || c.id)}</option>`
          )
          .join('')}
      </select>
      <p class="sfd-muted" style="font-size:0.85rem;margin:8px 0 0">Disconnect or change calendar anytime in <a href="/business/settings.html#connected">Settings → Connected</a>.</p>`;
    const sel = document.getElementById('setupCalendarPick');
    sel?.addEventListener('change', async () => {
      selectedCalendarId = sel.value;
      const calendarName = sel.options[sel.selectedIndex]?.text || selectedCalendarId;
      try {
        await persistCalendarSelection(selectedCalendarId, calendarName);
      } catch (e) {
        showError(e.message);
      }
    });
    selectedCalendarId = sel?.value || selectedId;
  }

  async function ensureCalendarSelectionPersisted() {
    const sel = document.getElementById('setupCalendarPick');
    if (!sel || !selectedCalendarId) return;
    const calendarName = sel.options[sel.selectedIndex]?.text || selectedCalendarId;
    await persistCalendarSelection(selectedCalendarId, calendarName);
  }

  async function loadConnectStep() {
    const statusEl = document.getElementById('connectCalendarStatus');
    const googleBtn = document.getElementById('setupConnectGoogle');
    const somoBtn = document.getElementById('setupUseSomoCal');
    if (!customer?.email) return;

    const calendarParam = urlParams.get('calendar');
    const calendarError = urlParams.get('calendarError');
    if (calendarError) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.innerHTML = `<b>Connection failed:</b> ${esc(calendarError)}`;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('calendar');
      url.searchParams.delete('calendarError');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    }

    try {
      const res = await fetch(
        `${API_BASE}/api/calendar/status?email=${encodeURIComponent(customer.email)}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          await setConnectChoice('google', { persist: true });
          if (googleBtn) {
            googleBtn.textContent = 'Connected';
            googleBtn.disabled = true;
          }
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.innerHTML = `<b>Google Calendar connected</b> as ${esc(data.calendar_email || customer.email)}.`;
          }
          const calData = OnboardingApi.fetchCalendarCalendars
            ? await OnboardingApi.fetchCalendarCalendars(customer.email)
            : await fetch(
                `${API_BASE}/api/calendar/calendars?email=${encodeURIComponent(customer.email)}`,
                { credentials: 'include' }
              ).then((r) => (r.ok ? r.json() : { calendars: [] }));
          await renderCalendarPicker(calData.calendars || data.calendars || [], data.calendar_id);
          if (calendarParam === 'connected') {
            setTimeout(() => showStep(3), 1200);
          }
        } else if (calendarChoice) {
          await setConnectChoice(calendarChoice, { persist: false });
        }
      }
    } catch (_) {}

    if (calendarParam === 'connected' && !calendarChoice) {
      await setConnectChoice('google', { persist: true });
    }
  }

  function connectGoogleCalendar() {
    if (!customer?.email) return;
    const returnUrl = `${window.location.origin}/business/voice-setup.html?step=2&calendar=connected`;
    window.location.href = `${API_BASE}/auth/google/calendar/connect?email=${encodeURIComponent(customer.email)}&returnUrl=${encodeURIComponent(returnUrl)}`;
  }

  function openSkipModal() {
    document.getElementById('skipCalendarModal')?.removeAttribute('hidden');
  }

  function closeSkipModal() {
    const modal = document.getElementById('skipCalendarModal');
    if (modal) modal.hidden = true;
  }

  async function loadForwardAck() {
    try {
      const onboard = OnboardingApi.fetchOnboarding
        ? await OnboardingApi.fetchOnboarding()
        : null;
      if (onboard?.onboarding_meta?.forward_line_ack) {
        const el = document.getElementById('setupForwardAck');
        if (el) el.checked = true;
      }
    } catch (_) {}
  }

  function startTestCallPoll() {
    if (testCallPollTimer) clearInterval(testCallPollTimer);
    const statusEl = document.getElementById('testCallStatus');
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.innerHTML = '<p class="sfd-muted" style="margin:0">Waiting for your test call…</p>';

    const poll = async () => {
      try {
        const data = OnboardingApi.fetchLatestTestCall
          ? await OnboardingApi.fetchLatestTestCall()
          : await fetch(`${API_BASE}/api/voice-agent/test-call/latest`, { credentials: 'include' }).then(
              (r) => (r.ok ? r.json() : null)
            );
        if (!data) return;
        if (data.success && data.transcript_excerpt) {
          statusEl.innerHTML = `<div class="sfd-callout"><b>Test call received.</b> “${esc(data.transcript_excerpt)}”</div>`;
          clearInterval(testCallPollTimer);
        } else if (data.success === false && data.call_at) {
          statusEl.innerHTML =
            '<div class="sfd-callout"><b>Call logged.</b> Transcript not available yet — try calling again.</div>';
        }
      } catch (_) {}
    };
    poll();
    testCallPollTimer = setInterval(poll, 5000);
  }

  async function markComplete(markLive) {
    const statusRes = await fetch(`${API_BASE}/api/voice-agent/config-status`, { credentials: 'include' });
    const statusJson = await statusRes.json().catch(() => ({}));
    if (!statusJson?.config_status?.ready) {
      const missing = (statusJson.config_status?.missing || []).join(', ');
      throw new Error(`Complete required setup first: ${missing || 'missing configuration'}`);
    }
    const res = await fetch(`${API_BASE}/api/voice-agent/setup-complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_live: !!markLive })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Setup could not be completed');
    }
    try {
      if (customer) {
        customer.voice_setup_completed_at = new Date().toISOString();
        customer.onboarding_state = markLive ? 'live' : 'voice_setup_complete';
        sessionStorage.setItem('customer', JSON.stringify(customer));
      }
    } catch (_) {}
  }

  async function init() {
    window.__voiceSetupReady = false;
    if (!(await loadCustomer())) return;
    hoursApi = VoiceHoursPicker.mount(document.getElementById('setupHoursPicker'), {});
    document.getElementById('setupCoverageMode')?.addEventListener('change', applyCoverageModeToHours);
    syncOutboundUi();
    const urlStepNow = parseInt(new URLSearchParams(window.location.search).get('step'), 10);
    if (Number.isFinite(urlStepNow) && urlStepNow >= 1 && urlStepNow <= WIZARD_STEPS) {
      step = urlStepNow;
    }
    showStep(step);

    document.getElementById('setupGreeting').addEventListener('input', schedulePreview);
    document.getElementById('setupOutboundOpener').addEventListener('input', schedulePreview);
    document.getElementById('setupOutboundEnabled').addEventListener('change', () => {
      syncOutboundUi();
      schedulePreview();
    });

    document.getElementById('setupNext1').addEventListener('click', async () => {
      try {
        const name = document.getElementById('setupPracticeName').value.trim();
        if (!name) return showError('Enter your practice name.');
        const transfer = document.getElementById('setupTransferNumber').value.trim();
        if (!transfer) return showError('Enter a warm transfer number for live handoffs.');
        document.getElementById('setupGreeting').value = VoiceHoursPicker.defaultGreeting(name);
        await saveSettings({
          language_mode: document.getElementById('setupLanguageMode').value,
          transfer_number: transfer,
          clinic_email: document.getElementById('setupClinicEmail')?.value?.trim() || null,
          practice_address: composeAddress(),
          npi: document.getElementById('setupNpi')?.value?.trim() || null,
          coverage_mode: mapCoverageModeUiToApi(document.getElementById('setupCoverageMode')?.value)
        });
        await markWizardStarted();
        showStep(2);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupConnectGoogle')?.addEventListener('click', connectGoogleCalendar);
    document.getElementById('setupUseSomoCal')?.addEventListener('click', async () => {
      document.getElementById('setupPmsType').value = 'somo';
      await setConnectChoice('somo');
    });
    document.getElementById('setupSkipConnect')?.addEventListener('click', openSkipModal);
    document.getElementById('skipCalendarCancel')?.addEventListener('click', closeSkipModal);
    document.getElementById('skipCalendarConfirm')?.addEventListener('click', async () => {
      closeSkipModal();
      try {
        await persistConnectMeta({ calendar_connection: 'skip', skip_calendar_warning_ack: true });
        await setConnectChoice('skip', { persist: false });
        showStep(3);
      } catch (e) {
        showError(e.message);
      }
    });
    document.getElementById('setupNext2')?.addEventListener('click', async () => {
      try {
        await ensureCalendarSelectionPersisted();
        showStep(3);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext3').addEventListener('click', async () => {
      try {
        const greeting = document.getElementById('setupGreeting').value.trim();
        if (!greeting) return showError('Enter an inbound greeting.');
        await saveSettings({ greeting });
        showStep(4);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext4').addEventListener('click', async () => {
      try {
        await saveSettings({
          greeting: document.getElementById('setupGreeting').value.trim(),
          after_hours_message: document.getElementById('setupAfterHours').value.trim(),
          business_hours: hoursApi.getValue()
        });
        showStep(5);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext5').addEventListener('click', async () => {
      try {
        await saveSettings(draftSettings({}));
        showStep(6);
        try {
          const billing = await VoiceAgentPage.fetchBillingStatus();
          if (billing?.twilio_phone_number) updatePhoneDisplay(billing.twilio_phone_number);
        } catch (_) {}
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupForwardAck')?.addEventListener('change', async (e) => {
      if (!e.target.checked) return;
      try {
        await persistConnectMeta({ forward_line_ack: true });
        showSuccess('Forwarding acknowledged — you can finish when ready.');
      } catch (err) {
        showError(err.message);
      }
    });

    document.getElementById('setupCopy').addEventListener('click', () => {
      const n = document.getElementById('setupPhone').textContent;
      if (n && !n.includes('…')) navigator.clipboard?.writeText(n);
    });

    async function finish(dest) {
      try {
        await markComplete(dest.includes('agent'));
      } catch (e) {
        showError(e.message || 'Could not complete setup');
        return;
      }
      window.location.href = dest;
    }

    document.getElementById('setupFinish').addEventListener('click', () =>
      finish('today.html#go-live-checklist')
    );
    document.getElementById('setupSkip').addEventListener('click', () => finish('agent.html'));
    window.__voiceSetupReady = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
