/**
 * Redirect legacy business/*.html routes to canonical Somo provider shell pages.
 */
(function () {
  const file = (window.location.pathname.split('/').pop() || '').split('?')[0];
  const params = new URLSearchParams(window.location.search);
  const section = params.get('section');
  const base = window.location.pathname.replace(/[^/]+$/, '');

  const REVENUE_SECTION_MAP = {
    overview: 'pipeline',
    claims: 'claims',
    remittance: 'claims',
    scan: 'claims',
    'prior-auth': 'work',
    invoices: 'payments',
  };

  if (file === 'billing.html' && section && params.get('legacy_tabs') !== '1') {
    const tab = REVENUE_SECTION_MAP[section] || 'pipeline';
    let target = `revenue.html?tab=${tab}`;
    if (section === 'remittance') target += '#remittance';
    if (section === 'scan') target += '&panel=create';
    window.location.replace(base + target);
    return;
  }

  const TARGETS = {
    'business-dashboard.html': 'today.html',
    'medical-billing.html': 'revenue.html?tab=claims',
    'commerce-billing.html': 'revenue.html?tab=payments',
    'products.html': 'today.html',
    'orders.html': 'today.html',
    'merchant-orders.html': 'today.html',
    'records.html': 'patients.html',
    'invoices.html': 'revenue.html?tab=payments',
    'treatments.html': 'today.html',
    'wallets.html': 'settings.html',
    'rcm.html': 'revenue.html?tab=pipeline',
    'patient-payments.html': 'revenue.html?tab=payments',
    'claims.html': 'revenue.html?tab=work',
  };
  const target = TARGETS[file];
  if (target) {
    window.location.replace(base + target);
  }
})();
