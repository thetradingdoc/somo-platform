const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');

const BASE_URL = (process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const CLINIC_ID = String(process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || '').trim();

async function postTurn(request, body) {
  const resp = await request.post(`${BASE_URL}/api/public/landing-assistant/turn`, { data: body });
  const json = await resp.json().catch(() => ({}));
  expect(resp.ok(), `turn failed: ${JSON.stringify(json)}`).toBeTruthy();
  return json;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function runTurns(request, turns, sid = randomUUID()) {
  const base = {
    clinic_id: CLINIC_ID,
    session_id: sid,
    preferred_language: 'en',
    kelly_flow: 'skincare',
    channel: 'chat'
  };
  const replies = [];
  for (const message of turns) {
    const out = await postTurn(request, { ...base, message });
    replies.push(String(out.reply || '').trim());
  }
  return { sid, replies };
}

function printTranscript(turns, replies, title) {
  // eslint-disable-next-line no-console
  console.log(`--- ${title} ---`);
  for (let i = 0; i < turns.length; i++) {
    // eslint-disable-next-line no-console
    console.log(`Turn ${i + 1} USER: ${String(turns[i] || '')}`);
    // eslint-disable-next-line no-console
    console.log(`Turn ${i + 1} ASSISTANT: ${String(replies[i] || '')}`);
  }
  // eslint-disable-next-line no-console
  console.log('--- End ---');
}

test.describe('skin taxonomy chat scenarios', () => {
  test.beforeEach(() => {
    test.skip(!CLINIC_ID, 'Set DEFAULT_CLINIC_ID (or SMOKE_CLINIC_ID) to run this test.');
  });

  test('core scenario: initial discovery -> confirm -> correction', async ({ request }) => {
    const turns = [
      'My skin gets really shiny by noon.',
      "Yes, that's right.",
      "Actually, I'm not oily, my cheeks just feel tight.",
      'Please summarize what you captured so far in one short paragraph.'
    ];
    const { replies } = await runTurns(request, turns);
    printTranscript(turns, replies, 'Core Skin-Type Scenario');

    const r1 = normalize(replies[0]);
    const r2 = normalize(replies[1]);
    const r3 = normalize(replies[2]);
    const r4 = normalize(replies[3]);

    // Turn 1 should behave as tentative discovery: ask follow-up, not final diagnosis.
    expect(/\?|when|how long|what/.test(r1)).toBeTruthy();

    // Turn 2 confirmation should be accepted without emergency drift.
    expect(/911|emergency|heart attack/.test(r2)).toBeFalsy();

    // Turn 3 correction should acknowledge update away from "pure oily".
    expect(/\b(dry|combination|t-zone|cheeks|clarify)\b/.test(r3)).toBeTruthy();

    // Turn 4 summary should include one of the corrected skin concepts.
    expect(/\b(dry|combination|oily|cheeks|t-zone)\b/.test(r4)).toBeTruthy();
  });

  test('edge case: negation should not misclassify', async ({ request }) => {
    const turns = [
      "I don't have dry skin.",
      'Please summarize what you captured so far in one short paragraph.'
    ];
    const { replies } = await runTurns(request, turns);
    printTranscript(turns, replies, 'Negation Edge Case');

    const combined = normalize(replies.join(' '));
    expect(/\boily|combination|normal|what would you say your skin type is|which\b/.test(combined)).toBeTruthy();
    // Do not force hard dry classification from negated phrase.
    expect(/\byou reported dry skin\b/.test(combined)).toBeFalsy();
  });

  test('edge case: tie-break combination vs clarifier', async ({ request }) => {
    const turns = [
      'I have an oily nose but dry cheeks.',
      'Please summarize what you captured so far in one short paragraph.'
    ];
    const { replies } = await runTurns(request, turns);
    printTranscript(turns, replies, 'Tie-Break Edge Case');

    const combined = normalize(replies.join(' '));
    // Accept either deterministic combination or explicit clarifier ask.
    const hasCombination = /\bcombination|t-zone|oily.*dry|dry.*oily\b/.test(combined);
    const hasClarifier = /\bclarify|which|question|describe|concern\b/.test(combined);
    expect(hasCombination || hasClarifier).toBeTruthy();
  });

  test('edge case: oily + tight should preserve type with dehydrated condition behavior', async ({ request }) => {
    const turns = [
      'I am oily but my skin feels tight after washing.',
      'What did you capture so far?'
    ];
    const { replies } = await runTurns(request, turns);
    printTranscript(turns, replies, 'Oily + Tight Coexistence');

    const combined = normalize(replies.join(' '));
    // We cannot read internal arrays from chat API directly, so assert behavioral proxy:
    // response should mention both oily/tight framing or ask hydration/irritation clarification.
    expect(/\boily|tight|dry|hydrat|irritat|barrier|clarify\b/.test(combined)).toBeTruthy();
  });
});
