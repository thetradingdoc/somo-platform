#!/usr/bin/env node
'use strict';

const API_BASE = String(process.env.API_BASE || process.env.PW_API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const SESSION_ID = String(process.env.PATIENT_SESSION_ID || '').trim();
const DAILY_ENTRY_ID = String(process.env.DAILY_ENTRY_ID || '').trim();

if (!SESSION_ID) {
  console.error('PATIENT_SESSION_ID is required');
  process.exit(2);
}

async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-session-id': SESSION_ID,
      ...(opts.headers || {})
    }
  });
  let json = {};
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  const walletDeposit = await request('/api/patient/wallet/deposit', { method: 'POST', body: JSON.stringify({ amount: 10, method: 'test' }) });
  assert(walletDeposit.status === 503, 'wallet/deposit should return 503 when disabled');

  const walletTx = await request('/api/patient/wallet/transactions', { method: 'GET' });
  assert(walletTx.status === 503, 'wallet/transactions should return 503 when disabled');

  const walletPayClaim = await request('/api/patient/wallet/pay-claim', { method: 'POST', body: JSON.stringify({ claimId: 'demo-claim' }) });
  assert(walletPayClaim.status === 503, 'wallet/pay-claim should return 503 when disabled');

  const triageMessage = await request('/api/patient/triage/message', { method: 'POST', body: JSON.stringify({ message: 'hello' }) });
  assert(triageMessage.status === 503, 'triage/message should return 503 when disabled');

  const triageHistory = await request('/api/patient/triage/history?session_id=test', { method: 'GET' });
  assert(triageHistory.status === 503, 'triage/history should return 503 when disabled');

  if (DAILY_ENTRY_ID) {
    const mediaLink = await request(`/api/patient/routine/daily/${encodeURIComponent(DAILY_ENTRY_ID)}/media-link`, {
      method: 'POST',
      body: JSON.stringify({ media_url: 'https://example.com/file.jpg' })
    });
    assert(mediaLink.status !== 500, 'media-link should not fail with server error');
  }

  console.log('month1-safe-launch-api: PASS');
})().catch((err) => {
  console.error('month1-safe-launch-api: FAIL', err.message);
  process.exit(1);
});
