#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * Production routing/API readiness smoke check.
 *
 * Verifies:
 * 1) UI domain does NOT serve HTML for /api endpoints
 * 2) API base returns JSON health
 * 3) landing-assistant turn endpoint returns JSON (not SPA HTML)
 */

const UI_BASE = String(process.env.UI_BASE_URL || 'https://callsomo.com').replace(/\/$/, '');
const API_BASE = String(process.env.MIDDLEWARE_API_BASE || 'https://api.callsomo.com').replace(/\/$/, '');
const ROUTING_MODE = String(process.env.PROD_ROUTING_MODE || 'split-domain').toLowerCase();
const REQUIRE_UI_DOMAIN_PROXY = ROUTING_MODE === 'same-domain';

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  return { status: res.status, contentType: String(res.headers.get('content-type') || ''), text };
}

function looksLikeHtml(body = '', contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const t = String(body || '').trim().toLowerCase();
  return t.startsWith('<!doctype html') || t.startsWith('<html');
}

function looksLikeJson(body = '', contentType = '') {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/json')) return true;
  const t = String(body || '').trim();
  if (!t) return false;
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function printCheck(ok, id, detail) {
  const icon = ok ? 'PASS' : 'FAIL';
  console.log(`${icon} ${id}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const checks = [];

  // UI baseline
  try {
    const ui = await fetchText(`${UI_BASE}`);
    const ok = ui.status >= 200 && ui.status < 400;
    checks.push(ok);
    printCheck(ok, 'UI_UP', `status=${ui.status}`);
  } catch (e) {
    checks.push(false);
    printCheck(false, 'UI_UP', String(e?.message || e));
  }

  // Same-domain proxy checks are optional in split-domain mode.
  if (REQUIRE_UI_DOMAIN_PROXY) {
    try {
      const sameApi = await fetchText(`${UI_BASE}/api/health`);
      const ok = sameApi.status >= 200 && sameApi.status < 300 && !looksLikeHtml(sameApi.text, sameApi.contentType) && looksLikeJson(sameApi.text, sameApi.contentType);
      checks.push(ok);
      printCheck(ok, 'UI_DOMAIN_API_HEALTH_JSON', `status=${sameApi.status} content-type=${sameApi.contentType || '(none)'}`);
    } catch (e) {
      checks.push(false);
      printCheck(false, 'UI_DOMAIN_API_HEALTH_JSON', String(e?.message || e));
    }
  } else {
    printCheck(true, 'UI_DOMAIN_API_HEALTH_JSON', 'skipped in split-domain mode');
  }

  // API base health
  try {
    const api = await fetchText(`${API_BASE}/health`);
    const ok = api.status >= 200 && api.status < 300 && !looksLikeHtml(api.text, api.contentType) && looksLikeJson(api.text, api.contentType);
    checks.push(ok);
    printCheck(ok, 'API_BASE_HEALTH_JSON', `status=${api.status} content-type=${api.contentType || '(none)'}`);
  } catch (e) {
    checks.push(false);
    printCheck(false, 'API_BASE_HEALTH_JSON', String(e?.message || e));
  }

  // API turn endpoint on API base (optional — Somo landing is marketing-only)
  if (process.env.SKIP_LANDING_TURN_SMOKE === '1') {
    printCheck(true, 'API_BASE_LANDING_TURN_JSON', 'skipped (SKIP_LANDING_TURN_SMOKE=1)');
  } else {
    try {
      const turn = await fetchText(`${API_BASE}/api/public/landing-assistant/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: `prod_smoke_${Date.now()}`, message: 'hello' })
      });
      const ok = turn.status >= 200 && turn.status < 300 && !looksLikeHtml(turn.text, turn.contentType) && looksLikeJson(turn.text, turn.contentType);
      checks.push(ok);
      printCheck(ok, 'API_BASE_LANDING_TURN_JSON', `status=${turn.status} content-type=${turn.contentType || '(none)'}`);
    } catch (e) {
      checks.push(false);
      printCheck(false, 'API_BASE_LANDING_TURN_JSON', String(e?.message || e));
    }
  }

  // Same-domain turn endpoint (requires edge proxy in front of static hosting)
  if (REQUIRE_UI_DOMAIN_PROXY) {
    try {
      const turn = await fetchText(`${UI_BASE}/api/public/landing-assistant/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: `prod_smoke_${Date.now()}`, message: 'hello' })
      });
      const ok = turn.status >= 200 && turn.status < 300 && !looksLikeHtml(turn.text, turn.contentType) && looksLikeJson(turn.text, turn.contentType);
      checks.push(ok);
      printCheck(ok, 'UI_DOMAIN_LANDING_TURN_JSON', `status=${turn.status} content-type=${turn.contentType || '(none)'}`);
    } catch (e) {
      checks.push(false);
      printCheck(false, 'UI_DOMAIN_LANDING_TURN_JSON', String(e?.message || e));
    }
  } else {
    printCheck(true, 'UI_DOMAIN_LANDING_TURN_JSON', 'skipped in split-domain mode');
  }

  const allOk = checks.every(Boolean);
  console.log(`\nSUMMARY: ${allOk ? 'PASS' : 'FAIL'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL PROD_ROUTING_SMOKE', e?.message || e);
  process.exit(1);
});

