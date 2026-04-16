'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  API_BASE,
  isMiddlewareReachable,
  openAssistantChat,
  interceptScanAPI,
  injectBarcode,
  sendChatMessage,
  waitForAssistantReply,
  waitForPinnedProduct
} = require('./helpers/scan');

const BARCODE = '8809652637891';

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}

async function snapshotState(page) {
  return page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input, textarea')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label') || null,
      placeholder: el.getAttribute('placeholder') || null,
      disabled: !!el.disabled,
      visible: !!(el.offsetParent && el.getBoundingClientRect().height > 0),
      className: String(el.className || '').slice(0, 120)
    }));
    const buttons = [...document.querySelectorAll('button')].map((el) => ({
      text: String(el.textContent || '').trim().slice(0, 80),
      ariaLabel: el.getAttribute('aria-label') || null,
      disabled: !!el.disabled,
      visible: !!(el.offsetParent && el.getBoundingClientRect().height > 0),
      className: String(el.className || '').slice(0, 120)
    })).filter((b) => b.visible);
    const title =
      document.querySelector('.ax-shell[role="dialog"]')?.getAttribute('aria-label') ||
      document.title ||
      null;
    const messages = [...document.querySelectorAll('[aria-label="Chat messages"] .axc-bubble p')]
      .map((n) => String(n.textContent || '').trim())
      .filter(Boolean)
      .slice(-6);
    return {
      url: window.location.href,
      title,
      hasResultsDialog: !!document.querySelector('[aria-label*="results" i]'),
      hasChatDialog: !!document.querySelector('[aria-label*="assistant — chat" i]'),
      hasAskKellyButton: !!document.querySelector('button'),
      inputs,
      buttons,
      lastMessages: messages
    };
  });
}

test.describe('Scan diagnostic flow', () => {
  test('capture scan->chat transition evidence', async ({ page, request }, testInfo) => {
    test.skip(!(await isMiddlewareReachable(request)), `middleware not up at ${API_BASE}`);

    const outDir = path.join(process.cwd(), 'screenshots');
    ensureDir(outDir);

    const capturedScan = await interceptScanAPI(page);
    const netLog = [];
    page.on('response', async (res) => {
      const u = res.url();
      if (!u.includes('/api/')) return;
      netLog.push({ status: res.status(), url: u, ts: Date.now() });
    });

    await openAssistantChat(page);
    await page.screenshot({ path: path.join(outDir, '00-01-chat-open.png'), fullPage: true });
    const s1 = await snapshotState(page);

    await injectBarcode(page, BARCODE);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, '00-02-after-inject.png'), fullPage: true });
    const s2 = await snapshotState(page);

    let scanContextAck = null;
    let scanContextErr = null;
    try {
      scanContextAck = await waitForPinnedProduct(page, 25000);
    } catch (e) {
      scanContextErr = e.message;
    }
    await page.screenshot({ path: path.join(outDir, '00-03-after-context-wait.png'), fullPage: true });
    const s3 = await snapshotState(page);

    let q1Reply = null;
    let q1Err = null;
    try {
      await sendChatMessage(page, 'Is this product good for oily combination skin?');
      q1Reply = await waitForAssistantReply(page, 30000);
    } catch (e) {
      q1Err = e.message;
    }
    await page.screenshot({ path: path.join(outDir, '00-04-after-q1.png'), fullPage: true });
    const s4 = await snapshotState(page);

    const report = {
      barcode: BARCODE,
      capturedScan,
      scanContextAck,
      scanContextErr,
      q1Reply,
      q1Err,
      states: { s1, s2, s3, s4 },
      netLog
    };

    const reportPath = path.join(outDir, '00-state-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    await testInfo.attach('00-state-report.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json'
    });

    expect(true).toBe(true);
  });
});

