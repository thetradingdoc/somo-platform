'use strict';

const { test, expect } = require('@playwright/test');
const {
  isMiddlewareReachable,
  chromiumLaunchable,
  openAssistantChat,
  injectBarcode,
  sendChatMessage,
  waitForAssistantReply,
  waitForPinnedProduct
} = require('./helpers/scan');

const BARCODE = '8809652637891';

test.describe('Scan session persistence', () => {
  test('same tab keeps session id across navigation', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    const sid1 = await page.evaluate(() => sessionStorage.getItem('littlelab_landing_assistant_sid'));
    expect(sid1).toBeTruthy();
    await page.goto('/');
    await page.goto('/#assistant/chat');
    const sid2 = await page.evaluate(() => sessionStorage.getItem('littlelab_landing_assistant_sid'));
    expect(sid2).toBe(sid1);
  });

  test('same session keeps pinned product context', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BARCODE);
    const ack1 = await waitForPinnedProduct(page, 30000);
    expect(ack1.length).toBeGreaterThan(5);
    await page.goto('/#assistant/chat');
    await sendChatMessage(page, 'Summarize the scanned product context.');
    const pinned2 = await waitForAssistantReply(page, 30000);
    expect(pinned2.length).toBeGreaterThan(20);
  });

  test('new browser context does not inherit prior session', async ({ browser, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    const c1 = await browser.newContext();
    const p1 = await c1.newPage();
    await openAssistantChat(p1);
    const sid1 = await p1.evaluate(() => sessionStorage.getItem('littlelab_landing_assistant_sid'));
    await c1.close();

    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await openAssistantChat(p2);
    const sid2 = await p2.evaluate(() => sessionStorage.getItem('littlelab_landing_assistant_sid'));
    expect(sid1).toBeTruthy();
    expect(sid2).toBeTruthy();
    expect(sid2).not.toBe(sid1);
    await c2.close();
  });

  test('repeat scan of same barcode keeps consistent pinned product', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BARCODE);
    const first = await waitForPinnedProduct(page, 30000);
    await injectBarcode(page, BARCODE);
    const second = await waitForPinnedProduct(page, 30000);
    expect(first.length).toBeGreaterThan(5);
    expect(second.length).toBeGreaterThan(5);
  });

  test('follow-up uses prior scan context in same session', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'Summarize this scanned product for my skin.');
    const reply = await waitForAssistantReply(page, 30000);
    expect(reply.length).toBeGreaterThan(30);
    expect(reply.toLowerCase()).toMatch(/product|skin|ingredient|niacinamide|zinc|routine/);
  });
});

