(function () {
  const API = (window.API_BASE || window.location.origin).replace(/\/$/, '');
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || '';

  let invitePracticeName = '';

  const els = {
    title: document.getElementById('inviteTitle'),
    sub: document.getElementById('inviteSub'),
    error: document.getElementById('inviteError'),
    form: document.getElementById('inviteForm'),
    practice: document.getElementById('invitePractice'),
    email: document.getElementById('inviteEmail'),
    password: document.getElementById('invitePassword'),
    confirm: document.getElementById('inviteConfirm'),
    passwordErr: document.getElementById('invitePasswordErr'),
    confirmErr: document.getElementById('inviteConfirmErr'),
    baa: document.getElementById('inviteBaa'),
    submit: document.getElementById('inviteSubmit'),
    card: document.getElementById('inviteCard')
  };

  function showError(msg) {
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function showState({ title, sub, hideForm }) {
    if (title) els.title.textContent = title;
    if (sub) els.sub.textContent = sub;
    if (hideForm) els.form.hidden = true;
  }

  function updateSubmitGate() {
    const pw = els.password.value;
    const pwOk = pw.length >= 8 && pw === els.confirm.value;
    if (els.passwordErr) {
      els.passwordErr.hidden = pw.length === 0 || pw.length >= 8;
      els.passwordErr.textContent = pw.length > 0 && pw.length < 8 ? 'Password must be at least 8 characters.' : '';
    }
    if (els.confirmErr) {
      els.confirmErr.hidden = !els.confirm.value || pw === els.confirm.value;
      els.confirmErr.textContent = els.confirm.value && pw !== els.confirm.value ? 'Passwords do not match.' : '';
    }
    const ready = els.baa.checked && pwOk;
    els.submit.disabled = !ready;
  }

  function bindForm() {
    ['input', 'change'].forEach((ev) => {
      els.baa.addEventListener(ev, updateSubmitGate);
      els.password.addEventListener(ev, updateSubmitGate);
      els.confirm.addEventListener(ev, updateSubmitGate);
    });
    updateSubmitGate();

    els.form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      els.error.hidden = true;
      if (els.password.value !== els.confirm.value) {
        showError('Passwords do not match.');
        return;
      }
      if (!els.baa.checked) {
        showError('Please accept the Business Associate Agreement.');
        return;
      }
      els.submit.disabled = true;
      els.submit.textContent = 'Creating account…';
      try {
        const res = await fetch(`${API}/api/invites/${encodeURIComponent(code)}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: invitePracticeName || els.practice.value.trim() || 'Practice Admin',
            password: els.password.value,
            baa_acknowledged: true
          })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Accept failed');
        window.location.href = data.redirect || '/business/voice-setup.html?step=1';
      } catch (e) {
        showError(e.message);
        els.submit.disabled = false;
        els.submit.textContent = 'Continue to voice setup';
        updateSubmitGate();
      }
    });
  }

  async function init() {
    if (!code) {
      showState({
        title: 'Invalid invite link',
        sub: 'Ask your Somo contact to send a new invite.',
        hideForm: true
      });
      showError('Missing invite code.');
      return;
    }

    try {
      const res = await fetch(`${API}/api/invites/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.success) {
        const errCode = data.error || 'Invalid invite';
        if (errCode === 'invite_expired') {
          showState({
            title: 'This invite has expired',
            sub: 'Contact Somo support or your account manager for a new link.',
            hideForm: true
          });
          showError('Invite expired — request a new one.');
          return;
        }
        if (errCode === 'invite_already_used') {
          showState({
            title: 'Invite already accepted',
            sub: 'Redirecting you to sign in…',
            hideForm: true
          });
          els.error.hidden = true;
          setTimeout(() => {
            window.location.href = '/login?redirect=' + encodeURIComponent('/business/voice-setup.html');
          }, 2000);
          return;
        }
        throw new Error(errCode);
      }

      const inv = data.invite;
      invitePracticeName = inv.practice_name || '';
      els.email.value = inv.email || '';
      if (inv.practice_name) {
        els.practice.value = inv.practice_name;
        els.title.textContent = `Welcome, ${inv.practice_name}`;
      }
      els.sub.textContent = 'Create your account to configure Kelly for your front desk.';
      bindForm();
    } catch (e) {
      const msg = String(e.message || '');
      showState({ hideForm: true });
      showError(msg || 'Could not load invite.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
