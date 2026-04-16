/* eslint-disable no-console */
'use strict';

const fs = require('fs');

const API_BASE = (process.env.PW_API_BASE_URL || process.env.PW_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

const SELECTORS = {
  assistantDialog: '.ax-shell[role="dialog"]',
  chatInput: 'input[aria-label="Message"]',
  sendButton: 'button[aria-label="Send"]',
  messageLog: '[aria-label="Chat messages"]',
  pinnedProductChip: '.axc-chip',
  resultsHeader: '.axr-header h1',
  askKellyButton: 'button:has-text("Ask Kelly")'
};

async function isMiddlewareReachable(request) {
  try {
    const r = await request.get(`${API_BASE}/health`, { timeout: 5000 });
    return r.ok();
  } catch {
    return false;
  }
}

async function openAssistantChat(page) {
  await page.goto('/#assistant/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SELECTORS.assistantDialog, { timeout: 20000 });
  await page.waitForSelector(SELECTORS.chatInput, { timeout: 20000 });
}

async function ensureChatComposer(page) {
  const input = page.locator(SELECTORS.chatInput);
  if (await input.count()) {
    const visible = await input.first().isVisible().catch(() => false);
    const enabled = await input.first().isEnabled().catch(() => false);
    if (visible && enabled) return;
  }

  const askKellyBtn = page.getByRole('button', { name: 'Ask Kelly' });
  if ((await askKellyBtn.count()) > 0) {
    const visible = await askKellyBtn.first().isVisible().catch(() => false);
    if (visible) {
      await askKellyBtn.first().click();
      await page.waitForSelector(SELECTORS.chatInput, { timeout: 20000 });
      return;
    }
  }

  await page.goto('/#assistant/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(SELECTORS.chatInput, { timeout: 20000 });
  const chatInput = page.locator(SELECTORS.chatInput).first();
  const enabled = await chatInput.isEnabled().catch(() => false);
  if (!enabled) {
    // Reset assistant shell if it is stuck in a "sending" state.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/#assistant/chat', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(SELECTORS.chatInput, { timeout: 20000 });
  }
}

async function interceptScanAPI(page) {
  const captured = {
    dataSource: null,
    productName: null,
    barcode: null,
    endpoint: null,
    status: null
  };

  page.on('response', async (res) => {
    const u = res.url();
    if (!/\/api\/public\/(beautyfacts|foodfacts)\//.test(u)) return;
    captured.endpoint = u.includes('/beautyfacts/') ? 'beautyfacts' : 'foodfacts';
    captured.status = res.status();
    try {
      const j = await res.json();
      captured.dataSource = j?.data_source || j?.dataSource || (j?.success ? 'unknown' : j?.error || 'unknown');
      captured.productName = j?.product?.product_name || null;
      captured.barcode = j?.barcode || null;
    } catch (_) {
      captured.dataSource = captured.dataSource || 'unknown';
    }
  });

  return captured;
}

async function sendChatMessage(page, text) {
  await ensureChatComposer(page);
  for (let i = 0; i < 6; i += 1) {
    const input = page.locator(SELECTORS.chatInput).first();
    await input.waitFor({ state: 'visible', timeout: 20000 });
    const enabled = await input.isEnabled().catch(() => false);
    if (!enabled) {
      await page.waitForTimeout(500);
      continue;
    }
    try {
      await input.fill(text, { timeout: 10000 });
      await input.press('Enter', { timeout: 5000 });
      return;
    } catch (_) {
      await page.waitForTimeout(300);
    }
  }
  throw new Error('Unable to send chat message: composer never became stable/enabled');
}

async function injectBarcode(page, barcode) {
  const clean = String(barcode || '').replace(/[^\d]/g, '');
  await sendChatMessage(page, `Scan barcode ${clean}`);
  return 'chat_barcode_message';
}

async function waitForAssistantReply(page, timeoutMs = 25000) {
  const log = page.locator(SELECTORS.messageLog);
  await log.waitFor({ state: 'visible', timeout: timeoutMs });
  const assistantBubbles = log.locator('.axc-bubble--assistant p');
  await assistantBubbles.last().waitFor({ state: 'visible', timeout: timeoutMs });
  return (await assistantBubbles.last().innerText()).trim();
}

async function waitForPinnedProduct(page, timeoutMs = 25000) {
  const chip = page.locator(SELECTORS.pinnedProductChip);
  try {
    await chip.waitFor({ state: 'visible', timeout: timeoutMs });
    const text = (await chip.first().innerText()).trim();
    if (text) return text;
  } catch (_) {
    // Fallback: some catalog responses update context without always rendering the pinned chip.
  }

  const assistantBubble = page.locator(`${SELECTORS.messageLog} .axc-bubble--assistant p`).last();
  await assistantBubble.waitFor({ state: 'visible', timeout: timeoutMs });
  const fallback = String((await assistantBubble.innerText()) || '').trim();
  if (fallback.length >= 6) return fallback;
  throw new Error('No pinned product chip or assistant scan context was rendered');
}

function logResult(title, obj) {
  console.log(`\n[${title}]`);
  console.log(JSON.stringify(obj, null, 2));
}

function chromiumExecutableAvailable() {
  try {
    const { chromium } = require('@playwright/test');
    const exe = chromium.executablePath();
    return !!exe && fs.existsSync(exe);
  } catch (_) {
    return false;
  }
}

let chromiumLaunchableCache = null;
async function chromiumLaunchable() {
  if (chromiumLaunchableCache != null) return chromiumLaunchableCache;
  try {
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    chromiumLaunchableCache = true;
    return true;
  } catch (_) {
    chromiumLaunchableCache = false;
    return false;
  }
}

module.exports = {
  API_BASE,
  SELECTORS,
  isMiddlewareReachable,
  chromiumExecutableAvailable,
  chromiumLaunchable,
  openAssistantChat,
  ensureChatComposer,
  interceptScanAPI,
  sendChatMessage,
  injectBarcode,
  waitForAssistantReply,
  waitForPinnedProduct,
  logResult
};

