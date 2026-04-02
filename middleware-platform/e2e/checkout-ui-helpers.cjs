/**
 * Shared Playwright helpers for checkout-chat Kelly + Stripe UI tests.
 */
const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {}
process.env.DB_PATH = path.join(__dirname, '..', 'middleware-dev.db');

const { expect } = require('@playwright/test');
const db = require('../database');

function setMeta(sessionId, key, value) {
  try {
    db.db
      .prepare(`
      INSERT OR REPLACE INTO kelly_session_meta_kv (session_id, meta_key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `)
      .run(String(sessionId), String(key), String(value));
  } catch (_) {}
}

function getActiveCode(targetEmail) {
  try {
    const row = db.getActiveEmailVerificationCode
      ? db.getActiveEmailVerificationCode(String(targetEmail || '').toLowerCase())
      : null;
    return row?.code ? String(row.code) : null;
  } catch (_) {
    return null;
  }
}

async function waitCode(targetEmail, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const code = getActiveCode(targetEmail);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

function parseDoneEvent(raw) {
  const lines = String(raw || '')
    .split('\n')
    .filter((l) => l.startsWith('data: '));
  const events = lines
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  return events.reverse().find((e) => e.type === 'done') || null;
}

async function backendTurn(base, request, { session_id, provider_id, product_id, message }) {
  const res = await request.post(`${base}/api/public/checkout-chat/turn/stream`, {
    data: { session_id, provider_id, product_id, message }
  });
  const raw = await res.text();
  return parseDoneEvent(raw);
}

async function sendChatAndCaptureDone(page, message) {
  await page.fill('#composer', message);
  const responsePromise = page.waitForResponse(
    (r) => {
      if (r.request().method() !== 'POST') return false;
      const u = r.url();
      return u.includes('/checkout-chat/turn/stream') || u.includes('/checkout-chat/turn');
    },
    { timeout: 60000 }
  );
  await page.click('#btnSendChat');
  const response = await responsePromise;
  const raw = await response.text();
  if (response.url().includes('/turn/stream')) return parseDoneEvent(raw);
  try {
    const j = JSON.parse(raw);
    return j && j.success ? j : null;
  } catch (_) {
    return null;
  }
}

async function sendWithRetry(page, message, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await sendChatAndCaptureDone(page, message);
    if (last && String(last.reply || '').length > 0) return last;
  }
  return last;
}

async function openAnyVisibleChatPayControl(page) {
  const ctaBtn = page.locator('#ccPayCTAChatBubble button').first();
  const modal = page.locator('#ccPayConfirmChatBubble');
  const modalPayBtn = page.locator('#ccPayConfirmChatBubble button').filter({ hasText: 'Pay securely' }).first();
  const started = Date.now();
  const timeoutMs = 45000;
  while (Date.now() - started < timeoutMs) {
    if (await modal.isVisible().catch(() => false)) {
      await expect(modalPayBtn).toBeVisible({ timeout: 5000 });
      return;
    }
    if (await ctaBtn.isVisible().catch(() => false)) {
      await ctaBtn.click().catch(() => {});
    }
    await page.evaluate(() => {
      try {
        if (typeof window.openPayConfirmationModal === 'function') {
          window.openPayConfirmationModal();
        }
      } catch (_) {}
    }).catch(() => {});
    await page.waitForTimeout(500);
  }
  throw new Error('Could not open chat-native payment panel');
}

async function fillStripeCardFields(page) {
  const anyIframeVisible = await page
    .locator('#ccStripePaymentMount iframe')
    .first()
    .isVisible({ timeout: 30000 })
    .catch(() => false);
  if (!anyIframeVisible) {
    console.log('[stripe-test] iframe not visible in #ccStripePaymentMount');
    return false;
  }

  const frameMeta = await page
    .locator('#ccStripePaymentMount iframe')
    .evaluateAll((els) => els.map((el) => ({ title: el.getAttribute('title') || '', name: el.getAttribute('name') || '' })))
    .catch(() => []);
  console.log('[stripe-test] iframe meta', frameMeta);

  let numberFilled = false;
  let expFilled = false;
  let cvcFilled = false;

  try {
    const numberFrame = page.frameLocator('iframe[title="Secure card number input frame"], iframe[title*="card number"]');
    const number = numberFrame.locator('input[name="cardnumber"], input[name="number"], input[placeholder*="Card number"]');
    if (await number.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await number.first().fill('4111111111111111');
      numberFilled = true;
    }
  } catch (_) {}

  try {
    const expFrame = page.frameLocator('iframe[title="Secure expiration date input frame"], iframe[title*="expiration"]');
    const exp = expFrame.locator(
      'input[name="exp-date"], input[name="expiry"], input[placeholder*="MM / YY"], input[placeholder*="MM/YY"]'
    );
    if (await exp.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await exp.first().fill('11/40');
      expFilled = true;
    }
  } catch (_) {}

  try {
    const cvcFrame = page.frameLocator('iframe[title="Secure CVC input frame"], iframe[title*="CVC"]');
    const cvc = cvcFrame.locator('input[name="cvc"], input[name="cvv"], input[placeholder*="CVC"]');
    if (await cvc.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await cvc.first().fill('111');
      cvcFilled = true;
    }
  } catch (_) {}

  if (!(numberFilled && expFilled && cvcFilled)) {
    const fallbackFrame = page
      .frameLocator('#ccStripePaymentMount iframe[name*="__privateStripeFrame"], #ccStripePaymentMount iframe[title*="Secure"]')
      .first();
    try {
      const number = fallbackFrame.locator('input[name="cardnumber"], input[name="number"], input[placeholder*="Card number"]');
      if (!numberFilled && (await number.first().isVisible({ timeout: 5000 }).catch(() => false))) {
        await number.first().fill('4111111111111111');
        numberFilled = true;
      }
    } catch (_) {}
    try {
      const exp = fallbackFrame.locator('input[name="exp-date"], input[name="expiry"], input[placeholder*="MM / YY"], input[placeholder*="MM/YY"]');
      if (!expFilled && (await exp.first().isVisible({ timeout: 5000 }).catch(() => false))) {
        await exp.first().fill('11/40');
        expFilled = true;
      }
    } catch (_) {}
    try {
      const cvc = fallbackFrame.locator('input[name="cvc"], input[name="cvv"], input[placeholder*="CVC"]');
      if (!cvcFilled && (await cvc.first().isVisible({ timeout: 5000 }).catch(() => false))) {
        await cvc.first().fill('111');
        cvcFilled = true;
      }
    } catch (_) {}
    if (!(numberFilled && expFilled && cvcFilled)) {
      try {
        const anyInput = fallbackFrame.locator('input').first();
        if (await anyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await anyInput.click({ timeout: 5000 });
          await anyInput.fill('4111111111111111');
          await anyInput.press('Tab');
          await anyInput.pressSequentially('1140');
          await anyInput.press('Tab');
          await anyInput.pressSequentially('111');
          numberFilled = true;
          expFilled = true;
          cvcFilled = true;
        }
      } catch (_) {}
    }
  }

  console.log('[stripe-test] field status', { numberFilled, expFilled, cvcFilled });
  return numberFilled && expFilled && cvcFilled;
}

module.exports = {
  setMeta,
  waitCode,
  parseDoneEvent,
  backendTurn,
  sendChatAndCaptureDone,
  sendWithRetry,
  openAnyVisibleChatPayControl,
  fillStripeCardFields
};
