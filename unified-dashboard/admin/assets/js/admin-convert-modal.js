/**
 * Shared convert-lead modal (FD-067–074, FD-071, FD-149).
 */
(function (global) {
  const MODAL_ID = 'adminConvertModal';

  function esc(s) {
    if (global.AdminShell?.esc) return global.AdminShell.esc(s);
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ID;
    backdrop.className = 'sfd-modal-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <div class="sfd-modal" role="dialog" aria-modal="true" aria-labelledby="adminConvertTitle" style="max-width:520px">
        <div class="sfd-modal__header"><h3 id="adminConvertTitle">Convert to customer</h3></div>
        <div class="sfd-modal__body" id="adminConvertBody"></div>
        <div class="sfd-modal__footer sfd-modal__footer--split" id="adminConvertFooter"></div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  function getEls() {
    return {
      backdrop: document.getElementById(MODAL_ID),
      body: document.getElementById('adminConvertBody'),
      footer: document.getElementById('adminConvertFooter'),
      title: document.getElementById('adminConvertTitle')
    };
  }

  function close() {
    const { backdrop } = getEls();
    if (backdrop) backdrop.hidden = true;
  }

  function summaryTable(lead) {
    const email = lead.clinic_email || lead.email || '—';
    const source = lead.lead_source || lead.source || '—';
    const notes = (lead.notes || '').slice(0, 200) || '—';
    return `
      <table class="sfd-table" style="width:100%;font-size:0.9rem;margin:0 0 12px">
        <tbody>
          <tr><th style="text-align:left;width:32%">Practice</th><td>${esc(lead.clinic_name || lead.title || '—')}</td></tr>
          <tr><th style="text-align:left">Contact</th><td>${esc(email)}</td></tr>
          <tr><th style="text-align:left">Source</th><td>${esc(source)}</td></tr>
          <tr><th style="text-align:left;vertical-align:top">Notes</th><td>${esc(notes)}</td></tr>
        </tbody>
      </table>
      <p class="sfd-muted" style="margin:0;font-size:0.88rem">This provisions a tenant immediately and emails portal access. It cannot be undone automatically.</p>`;
  }

  function renderConfirm(lead, onConfirm, onCancel) {
    const { body, footer, title } = getEls();
    title.textContent = 'Convert to customer';
    body.innerHTML = summaryTable(lead);
    footer.innerHTML = `
      <button type="button" class="sfd-btn sfd-btn-ghost" data-act="cancel">Cancel</button>
      <button type="button" class="sfd-btn sfd-btn-primary" data-act="confirm">Convert</button>`;
    footer.querySelector('[data-act="cancel"]')?.addEventListener('click', onCancel);
    footer.querySelector('[data-act="confirm"]')?.addEventListener('click', onConfirm);
  }

  function renderProvisioning() {
    const { body, footer, title } = getEls();
    title.textContent = 'Provisioning tenant…';
    body.innerHTML =
      '<p style="margin:0 0 12px">Creating customer account, clinic, and invite record.</p><div class="pp-skeleton" style="height:8px;border-radius:4px"></div>';
    footer.innerHTML = '<button type="button" class="sfd-btn sfd-btn-ghost" disabled>Please wait…</button>';
  }

  function renderSuccess(result, lead) {
    const { body, footer, title } = getEls();
    title.textContent = 'Tenant created';
    const portal = result.portal_url || '';
    const customerId = result.customerId || '';
    const emailSent = result.email_sent !== false;
    body.innerHTML = `
      <div class="sfd-callout" style="margin:0 0 12px"><b>Success.</b> ${esc(lead.clinic_name || 'Office')} is ready for voice setup.</div>
      <p class="sfd-muted" style="margin:0 0 12px;font-size:0.9rem">${
        emailSent
          ? 'Portal credentials were emailed to the practice contact. Temporary passwords are never returned in the API response.'
          : 'Email was not sent — share the portal URL with the practice securely.'
      }</p>
      <label class="va-field-label">Portal URL</label>
      <div style="display:flex;gap:8px;margin:4px 0 12px">
        <input class="admin-crm-text-input" id="convertPortalUrl" readonly value="${esc(portal)}" style="flex:1" />
        <button type="button" class="sfd-btn sfd-btn-secondary" data-act="copy-url">Copy</button>
      </div>`;
    footer.innerHTML = `
      <button type="button" class="sfd-btn sfd-btn-ghost" data-act="close">Close</button>
      ${
        customerId
          ? `<a class="sfd-btn sfd-btn-primary" href="/admin/tenants.html" data-act="tenant">View tenants</a>`
          : ''
      }`;
    footer.querySelector('[data-act="close"]')?.addEventListener('click', close);
    footer.querySelector('[data-act="copy-url"]')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(portal).catch(() => {});
    });
  }

  function renderFailure(message, onRetry) {
    const { body, footer, title } = getEls();
    title.textContent = 'Conversion failed';
    body.innerHTML = `<p style="margin:0;color:var(--danger,#b91c1c)">${esc(message)}</p>`;
    footer.innerHTML = `
      <button type="button" class="sfd-btn sfd-btn-ghost" data-act="close">Close</button>
      <button type="button" class="sfd-btn sfd-btn-primary" data-act="retry">Retry</button>`;
    footer.querySelector('[data-act="close"]')?.addEventListener('click', close);
    footer.querySelector('[data-act="retry"]')?.addEventListener('click', onRetry);
  }

  function renderAlreadyConverted(customerId) {
    const { body, footer, title } = getEls();
    title.textContent = 'Already converted';
    body.innerHTML = '<p style="margin:0">This lead was already converted to a tenant.</p>';
    footer.innerHTML = `
      <button type="button" class="sfd-btn sfd-btn-ghost" data-act="close">Close</button>
      <a class="sfd-btn sfd-btn-primary" href="/admin/tenants.html">View tenants</a>`;
    footer.querySelector('[data-act="close"]')?.addEventListener('click', close);
  }

  async function runConvert(leadId, lead, { onSuccess } = {}) {
    ensureModal();
    const { backdrop } = getEls();
    backdrop.hidden = false;

    const start = () => {
      renderConfirm(lead, () => doConvert(), () => close());
    };

    const doConvert = async () => {
      renderProvisioning();
      const email = lead.clinic_email || lead.email;
      try {
        const result = await global.AdminOnboarding.convertLead(leadId, {
          email,
          send_email: true
        });
        renderSuccess(result, lead);
        if (typeof onSuccess === 'function') onSuccess(result);
      } catch (e) {
        const msg = e.message || 'Conversion failed';
        if (msg.includes('already_converted') || e.code === 'lead_already_converted') {
          renderAlreadyConverted();
          if (typeof onSuccess === 'function') onSuccess(null);
          return;
        }
        renderFailure(msg, doConvert);
      }
    };

    if (lead.pipeline_stage === 'won' || lead.status === 'converted') {
      renderAlreadyConverted();
      return;
    }
    start();
  }

  async function openFromLeadId(leadId, { onSuccess, fetchLead } = {}) {
    const fetcher =
      fetchLead ||
      ((id) =>
        global.AdminShell?.apiFetch(`/api/admin/leads/${id}`).then((r) => r.lead || r));
    const lead = await fetcher(leadId);
    return runConvert(leadId, lead, { onSuccess });
  }

  global.AdminConvertModal = {
    open: runConvert,
    openFromLeadId,
    close
  };
})(typeof window !== 'undefined' ? window : global);
