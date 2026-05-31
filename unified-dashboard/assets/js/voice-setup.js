(function () {
  const API_BASE = (
    typeof resolveApiBase === 'function'
      ? resolveApiBase()
      : (window.API_BASE || window.location.origin)
  ).replace(/\/$/, '');
  let step = 1;
  let hoursApi = null;
  let customer = null;

  function showError(msg) {
    const el = document.getElementById('setupError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function showStep(n) {
    step = n;
    document.getElementById('step1').classList.toggle('hidden', n !== 1);
    document.getElementById('step2').classList.toggle('hidden', n !== 2);
    document.getElementById('step3').classList.toggle('hidden', n !== 3);
    document.getElementById('setupEyebrow').textContent = `Step ${n} of 3`;
    const titles = ['Your greeting', 'Office hours', 'Test your line'];
    const subs = [
      'This is the first thing callers hear when they dial your line.',
      'Set when Kelly answers live vs after-hours message.',
      'No simulated test — call the number yourself.'
    ];
    document.getElementById('setupTitle').textContent = titles[n - 1];
    document.getElementById('setupSub').textContent = subs[n - 1];
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
    document.getElementById('setupGreeting').value = VoiceHoursPicker.defaultGreeting(name);
    document.getElementById('setupAfterHours').value =
      'Thank you for calling. We are currently closed. Please call back during our office hours.';
    const phone = customer.twilio_phone_number;
    if (phone) {
      document.getElementById('setupPhone').textContent = phone;
      document.getElementById('setupCall').href = 'tel:' + phone.replace(/\s/g, '');
    }
    return true;
  }

  async function saveSettings(partial) {
    const existing = await VoiceAgentPage.fetchVoiceSettings();
    await VoiceAgentPage.saveVoiceSettings({
      enabled: true,
      retell_agent_id: existing?.retell_agent_id || customer?.retell_agent_id || null,
      greeting: partial.greeting ?? existing?.greeting ?? null,
      after_hours_message: partial.after_hours_message ?? existing?.after_hours_message ?? null,
      business_hours: partial.business_hours ?? existing?.business_hours ?? null
    });
  }

  async function markComplete() {
    await fetch(`${API_BASE}/api/voice-agent/setup-complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    try {
      if (customer) {
        customer.voice_setup_completed_at = new Date().toISOString();
        sessionStorage.setItem('customer', JSON.stringify(customer));
      }
    } catch (_) {}
  }

  async function init() {
    if (!(await loadCustomer())) return;
    hoursApi = VoiceHoursPicker.mount(document.getElementById('setupHoursPicker'), {});

    document.getElementById('setupNext1').addEventListener('click', async () => {
      try {
        await saveSettings({
          greeting: document.getElementById('setupGreeting').value.trim()
        });
        showStep(2);
      } catch (e) {
        showError(e.message);
      }
    });

    document.getElementById('setupNext2').addEventListener('click', async () => {
      try {
        await saveSettings({
          greeting: document.getElementById('setupGreeting').value.trim(),
          after_hours_message: document.getElementById('setupAfterHours').value.trim(),
          business_hours: hoursApi.getValue()
        });
        showStep(3);
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
        await markComplete();
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
