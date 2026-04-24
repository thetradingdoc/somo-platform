#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE_URL = (process.env.PATIENT_WEB_BASE || 'http://127.0.0.1:4000/unified-dashboard/patients').replace(/\/$/, '');
const SESSION_ID = String(process.env.PATIENT_SESSION_ID || '').trim();

if (!SESSION_ID) {
  console.error('PATIENT_SESSION_ID is required');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript((sid) => {
  localStorage.setItem('patient_session_id', sid);
}, SESSION_ID);
const page = await context.newPage();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  await page.goto(`${BASE_URL}/appointments.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert((await page.getByText('Pay now').count()) === 0, 'Pay now should be hidden');
  assert((await page.getByText('Billing is paused during monitoring month.').count()) > 0, 'Billing paused banner should be visible');

  await page.goto(`${BASE_URL}/book.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert((await page.getByText('Book with guided chat').count()) === 0, 'Guided chat CTA should be hidden');

  await page.goto(`${BASE_URL}/patient-dashboard.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert((await page.getByText('Wallet').count()) === 0, 'Wallet nav should be hidden');

  await page.goto(`${BASE_URL}/triage.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert(page.url().includes('book.html'), 'Triage should redirect when chat disabled');

  console.log('month1-safe-launch-playwright: PASS');
} catch (err) {
  console.error('month1-safe-launch-playwright: FAIL', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
