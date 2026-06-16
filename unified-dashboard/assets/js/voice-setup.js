(function () {
  const API_BASE = (
    typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (window.API_BASE || window.location.origin)
  ).replace(/\/$/, '');
  const urlStep = parseInt(new URLSearchParams(window.location.search).get('step'), 10);
  let step = Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= 5 ? urlStep : 1;
  let hoursApi = null;
  let customer = null;
  let previewTimer = null;

  const STEP_META = [
    { title: 'Your practice', sub: 'Confirm how Kelly introduces your office.' },
    { title: 'Inbound greeting', sub: 'What callers hear when they dial in.' },
    { title: 'Office hours', sub: 'When Kelly answers live vs after-hours.' },
    { title: 'Outbound calls', sub: 'Optional — what Kelly says when calling out.' },
    { title: 'Test your line', sub: 'Call your number and hear your greeting.' }
  ];

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

  function showStep(n) {
    step = n;
    for (let i = 1; i <= 5; i++) {
      document.getElementById(`step${i}`)?.classList.toggle('hidden', n !== i);
    }
    document.getElementById('setupEyebrow').textContent = `Step ${n} of 5`;
    document.getElementById('setupTitle').textContent = STEP_META[n - 1].title;
    document.getElementById('setupSub').textContent = STEP_META[n - 1].sub;
    const prog = document.getElementById('setupProgress');
    if (prog) {
      prog.innerHTML = STEP_META.map(
        (_, i) =>
          `<span class="va-wizard-dot${i + 1 <= n ? ' va-wizard-dot--active' : ''}${i + 1 < n ? ' va-wizard-dot--done' : ''}"></span>`
      ).join('');
    }
    if (n === 2 || n === 4) schedulePreview();
  }

  async function markWizardStarted() {
    await fetch(`${API_BASE}/api/voice-agent/onboarding/wizard-started`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wizard_step: step })
    }).catch(() => {});
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
    const name = customer.company_name || customer.name || 'our office';
    document.getElementById('setupPracticeName').value = name;
    document.getElementById('setupGreeting').value = VoiceHoursPicker.defaultGreeting(name);
    document.getElementById('setupAfterHours').value =
      'Thank you for calling. We are currently closed. Please call back during our office hours.';
    document.getElementById('setupOutboundOpener').value =
      `Hi, I'm Kelly from ${name}. Is now still a good time to talk?`;
    const phone = customer.twilio_phone_number;
    if (phone) {
      document.getElementById('setupPhone').textContent = phone;
      document.getElementById('setupCall').href = 'tel:' + phone.replace(/\s/g, '');
    }
    try {
      const settings = await VoiceAgentPage.fetchVoiceSettings();
      if (settings?.greeting) document.getElementById('setupGreeting').value = settings.greeting;
      if (settings?.outbound_opener) {
        document.getElementById('setupOutboundOpener').value = settings.outbound_opener;
      }
      if (settings?.outbound_enabled) {
        document.getElementById('setupOutboundEnabled').checked = true;
      }
      if (settings?.tone_preset) document.getElementById('setupTone').value = settings.tone_preset;
    } catch (_) {}
    return true;
  }

  function draftSettings(partial) {
    return {
      greeting: partial.greeting ?? document.getElementById('setupGreeting').value.trim(),
      after_hours_message:
        partial.after_hours_message ?? document.getElementById('setupAfterHours').value.trim(),
      business_hours: partial.business_hours ?? hoursApi?.getValue?.() ?? null,
      outbound_opener:
        partial.outbound_opener ?? document.getElementById('setupOutboundOpener').value.trim(),
      outbound_enabled:
        partial.outbound_enabled ?? document.getElementById('setupOutboundEnabled').checked,
      tone_preset: partial.tone_preset ?? document.getElementById('setupTone').value
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
    const target = step === 4 ? 'setupOutboundPreview' : 'setupPreview';
    const el = document.getElementById(target);
    if (!el) return;
    try {
      const data = await VoicePreview.fetchPreview({
        greeting: document.getElementById('setupGreeting').value.trim(),
        outbound_opener: document.getElementById('setupOutboundOpener').value.trim(),
        outbound_enabled: document.getElementById('setupOutboundEnabled').checked,
        tone_preset: document.getElementById('setupTone').value
      });
      VoicePreview.renderPreviewCards(el, data);
    } catch (_) {}
  }

  async function markComplete(markLive) {
    await fetch(`${API_BASE}/api/voice-agent/setup-complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_live: !!markLive })
    });
    try {
      if (customer) {
        customer.voice_setup_completed_at = new Date().toISOString();
        customer.onboarding_state = markLive ? 'live' : 'voice_setup_complete';
        sessionStorage.setItem('customer', JSON.stringify(customer));
      }
    } catch (_) {}
  }

  async function init() {
    if (!(await loadCustomer())) return;
    await markWizardStarted();
    hoursApi = VoiceHoursPicker.mount(document.getElementById('setupHoursPicker'), {});
    showStep(step);

    document.getElementById('setupGreeting').addEventListener('input', schedulePreview);
    document.getElementById('setupOutboundOpener').addEventListener('input', schedulePreview);
    document.getElementById('setupOutboundEnabled').addEventListener('change', schedulePreview);

    document.getElementById('setupNext1').addEventListener('click', async () => {
      try {
        const name = document.getElementById('setupPracticeName').value.trim();
        if (!name) return showError('Enter your practice name.');
        document.getElementById('setupGreeting').value = VoiceHoursPicker.defaultGreeting(name);
        await saveSettings({ tone_preset: document.getElementById('setupTone').value });
        showStep(2);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext2').addEventListener('click', async () => {
      try {
        const greeting = document.getElementById('setupGreeting').value.trim();
        if (!greeting) return showError('Enter an inbound greeting.');
        await saveSettings({ greeting });
        showStep(3);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext3').addEventListener('click', async () => {
      try {
        await saveSettings({
          greeting: document.getElementById('setupGreeting').value.trim(),
          after_hours_message: document.getElementById('setupAfterHours').value.trim(),
          business_hours: hoursApi.getValue()
        });
        showStep(4);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext4').addEventListener('click', async () => {
      try {
        await saveSettings(draftSettings({}));
        showStep(5);
        try {
          const billing = await VoiceAgentPage.fetchBillingStatus();
          if (billing?.twilio_phone_number) {
            document.getElementById('setupPhone').textContent = billing.twilio_phone_number;
            document.getElementById('setupCall').href =
              'tel:' + billing.twilio_phone_number.replace(/\s/g, '');
          }
        } catch (_) {}
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupCopy').addEventListener('click', () => {
      const n = document.getElementById('setupPhone').textContent;
      if (n && !n.includes('…')) navigator.clipboard?.writeText(n);
    });

    async function finish(dest) {
      try {
        await markComplete(dest.includes('agent'));
      } catch (_) {}
      window.location.href = dest;
    }

    document.getElementById('setupFinish').addEventListener('click', () => finish('agent.html'));
    document.getElementById('setupSkip').addEventListener('click', () => finish('agent.html'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
