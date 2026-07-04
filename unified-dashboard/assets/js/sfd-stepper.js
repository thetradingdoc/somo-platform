/**
 * Render canonical 7-step onboarding stepper (FD-033, FD-011).
 * Steps: Invite → Profile → Connect → Voice → Hours → Outbound → Live
 */
(function (global) {
  const STEPS = [
    { key: 'invite', label: 'Invite' },
    { key: 'profile', label: 'Profile' },
    { key: 'connect', label: 'Connect' },
    { key: 'voice', label: 'Voice' },
    { key: 'hours', label: 'Hours' },
    { key: 'outbound', label: 'Outbound' },
    { key: 'live', label: 'Live' }
  ];

  const KEY_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i + 1]));

  function renderStepper(container, { current = 'profile', completedThrough = 0 } = {}) {
    if (!container) return;
    const currentIdx = typeof current === 'number' ? current : KEY_INDEX[current] || 1;
    const doneThrough = Math.max(completedThrough, currentIdx - 1);

    const parts = [];
    STEPS.forEach((step, i) => {
      const n = i + 1;
      let cls = 'sfd-step';
      let mark = String(n);
      if (n < currentIdx || n <= doneThrough) {
        cls += ' sfd-step--done';
        mark = '✓';
      } else if (n === currentIdx) {
        cls += ' sfd-step--current';
      }
      parts.push(
        `<div class="${cls}"><span class="sfd-step__n">${mark}</span>${step.label}</div>`
      );
      if (i < STEPS.length - 1) {
        parts.push('<div class="sfd-step-sep" aria-hidden="true"></div>');
      }
    });

    container.className = 'sfd-stepper';
    container.setAttribute('role', 'progressbar');
    container.setAttribute('aria-valuemin', '1');
    container.setAttribute('aria-valuemax', String(STEPS.length));
    container.setAttribute('aria-valuenow', String(currentIdx));
    container.setAttribute('aria-label', 'Setup progress');
    container.innerHTML = parts.join('');
  }

  global.SfdStepper = { STEPS, KEY_INDEX, renderStepper };
})(typeof window !== 'undefined' ? window : global);
