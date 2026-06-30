#!/usr/bin/env node
'use strict';

/**
 * Layer 4 golden journey: start → 3 turns → end → report field checks.
 */
const http = require('http');
const { containsDiagnosisLanguage } = require('../services/health-diagnosis-guard');

const BASE = process.env.HEALTH_ACCEPTANCE_BASE || 'http://localhost:4000';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.log('SKIP: GROQ_API_KEY not set');
    return;
  }

  const startRes = await request('POST', '/api/health-session/start', {
    terms_accepted: true,
    locale: 'en',
    reply_language: 'en',
    terms_version: '2026-06-25'
  });
  if (!startRes.body?.success) {
    console.error('FAIL: start', startRes);
    process.exit(1);
  }

  const sessionId = startRes.body.session.id;
  const token = startRes.body.session_token;
  const headers = { 'x-health-session-token': token };

  const turns = [
    'I have a red itchy rash on my neck for 3 days',
    'No fever, mild itch',
    'It started after I tried a new soap'
  ];

  for (const text of turns) {
    const turnRes = await request('POST', `/api/health-session/${sessionId}/turn`, { text }, headers);
    if (!turnRes.body?.success) {
      console.error('FAIL: turn', text, turnRes);
      process.exit(1);
    }
    const reply = turnRes.body.reply || '';
    if (containsDiagnosisLanguage(reply)) {
      console.error('FAIL: diagnosis language:', reply.slice(0, 200));
      process.exit(1);
    }
  }

  await request('POST', `/api/health-session/${sessionId}/end`, { session_token: token }, headers);
  const reportRes = await request('GET', `/api/health-session/${sessionId}/report`, null, headers);
  const report = reportRes.body?.report;

  if (!report) {
    console.error('FAIL: no report', reportRes);
    process.exit(1);
  }

  if (!report.chief_complaint && !report.transcript_excerpt?.match(/rash/i)) {
    console.error('FAIL: missing chief complaint / rash context');
    process.exit(1);
  }

  if (!report.opqrst || Object.keys(report.opqrst).length === 0) {
    console.warn('WARN: opqrst empty in report');
  }

  if (!report.transcript_excerpt?.match(/assistant:/i)) {
    console.error('FAIL: report transcript missing assistant side');
    process.exit(1);
  }

  console.log('PASS: golden journey report usable');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
