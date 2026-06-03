#!/usr/bin/env node
'use strict';

/**
 * Headless patients roster diagnostic (no Playwright).
 * Usage: node scripts/debug-patients-roster.cjs
 */
const API = (process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.PW_PROVIDER_EMAIL || 'provider@callsomo.com';
const PASS = process.env.PW_PROVIDER_PASS || 'demo123';

async function main() {
  const health = await fetch(`${API}/health`);
  if (!health.ok) {
    console.error('FAIL: middleware not up at', API);
    process.exit(1);
  }

  const loginRes = await fetch(`${API}/api/customers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS, remember_me: false }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok || !loginJson.success) {
    console.error('FAIL: login', loginRes.status, loginJson);
    process.exit(1);
  }
  const cookie = loginRes.headers.get('set-cookie') || '';
  const sessionCookie = cookie.split(';')[0];
  const authHeaders = { Cookie: sessionCookie, Accept: 'application/json' };

  const htmlRes = await fetch(`${API}/business/patients.html`, { headers: { Cookie: sessionCookie } });
  const html = await htmlRes.text();
  const checks = {
    hasRosterGrid: /id="patientsRosterGrid"/.test(html),
    hasDataRosterMount: /data-roster-mount/.test(html),
    hasCustomersList: /id="customersList"/.test(html),
    hasPatientsRoster: /id="patientsRoster"/.test(html),
    buildTag: (html.match(/PATIENTS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null,
    hasDisplayCustomers: /function displayCustomers/.test(html),
    hasEnsureRosterMount: /function ensureRosterMount/.test(html),
  };
  console.log('HTML markup:', checks);

  const fhirRes = await fetch(`${API}/fhir/Patient?_count=100`, {
    headers: { ...authHeaders, Accept: 'application/fhir+json, application/json' },
  });
  const ct = fhirRes.headers.get('content-type') || '';
  const fhirText = await fhirRes.text();
  let fhirJson;
  try {
    fhirJson = JSON.parse(fhirText);
  } catch (e) {
    console.error('FAIL: FHIR not JSON', { status: fhirRes.status, ct, head: fhirText.slice(0, 200) });
    process.exit(1);
  }
  const entries = fhirJson.resourceType === 'Bundle' ? (fhirJson.entry || []).length : 0;
  console.log('FHIR:', { status: fhirRes.status, ct, entries });

  const apptRes = await fetch(`${API}/api/admin/appointments`, { headers: authHeaders });
  const apptJson = await apptRes.json();
  const appts = apptJson.success && Array.isArray(apptJson.appointments) ? apptJson.appointments.length : 0;
  console.log('Appointments:', { status: apptRes.status, appts });

  // Simulate card HTML generation for first patient
  if (entries > 0) {
    const r = fhirJson.entry[0].resource;
    const name = (r.name && r.name[0])
      ? `${(r.name[0].given || [''])[0]} ${r.name[0].family || ''}`.trim()
      : 'Unknown';
    const cardSnippet = `<div class="pp-patient-card" data-patient-id="${r.id}">`;
    console.log('Sample patient:', { id: r.id, name, cardSnippetOk: cardSnippet.length > 20 });
  }

  if (!checks.hasRosterGrid) {
    console.error('BUG: served patients.html missing #patientsRosterGrid');
    process.exit(2);
  }
  if (entries === 0) {
    console.warn('WARN: FHIR bundle empty — roster would show empty state');
  }
  console.log('OK: server data path looks healthy; if UI stuck, bug is client-side render/DOM/cache');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
