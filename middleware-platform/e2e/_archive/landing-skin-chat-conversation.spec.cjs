'use strict';

/**
 * Multi-turn skin conversation against POST /api/public/landing-assistant/turn
 *
 * - Each user turn is a test.step (visible in Playwright HTML report timeline).
 * - Full transcript attached as Markdown + JSON (Attachments tab in HTML report).
 *
 * Run: npm run test:e2e-landing
 * View: npx playwright show-report playwright-report
 */

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  ''
);
const CLINIC_ID = String(
  process.env.DEFAULT_CLINIC_ID || process.env.SMOKE_CLINIC_ID || 'clinic-default'
).trim();

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

async function postTurn(request, sessionId, message) {
  // Do not send turn_seq: the landing seq gate treats <= latest as skipped after persistence,
  // which breaks multi-turn API tests unless the client mirrors server ack ordering.
  const res = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
    data: {
      message,
      session_id: sessionId,
      clinic_id: CLINIC_ID,
      kelly_flow: 'skincare',
    },
    headers: { 'Content-Type': 'application/json' },
    timeout: 90_000,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 500) };
  }
  return { res, json, text };
}

function formatTranscriptMd(transcript, sessionId) {
  const lines = [`# Skin chat transcript`, ``, `**Session:** \`${sessionId}\``, `**API:** ${API_BASE}`, ``];
  let n = 0;
  for (const row of transcript) {
    n += 1;
    const role = row.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## Turn ${n} — ${role}`, '', row.text || '_(empty)_', '');
  }
  return lines.join('\n');
}

function assessConversation(transcript) {
  const assistant = transcript.filter((r) => r.role === 'assistant').map((r) => String(r.text || '').trim());
  const users = transcript.filter((r) => r.role === 'user').map((r) => String(r.text || '').trim());
  const combined = assistant.join('\n').toLowerCase();
  const issues = [];
  const warnings = [];

  if (assistant.length < 4) issues.push(`Expected at least 4 assistant turns, got ${assistant.length}`);
  assistant.forEach((t, i) => {
    if (t.length < 12) issues.push(`Assistant turn ${i + 1} empty or trivial (${t.length} chars)`);
  });

  // Kelly often opens with short triage questions; broaden signal beyond clinical jargon.
  const skinLex =
    /skin|face|cheek|forehead|pore|acne|comedone|clog|routine|moistur|barrier|gentle|irritat|spf|sunscreen|acid|bha|salicylic|retin|niacin|product|care|try|avoid|patch|derm|doctor|when|how|what|oil|dry|combination|sensitive|night|morning|personalize|help|question|tell|describe|oily/gi;
  const hits = (combined.match(skinLex) || []).length;
  if (hits < 3) issues.push(`Assistant replies should mention skin or triage context; token hit count=${hits}`);

  for (let i = 1; i < assistant.length; i++) {
    const a = assistant[i].replace(/\s+/g, ' ');
    const b = assistant[i - 1].replace(/\s+/g, ' ');
    if (a.length > 40 && a === b) issues.push(`Assistant turns ${i} and ${i + 1} are identical (possible loop)`);
  }

  const userMentionsRoutine =
    users.join(' ').toLowerCase().includes('salicylic') && users.join(' ').toLowerCase().includes('niacinamide');
  if (userMentionsRoutine && !/salicylic|bha|niacinamide|acid|layer|alternate|spacing|irritat|combine|together|morning|night/i.test(combined)) {
    warnings.push(
      'User asked about BHA + niacinamide; assistant did not clearly reference actives/stacking (may still be in triage).'
    );
  }

  return { issues, warnings, assistantTurns: assistant.length, skinLexHits: hits, userTurns: users.length };
}

test.describe('Skin chat — full multi-turn conversation', () => {
  test.setTimeout(180_000);

  test('Kelly responds across a realistic skin thread (transcript in report)', async ({ request }, testInfo) => {
    test.skip(!(await isMiddlewareReachable(request)), `Middleware not up at ${API_BASE} — start with: cd middleware-platform && DEFAULT_CLINIC_ID=… npm start`);

    const sessionId = randomUUID();
    const userMessages = [
      'Hi — I need help figuring out a routine for my skin.',
      'I have combination skin and lots of small bumps on my forehead that do not go away easily.',
      'I already use a salicylic acid cleanser once a day in the evening.',
      'Would adding niacinamide in the morning be a good idea, or could that irritate together with the BHA?',
      'I wear SPF 50 every morning already.',
      'What would you suggest I change first?',
    ];

    const transcript = [];
    let turnIdx = 0;

    for (const message of userMessages) {
      turnIdx += 1;
      await test.step(`User turn ${turnIdx}: ${message.slice(0, 72)}${message.length > 72 ? '…' : ''}`, async () => {
        const { res, json } = await postTurn(request, sessionId, message);
        expect(res.ok(), `HTTP ${res.status()}: ${JSON.stringify(json).slice(0, 400)}`).toBeTruthy();
        expect(json.success, JSON.stringify(json)).toBe(true);
        expect(json.session_id).toBe(sessionId);
        expect(json.skipped, 'turn must not be dropped as stale/duplicate').not.toBe(true);

        const reply = String(json.reply || '').trim();
        expect(reply.length, 'assistant reply must not be empty').toBeGreaterThan(15);

        transcript.push({ role: 'user', text: message });
        transcript.push({ role: 'assistant', text: reply, toolsUsed: json.toolsUsed || [], next_step: json.next_step });

        await test.info().attach(`turn-${turnIdx}-response.json`, {
          body: JSON.stringify(
            {
              reply: reply.slice(0, 4000),
              toolsUsed: json.toolsUsed,
              next_step: json.next_step,
              next_chips: json.next_chips,
              session_result_snapshot: json.session_result_snapshot ? { schema: json.session_result_snapshot.schema_version } : null,
            },
            null,
            2
          ),
          contentType: 'application/json',
        });
      });
    }

    const md = formatTranscriptMd(transcript, sessionId);
    await testInfo.attach('full-conversation.md', {
      body: Buffer.from(md, 'utf8'),
      contentType: 'text/markdown',
    });
    await testInfo.attach('full-conversation.json', {
      body: JSON.stringify(transcript, null, 2),
      contentType: 'application/json',
    });

    const assessment = assessConversation(transcript);
    await testInfo.attach('conversation-assessment.json', {
      body: JSON.stringify(assessment, null, 2),
      contentType: 'application/json',
    });

    if (assessment.warnings?.length) {
      await testInfo.attach('conversation-warnings.txt', {
        body: assessment.warnings.join('\n'),
        contentType: 'text/plain',
      });
    }
    if (assessment.issues.length) {
      await testInfo.attach('assessment-issues.txt', {
        body: assessment.issues.join('\n'),
        contentType: 'text/plain',
      });
    }
    expect(assessment.issues, `Conversation quality issues:\n${assessment.issues.join('\n')}`).toEqual([]);

    const last = transcript.filter((t) => t.role === 'assistant').pop();
    expect(String(last?.text || '').length).toBeGreaterThan(20);
    const avgAssistantLen =
      transcript.filter((t) => t.role === 'assistant').reduce((a, t) => a + String(t.text || '').length, 0) /
      Math.max(1, transcript.filter((t) => t.role === 'assistant').length);
    expect(avgAssistantLen).toBeGreaterThan(35);
  });
});
