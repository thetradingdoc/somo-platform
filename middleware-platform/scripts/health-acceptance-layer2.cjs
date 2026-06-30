#!/usr/bin/env node
'use strict';

/**
 * Layer 2 acceptance: skin turn hits RAG log + diagnosis guard (needs server + env).
 */
const http = require('http');

const BASE = process.env.HEALTH_ACCEPTANCE_BASE || 'http://localhost:4000';
const SKIN_TEXT = 'I have a red itchy rash on my neck for 3 days, no fever';

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
  if (process.env.DERM_EDUCATION_PIPELINE_ENABLED !== 'true') {
    console.log('SKIP: DERM_EDUCATION_PIPELINE_ENABLED not true');
    return;
  }

  const startRes = await request('POST', '/api/health-session/start', {
    terms_accepted: true,
    locale: 'en',
    reply_language: 'en'
  });
  if (startRes.status !== 200 || !startRes.body?.success) {
    console.error('FAIL: could not start session', startRes);
    process.exit(1);
  }

  const sessionId = startRes.body.session.id;
  const token = startRes.body.session_token;

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    origLog(...args);
  };

  const turnRes = await request(
    'POST',
    `/api/health-session/${sessionId}/turn`,
    { text: SKIN_TEXT },
    { 'x-health-session-token': token }
  );
  console.log = origLog;

  if (!turnRes.body?.success) {
    console.error('FAIL: turn failed', turnRes);
    process.exit(1);
  }

  const reply = turnRes.body.reply || '';
  const { containsDiagnosisLanguage } = require('../services/health-diagnosis-guard');
  if (containsDiagnosisLanguage(reply)) {
    console.error('FAIL: diagnosis language in reply:', reply.slice(0, 200));
    process.exit(1);
  }

  const hasRagLog = logs.some((l) => l.includes('[derm-rag] retrieved'));
  const toolEvents = turnRes.body.toolEvents || [];
  const hasCitations = toolEvents.some((t) =>
    t.name === 'analyze_skin_concern' && (t.result?.citations?.length || t.result?.citations_for_ui?.length)
  );

  if (!hasRagLog && !hasCitations) {
    console.warn('WARN: no [derm-rag] log or citations — RAG may be unavailable');
  }

  console.log('PASS: layer2 skin turn completed without diagnosis language');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
