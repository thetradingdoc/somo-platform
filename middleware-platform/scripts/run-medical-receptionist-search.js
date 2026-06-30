#!/usr/bin/env node
/**
 * Daily Medical Receptionist Lead Fetcher — triggers unified scrape/run SSE endpoint.
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const fetchFn = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const ADMIN_SECRET = process.env.ADMIN_PORTAL_SECRET;
const BASE_URL = (
  process.env.ADMIN_PORTAL_BASE_URL ||
  process.env.API_BASE_URL ||
  process.env.DOC_LITTLE_BASE_URL ||
  'http://localhost:4000'
).replace(/\/$/, '');

const LOG_PREFIX = '[medical-receptionist-daily]';

async function login() {
  const { headers } = await fetchFn(`${BASE_URL}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: ADMIN_SECRET }),
  }).then(async (res) => {
    const text = await res.text();
    if (!res.ok) throw new Error(`Login failed: ${text}`);
    return { headers: res.headers, json: text ? JSON.parse(text) : {} };
  });

  const setCookie = headers.get('set-cookie');
  if (!setCookie) throw new Error('No session cookie');
  return setCookie.split(',')[0].split(';')[0];
}

async function runScrape(cookie) {
  const res = await fetchFn(`${BASE_URL}/api/admin/scrape/run`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === 'done') result = evt.result;
      } catch {
        /* skip */
      }
    }
  }
  return result;
}

async function run() {
  if (!ADMIN_SECRET) {
    console.error(`${LOG_PREFIX} ADMIN_PORTAL_SECRET required`);
    process.exitCode = 1;
    return;
  }
  try {
    const cookie = await login();
    const result = await runScrape(cookie);
    console.log(`${LOG_PREFIX} scrape complete`, result);
  } catch (e) {
    console.error(`${LOG_PREFIX} ERROR:`, e.message);
    process.exitCode = 1;
  }
}

run();
