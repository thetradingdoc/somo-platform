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

function loopRiskScore(replies) {
  const norm = replies.map(normalize).filter(Boolean);
  let repeats = 0;
  for (let i = 1; i < norm.length; i++) {
    if (norm[i] === norm[i - 1]) repeats += 1;
  }
  return repeats;
}

function formatTranscript(turns, replies) {
  const lines = ['--- Step1 Deep Transcript ---'];
  for (let i = 0; i < turns.length; i++) {
    lines.push(`Turn ${i + 1} USER: ${String(turns[i] || '')}`);
    lines.push(`Turn ${i + 1} ASSISTANT: ${String(replies[i] || '')}`);
  }
  lines.push('--- End Transcript ---');
  return lines.join('\n');
}

test('deep step1 conversation: progression, correction, and no hard loop', async ({ request }) => {
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
    'Hi Kelly.',
    'I have an itchy rash on my forearms and neck.',
    'It started 2 days ago.',
    'Severity is 6 out of 10.',
    'Actually correction: today it feels more like 3 out of 10.',
    'No fever, no chest pain, no shortness of breath.',
    'The itch gets worse after hot showers and better with moisturizer.',
    'Can you summarize what you captured so far in one short paragraph?'
  ];

  const replies = [];
  for (const message of turns) {
    const out = await postTurn(request, { ...base, message });
    replies.push(String(out.reply || '').trim());
  }
  // eslint-disable-next-line no-console
  console.log(formatTranscript(turns, replies));

  try {
    // Ensure we did not enter repeated hard gate loop.
    const repeatScore = loopRiskScore(replies);
    expect(repeatScore).toBeLessThan(2);

    // Expect the final response to reflect at least one captured entity concept.
    const finalReply = normalize(replies[replies.length - 1] || '');
    const hasSymptomConcept = /\brash|itch|itchy|skin\b/.test(finalReply);
    const hasTimelineConcept = /\bday|today|started|since|onset\b/.test(finalReply);
    const hasSeverityConcept = /\b3\/10|3 out of 10|severity|mild|moderate\b/.test(finalReply);
    expect(hasSymptomConcept || hasTimelineConcept || hasSeverityConcept).toBeTruthy();
  } catch (err) {
    // Print full transcript to isolate the exact drift turn.
    // eslint-disable-next-line no-console
    console.error(formatTranscript(turns, replies));
    throw err;
  }
});

test('deep step1 skin-type flow: detect, confirm, correct, summary', async ({ request }) => {
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
    'Hi Kelly.',
    'My skin is oily.',
    'yes that is correct',
    'actually correction: my cheeks are dry and t-zone is oily, so combination skin',
    'Please summarize what you captured so far.'
  ];
  const replies = [];
  for (const message of turns) {
    const out = await postTurn(request, { ...base, message });
    replies.push(String(out.reply || '').trim());
  }
  // eslint-disable-next-line no-console
  console.log(formatTranscript(turns, replies));
  const full = normalize(replies.join(' '));
  expect(/\bcorrect\b|\bcombination\b|\boily\b|\bdry\b/.test(full)).toBeTruthy();
});
