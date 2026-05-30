/**
 * Somo signup wizard — step flow from landing to trial activation
 */
(function () {
  'use strict';

  const API_BASE = (typeof resolveApiBase === 'function' ? resolveApiBase() : window.location.origin.replace(/\/$/, ''));
  const PREFILL_KEY = 'somo_signup_prefill';
  const BRAND_ASSETS = '/unified-dashboard/assets/brand';
  const PERSONA_ICONS = `${BRAND_ASSETS}/signup`;

  const STEPS = {
    persona: 'persona',
    business: 'business',
    location: 'location',
    credentials: 'credentials',
    email: 'email',
    phone: 'phone',
    terms: 'terms'
  };

  const PERSONAS = [
    {
      id: 'healthcare_clinic',
      iconFile: 'icon-clinic.svg',
      title: 'Clinic / healthcare',
      sub: 'Appointments, patient calls, front desk'
    },
    {
      id: 'small_business',
      iconFile: 'icon-business.svg',
      title: 'Small business',
      sub: 'Calls, bookings, and customer FAQs'
    },
    {
      id: 'field_services',
      iconFile: 'icon-trades.svg',
      title: 'Home services / trades',
      sub: 'After-hours calls and scheduling'
    },
    {
      id: 'other',
      iconFile: 'icon-other.svg',
      title: 'Other',
      sub: 'We will tailor your AI front desk'
    }
  ];

  const USE_CASE_TO_PERSONA = {
    receptionist: 'small_business',
    appointment_setter: 'small_business',
    lead_qualification: 'small_business',
    customer_service: 'small_business',
    debt_collection: 'other',
    survey: 'other',
    healthcare_clinic: 'healthcare_clinic',
    dental_front_desk: 'healthcare_clinic',
    medical_clinic: 'healthcare_clinic',
    specialty_practice: 'healthcare_clinic',
    bilingual_front_desk: 'healthcare_clinic',
    after_hours: 'healthcare_clinic',
    patient_billing: 'healthcare_clinic'
  };

  const state = {
    step: STEPS.persona,
    trialSimFlow: null,
    pendingEmail: '',
    pendingCustomerId: null,
    phoneE164: '',
    phoneSmsSent: false,
    dedicatedLine: null,
    revealShown: false,
    submitting: false
  };

  const draft = {
    persona: '',
    use_case: 'small_business',
    name: '',
    company_name: '',
    email: '',
    country_code: '+1',
    phone_raw: '',
    country: '',
    country_code_iso: 'US',
    city: '',
    postal_code: '',
    medical_specialty: '',
    license_number: '',
    license_state: ''
  };

  const urlParams = new URLSearchParams(window.location.search);

  function attribution() {
    return {
      utm_source: urlParams.get('utm_source'),
      utm_campaign: urlParams.get('utm_campaign'),
      utm_medium: urlParams.get('utm_medium'),
      signup_persona: draft.persona || null
    };
  }

  function showCredentialsStep() {
    return draft.persona === 'healthcare_clinic';
  }

  function orderedSteps() {
    const list = [STEPS.persona, STEPS.business, STEPS.location];
    if (showCredentialsStep()) list.push(STEPS.credentials);
    list.push(STEPS.email);
    if (state.trialSimFlow !== false) list.push(STEPS.phone);
    list.push(STEPS.terms);
    return list;
  }

  function stepIndex() {
    const list = orderedSteps();
    const idx = list.indexOf(state.step);
    return idx >= 0 ? idx : 0;
  }

  function totalSteps() {
    return orderedSteps().length;
  }

  function progressPercent() {
    const t = totalSteps();
    if (t <= 1) return 100;
    return Math.round(((stepIndex() + 1) / t) * 100);
  }

  function syncUrl() {
    const q = new URLSearchParams(window.location.search);
    q.set('step', state.step);
    const utm = ['utm_source', 'utm_campaign', 'utm_medium'];
    utm.forEach((k) => {
      const v = urlParams.get(k);
      if (v) q.set(k, v);
    });
    window.history.replaceState({ step: state.step }, '', `${window.location.pathname}?${q}`);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(id, msg, type) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `signup-toast ${type || 'error'}`;
    el.classList.remove('hidden');
  }

  function hideToast(id) {
    const el = $(id);
    if (el) el.classList.add('hidden');
  }

  function showStep(stepId) {
    state.step = stepId;
    document.querySelectorAll('[data-signup-step]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.signupStep !== stepId);
    });
    const backBtn = $('signupBack');
    if (backBtn) {
      backBtn.disabled = false;
      backBtn.setAttribute(
        'aria-label',
        stepId === STEPS.persona ? 'Back to home' : 'Previous step'
      );
    }

    const meta = $('signupProgressMeta');
    const fill = $('signupProgressFill');
    if (meta) meta.textContent = `Step ${stepIndex() + 1} of ${totalSteps()}`;
    if (fill) fill.style.width = `${progressPercent()}%`;

    syncUrl();
    hideToast('signupError');

    if (stepId === STEPS.phone && !state.revealShown) {
      enterPhoneStep();
    }

    const btn = $('signupContinueBtn');
    if (btn) {
      btn.classList.toggle('hidden', stepId === STEPS.persona);
      const labels = {
        [STEPS.persona]: 'Continue',
        [STEPS.business]: 'Continue',
        [STEPS.location]: showCredentialsStep() ? 'Continue' : 'Create account',
        [STEPS.credentials]: 'Create account',
        [STEPS.email]: 'Verify email',
        [STEPS.phone]: state.revealShown ? 'Continue to terms' : 'Verify and get my number',
        [STEPS.terms]: 'Start my free trial'
      };
      btn.textContent = labels[stepId] || 'Continue';
    }
  }

  function landingUrl() {
    const q = new URLSearchParams();
    const utm = urlParams.get('utm_source');
    if (utm) q.set('utm_source', utm);
    const qs = q.toString();
    return qs ? `/?${qs}` : '/';
  }

  function prevStep() {
    const list = orderedSteps();
    const idx = list.indexOf(state.step);
    if (idx > 0) {
      showStep(list[idx - 1]);
      return;
    }
    const ref = document.referrer;
    if (ref) {
      try {
        const refUrl = new URL(ref);
        if (refUrl.origin === window.location.origin) {
          window.location.href = ref;
          return;
        }
      } catch (_) {
        /* ignore bad referrer */
      }
    }
    window.location.href = landingUrl();
  }

  function nextStep() {
    const list = orderedSteps();
    const idx = list.indexOf(state.step);
    if (idx < list.length - 1) showStep(list[idx + 1]);
  }

  function applyPrefill() {
    try {
      const raw = sessionStorage.getItem(PREFILL_KEY);
      if (!raw) return;
      const pre = JSON.parse(raw);
      if (pre.name) draft.name = pre.name;
      if (pre.phone) {
        const digits = String(pre.phone).replace(/\D/g, '');
        if (digits.length >= 10) {
          if (String(pre.phone).startsWith('+')) {
            draft.phone_raw = digits.slice(-10);
          } else {
            draft.phone_raw = digits.slice(-10);
          }
        }
      }
      if (pre.use_case) {
        draft.persona = USE_CASE_TO_PERSONA[pre.use_case] || 'small_business';
        draft.use_case = draft.persona;
      }
    } catch (_) {
      /* ignore */
    }
  }

  function buildE164() {
    const dial = (draft.country_code || '+1').replace(/\s/g, '');
    const digits = (draft.phone_raw || '').replace(/\D/g, '');
    return digits ? dial + digits : '';
  }

  function buildSignupPayload() {
    const payload = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone_number: buildE164(),
      company_name: draft.company_name.trim() || null,
      customer_type: 'saas',
      use_case: draft.use_case,
      city: draft.city.trim(),
      postal_code: draft.postal_code.trim(),
      country: draft.country,
      country_code: draft.country_code_iso,
      api_features: ['voice_agent'],
      attribution: attribution()
    };
    if (draft.medical_specialty && draft.license_number && draft.license_state) {
      payload.medical_specialty = draft.medical_specialty;
      payload.license_number = draft.license_number.trim();
      payload.license_state = draft.license_state;
    }
    return payload;
  }

  function validatePersona() {
    if (!draft.persona) {
      showToast('signupError', 'Choose the option that best describes you.');
      return false;
    }
    return true;
  }

  function validateBusiness() {
    if (!draft.name.trim()) {
      showToast('signupError', 'Enter your name.');
      return false;
    }
    if (!draft.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) {
      showToast('signupError', 'Enter a valid work email.');
      return false;
    }
    if (!buildE164()) {
      showToast('signupError', 'Enter a valid mobile number.');
      return false;
    }
    return true;
  }

  function validateLocation() {
    if (!draft.country || !draft.city.trim() || !draft.postal_code.trim()) {
      showToast('signupError', 'Complete your location so we can assign a local number.');
      return false;
    }
    return true;
  }

  async function submitSignup() {
    hideToast('signupError');
    const btn = $('signupContinueBtn');
    if (btn) btn.disabled = true;
    state.submitting = true;

    try {
      const res = await fetch(`${API_BASE}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildSignupPayload())
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || data.error || 'Signup failed');

      state.pendingEmail = data.email || draft.email;
      state.pendingCustomerId = data.customer_id;
      state.phoneE164 = buildE164();
      draft.email = state.pendingEmail;

      const instr = $('codeInstructions');
      if (instr) {
        instr.textContent = `We sent a 6-digit code to ${state.pendingEmail}. Check spam if you do not see it.`;
      }
      document.querySelectorAll('#signupCodeGrid input').forEach((i) => {
        i.value = '';
      });
      showStep(STEPS.email);
      document.querySelector('#signupCodeGrid input')?.focus();
    } catch (err) {
      showToast('signupError', err.message);
    } finally {
      state.submitting = false;
      if (btn) btn.disabled = false;
    }
  }

  async function verifyEmailCode() {
    hideToast('signupError');
    const inputs = document.querySelectorAll('#signupCodeGrid input');
    const code = Array.from(inputs)
      .map((i) => i.value)
      .join('');
    if (code.length !== 6) {
      showToast('signupError', 'Enter the 6-digit code.');
      return;
    }

    const btn = $('signupVerifyEmailBtn');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/signup/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: state.pendingEmail, code })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || data.error || 'Verification failed');

      if (data.customer && typeof persistProviderCustomer === 'function') {
        persistProviderCustomer(data.customer);
      } else if (typeof hydrateProviderSession === 'function') {
        await hydrateProviderSession(API_BASE);
      }

      state.trialSimFlow = data.trial_sim_flow === true;
      if (state.trialSimFlow) {
        state.phoneSmsSent = false;
        state.revealShown = false;
        showStep(STEPS.phone);
      } else {
        showStep(STEPS.terms);
      }
    } catch (err) {
      showToast('signupError', err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendPhoneSms() {
    const phone = state.phoneE164 || buildE164();
    const res = await fetch(`${API_BASE}/api/signup/verify-phone/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone_number: phone })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to send SMS code');
    state.phoneSmsSent = true;
    const hint = $('phoneSmsHint');
    if (hint) {
      hint.textContent = 'Code sent. Check your messages.';
      hint.classList.remove('hidden');
    }
  }

  async function enterPhoneStep() {
    const input = $('signupPhoneDisplay');
    if (input) input.value = state.phoneE164 || buildE164();
    if (!state.phoneSmsSent && !state.revealShown) {
      try {
        await sendPhoneSms();
      } catch (err) {
        showToast('signupError', err.message);
      }
    }
  }

  async function verifyPhoneAndReveal() {
    hideToast('signupError');
    const code = ($('signupPhoneCode')?.value || '').replace(/\D/g, '');
    if (code.length < 4) {
      showToast('signupError', 'Enter the SMS code.');
      return;
    }

    const btn = $('signupVerifyPhoneBtn');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/signup/verify-phone/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          phone_number: state.phoneE164 || buildE164(),
          code
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Verification failed');

      const line = data.trial?.twilio_phone_number || data.customer?.twilio_phone_number;
      if (data.trial_sim_flow && !line) {
        throw new Error(
          'We could not assign your dedicated line yet. Please try again or contact support.'
        );
      }

      if (data.customer && typeof persistProviderCustomer === 'function') {
        persistProviderCustomer(data.customer);
      }

      state.dedicatedLine = line;
      state.revealShown = true;
      state.trialSimFlow = data.trial_sim_flow === true;

      const revealPanel = $('signupReveal');
      const phoneForm = $('signupPhoneForm');
      if (line && revealPanel) {
        $('signupRevealNumber').textContent = line;
        revealPanel.classList.remove('hidden');
        if (phoneForm) phoneForm.classList.add('hidden');
        const callBtn = $('signupCallLine');
        if (callBtn) callBtn.href = `tel:${line.replace(/\s/g, '')}`;
      } else if (!data.trial_sim_flow) {
        showStep(STEPS.terms);
      }
    } catch (err) {
      showToast('signupError', err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function acceptTerms() {
    hideToast('signupError');
    const check = $('signupTermsCheck');
    if (!check?.checked) {
      showToast('signupError', 'Please accept the Terms of Service to continue.');
      return;
    }

    const btn = $('signupAcceptTermsBtn');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/signup/accept-terms?customer_type=saas`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.message || 'Could not accept terms');

      if (data.customer && typeof persistProviderCustomer === 'function') {
        persistProviderCustomer(data.customer);
      }

      window.location.href = data.redirect || '/business/trial-activation.html?welcome=1';
    } catch (err) {
      showToast('signupError', err.message);
      if (btn) btn.disabled = false;
    }
  }

  function copyLine() {
    if (!state.dedicatedLine) return;
    navigator.clipboard?.writeText(state.dedicatedLine).then(() => {
      showToast('signupError', 'Number copied!', 'success');
    });
  }

  function populateCountries() {
    const sel = $('signupCountry');
    if (!sel || !window.ProviderSignupData) return;
    ProviderSignupData.COUNTRIES.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      opt.dataset.code = c.code;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      draft.country = sel.value;
      draft.country_code_iso = opt?.dataset?.code || '';
      loadCities();
    });
  }

  function loadCities() {
    const cityInput = $('signupCity');
    const list = $('signupCityList');
    if (!list || !draft.country) return;
    list.innerHTML = '';
    fetch('https://countriesnow.space/api/v0.1/countries/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: draft.country })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.data && Array.isArray(data.data)) {
          data.data.forEach((city) => {
            const opt = document.createElement('option');
            opt.value = city;
            list.appendChild(opt);
          });
        }
      })
      .catch(() => {});
  }

  function populateLicenseStates() {
    const sel = $('signupLicenseState');
    if (!sel || !window.ProviderSignupData) return;
    ProviderSignupData.US_STATES.forEach((st) => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      sel.appendChild(opt);
    });
  }

  function bindPersonaCards() {
    const grid = $('signupPersonaGrid');
    if (!grid) return;
    grid.innerHTML = '';
    PERSONAS.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'signup-persona-card' + (draft.persona === p.id ? ' selected' : '');
      btn.dataset.persona = p.id;
      btn.innerHTML = `<span class="signup-persona-icon" aria-hidden="true">
          <img src="${PERSONA_ICONS}/${p.iconFile}" alt="" width="24" height="24" loading="lazy" />
        </span>
        <div class="signup-persona-copy"><h3>${p.title}</h3><p>${p.sub}</p></div>`;
      btn.addEventListener('click', () => {
        draft.persona = p.id;
        draft.use_case = p.id;
        grid.querySelectorAll('.signup-persona-card').forEach((c) => c.classList.remove('selected'));
        btn.classList.add('selected');
        setTimeout(() => nextStep(), 280);
      });
      grid.appendChild(btn);
    });
  }

  function bindCodeInputs() {
    const inputs = document.querySelectorAll('#signupCodeGrid input');
    inputs.forEach((input, index) => {
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
        if (e.target.value && index < inputs.length - 1) inputs[index + 1].focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) inputs[index - 1].focus();
      });
    });
  }

  function readFormFields() {
    draft.name = $('signupName')?.value || draft.name;
    draft.company_name = $('signupCompany')?.value || '';
    draft.email = $('signupEmail')?.value || draft.email;
    draft.country_code = $('signupDialCode')?.value || '+1';
    draft.phone_raw = $('signupPhone')?.value || '';
    draft.city = $('signupCity')?.value || '';
    draft.postal_code = $('signupPostal')?.value || '';
    draft.medical_specialty = $('signupSpecialty')?.value || '';
    draft.license_number = $('signupLicenseNumber')?.value || '';
    draft.license_state = $('signupLicenseState')?.value || '';
    const countrySel = $('signupCountry');
    if (countrySel?.value) {
      draft.country = countrySel.value;
      draft.country_code_iso = countrySel.selectedOptions[0]?.dataset?.code || draft.country_code_iso;
    }
  }

  function fillFormFields() {
    if ($('signupName')) $('signupName').value = draft.name;
    if ($('signupCompany')) $('signupCompany').value = draft.company_name;
    if ($('signupEmail')) $('signupEmail').value = draft.email;
    if ($('signupDialCode')) $('signupDialCode').value = draft.country_code;
    if ($('signupPhone')) $('signupPhone').value = draft.phone_raw;
    if ($('signupCity')) $('signupCity').value = draft.city;
    if ($('signupPostal')) $('signupPostal').value = draft.postal_code;
  }

  function onContinue() {
    readFormFields();
    hideToast('signupError');

    if (state.step === STEPS.persona) {
      if (!validatePersona()) return;
      nextStep();
      return;
    }
    if (state.step === STEPS.business) {
      if (!validateBusiness()) return;
      nextStep();
      return;
    }
    if (state.step === STEPS.location) {
      if (!validateLocation()) return;
      if (showCredentialsStep()) {
        nextStep();
      } else {
        submitSignup();
      }
      return;
    }
    if (state.step === STEPS.credentials) {
      if (draft.medical_specialty && (!draft.license_number.trim() || !draft.license_state)) {
        showToast(
          'signupError',
          'Enter license number and state, or clear specialty to skip.'
        );
        return;
      }
      submitSignup();
      return;
    }
    if (state.step === STEPS.email) {
      verifyEmailCode();
      return;
    }
    if (state.step === STEPS.phone) {
      if (state.revealShown) {
        nextStep();
      } else {
        verifyPhoneAndReveal();
      }
      return;
    }
    if (state.step === STEPS.terms) {
      acceptTerms();
    }
  }

  async function resendEmailCode() {
    hideToast('signupError');
    try {
      const res = await fetch(`${API_BASE}/api/signup/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: state.pendingEmail })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Unable to resend');
      showToast('signupError', 'New code sent. Check your email.', 'success');
    } catch (err) {
      showToast('signupError', err.message);
    }
  }

  async function resumeFromSession() {
    if (typeof hydrateProviderSession !== 'function') return;
    const customer = await hydrateProviderSession(API_BASE);
    if (!customer?.email) return;

    state.pendingEmail = customer.email;
    draft.email = customer.email;
    state.phoneE164 = customer.phone_number || '';

    if (!customer.email_verified) {
      showStep(STEPS.email);
      return;
    }

    if (customer.trial_status === 'active') {
      window.location.href = '/business/trial-activation.html?welcome=1';
      return;
    }

    const sessionRes = await fetch(`${API_BASE}/api/signup/session`, { credentials: 'include' });
    const sessionData = await sessionRes.json().catch(() => ({}));
    state.trialSimFlow = sessionData.trial_sim_flow === true;

    if (state.trialSimFlow && !customer.phone_verified) {
      showStep(STEPS.phone);
      return;
    }

    if (customer.email_verified) {
      if (customer.phone_verified && customer.twilio_phone_number) {
        state.dedicatedLine = customer.twilio_phone_number;
        state.revealShown = true;
      }
      showStep(STEPS.terms);
    }
  }

  function init() {
    applyPrefill();
    populateCountries();
    const countrySel = $('signupCountry');
    if (countrySel) {
      for (const opt of countrySel.options) {
        if (opt.dataset?.code === 'US') {
          opt.selected = true;
          draft.country = opt.value;
          draft.country_code_iso = 'US';
          break;
        }
      }
    }
    populateLicenseStates();
    bindPersonaCards();
    bindCodeInputs();
    fillFormFields();

    const stepParam = urlParams.get('step');
    if (stepParam && Object.values(STEPS).includes(stepParam)) {
      state.step = stepParam;
    }

    $('signupBack')?.addEventListener('click', prevStep);
    $('signupContinueBtn')?.addEventListener('click', onContinue);
    $('signupResendEmail')?.addEventListener('click', (e) => {
      e.preventDefault();
      resendEmailCode();
    });
    $('signupCopyLine')?.addEventListener('click', (e) => {
      e.preventDefault();
      copyLine();
    });
    $('signupResendSms')?.addEventListener('click', async (e) => {
      e.preventDefault();
      state.phoneSmsSent = false;
      try {
        await sendPhoneSms();
        showToast('signupError', 'SMS code resent.', 'success');
      } catch (err) {
        showToast('signupError', err.message);
      }
    });

    showStep(state.step);
    resumeFromSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
