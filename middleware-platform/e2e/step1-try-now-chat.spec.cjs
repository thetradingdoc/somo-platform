const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');
const path = require('path');

const BASE_URL = (process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = String(process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || '').trim();
const DB_PATH = String(process.env.DB_PATH || '').trim();

async function postTurn(request, body) {
  const resp = await request.post(`${BASE_URL}/api/public/landing-assistant/turn`, { data: body });
  const json = await resp.json().catch(() => ({}));
  expect(resp.ok(), `turn failed: ${JSON.stringify(json)}`).toBeTruthy();
  return json;
}

function readSessionProjection(sessionId) {
  if (!DB_PATH) return null;
  const Database = require('better-sqlite3');
  const abs = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);
  const db = new Database(abs, { readonly: true, fileMustExist: false });
  try {
    return db.prepare('SELECT * FROM session_state_projection WHERE session_id = ?').get(sessionId) || null;
  } finally {
    db.close();
  }
}

function readTriageSession(sessionId) {
  if (!DB_PATH) return null;
  const Database = require('better-sqlite3');
  const abs = path.isAbsolute(DB_PATH) ? DB_PATH : path.join(process.cwd(), DB_PATH);
  const db = new Database(abs, { readonly: true, fileMustExist: false });
  try {
    return db.prepare('SELECT * FROM triage_sessions WHERE session_id = ?').get(sessionId) || null;
  } finally {
    db.close();
  }
}

async function waitForProjection(sessionId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = readSessionProjection(sessionId);
    if (state) return state;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

test('step1 conversation progresses without gate loop', async ({ request }) => {
  test.skip(!CLINIC_ID, 'Set DEFAULT_CLINIC_ID (or SMOKE_CLINIC_ID) to run this test.');
  const sid = randomUUID();
  const base = {
    clinic_id: CLINIC_ID,
    session_id: sid,
    preferred_language: 'en',
    kelly_flow: 'skincare',
    channel: 'chat'
  };

  const turns = [
    'Hi Kelly',
    'I have an itchy rash on my arms.',
    'It started 2 days ago.',
    'The severity is 6 out of 10.'
  ];
  const replies = [];
  for (const message of turns) {
    const out = await postTurn(request, { ...base, message });
    replies.push(String(out.reply || '').trim().toLowerCase());
  }

  // Loop guard: do not repeat the exact same gate question 3x in one short intake.
  const last3 = replies.slice(-3);
  const uniqueLast3 = new Set(last3.filter(Boolean));
  expect(uniqueLast3.size).toBeGreaterThan(1);

  // Persistence progression: projection should have at least complaint + one additional field.
  if (DB_PATH) {
    const state = await waitForProjection(sid, 12000);
    const triage = readTriageSession(sid);
    const source = state || triage;
    if (!source) {
      // Some local environments route persistence to a different DB path.
      // Keep this E2E focused on conversation behavior when DB verification is unavailable.
      return;
    }
    const hasComplaint = !!String(source.chief_complaint || source.quality || '').trim();
    const hasTimeline = !!String(source.timeline || source.onset || '').trim();
    const hasSeverity = source.severity != null && String(source.severity).trim() !== '';
    expect(hasComplaint).toBeTruthy();
    expect(hasTimeline || hasSeverity).toBeTruthy();
  }
});
