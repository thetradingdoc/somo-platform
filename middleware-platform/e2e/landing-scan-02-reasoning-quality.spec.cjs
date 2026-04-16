'use strict';

const { test, expect } = require('@playwright/test');
const {
  isMiddlewareReachable,
  chromiumLaunchable,
  openAssistantChat,
  injectBarcode,
  sendChatMessage,
  waitForAssistantReply,
  waitForPinnedProduct,
  logResult
} = require('./helpers/scan');

const BASE_BARCODE = '8809652637891';

test.describe('Scan reasoning quality', () => {
  test('barcode pinning works before reasoning', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    const contextAck = await waitForPinnedProduct(page, 30000);
    expect(contextAck.length).toBeGreaterThan(5);
  });

  test('Q1: skin fit answer is substantive', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'Is this good for oily and combination skin?');
    const reply = await waitForAssistantReply(page, 30000);
    logResult('Reasoning Q1', { reply });
    expect(reply.length).toBeGreaterThan(40);
    expect(reply.toLowerCase()).toMatch(/skin|oily|combination|ingredient|niacinamide|zinc|routine/);
  });

  test('Q2: alternatives answer suggests options', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'What can I use instead if this irritates me?');
    const reply = await waitForAssistantReply(page, 30000);
    logResult('Reasoning Q2', { reply });
    expect(reply.length).toBeGreaterThan(40);
    expect(reply.toLowerCase()).toMatch(/instead|alternative|try|could|gentle|reduce|switch|option/);
  });

  test('Q3: explanation includes rationale terms', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'Why are you recommending this?');
    const reply = await waitForAssistantReply(page, 30000);
    logResult('Reasoning Q3', { reply });
    expect(reply.length).toBeGreaterThan(40);
    expect(reply.toLowerCase()).toMatch(/because|reason|ingredient|helps|may|can|risk|benefit/);
  });

  test('avoid generic no-information fallback', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'Give me an ingredient safety summary in bullets.');
    const reply = await waitForAssistantReply(page, 30000);
    const low = reply.toLowerCase();
    expect(low).not.toContain("i don't have information");
    expect(low).not.toContain('cannot access');
    expect(low).not.toContain('no data available');
  });

  test('evidence-like terms present in reasoning', async ({ page, request }) => {
    test.skip(!(await chromiumLaunchable()), 'Chromium browser cannot launch in this environment');
    test.skip(!(await isMiddlewareReachable(request)), 'middleware not reachable');
    await openAssistantChat(page);
    await injectBarcode(page, BASE_BARCODE);
    await waitForPinnedProduct(page, 30000);
    await sendChatMessage(page, 'List key actives and possible irritants.');
    const reply = await waitForAssistantReply(page, 30000);
    const low = reply.toLowerCase();
    const hasEvidenceTerms =
      /niacinamide|zinc|active|ingredient|irritant|fragrance|barrier|sensitivity/.test(low);
    expect(hasEvidenceTerms).toBeTruthy();
  });
});

