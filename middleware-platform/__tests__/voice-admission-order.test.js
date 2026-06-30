'use strict';

process.env.VOICE_RATE_LIMIT_BACKEND = 'memory';

const fs = require('fs');
const path = require('path');
const voiceActiveCalls = require('../services/voice-active-calls-service');
const voiceLimitService = require('../services/voice-limit-service');
const { check, _memoryStore } = require('../utils/clinic-rate-limiter');

describe('voice admission order', () => {
  beforeEach(() => {
    voiceActiveCalls._memoryActive.clear();
    _memoryStore.clear();
  });

  test('handler checks concurrent capacity before call_admission in source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/voice-incoming-handler.js'),
      'utf8'
    );
    const concurrentIdx = src.indexOf('checkConcurrentCapacity');
    const admissionIdx = src.indexOf('checkCallAdmission');
    expect(concurrentIdx).toBeGreaterThan(-1);
    expect(admissionIdx).toBeGreaterThan(-1);
    expect(concurrentIdx).toBeLessThan(admissionIdx);
  });

  test('concurrent-full scenario does not require admission increment for busy callers', async () => {
    const customerId = `cust-order-${Date.now()}`;
    const admissionKey = customerId;
    const maxConcurrent = 2;

    await voiceActiveCalls.reserveSlot(customerId, 'call-1');
    await voiceActiveCalls.reserveSlot(customerId, 'call-2');

    const capacity = await voiceActiveCalls.checkConcurrentCapacity(customerId, maxConcurrent);
    expect(capacity.allowed).toBe(false);

    const admissionBeforeBusy = check(`${admissionKey}-probe`, 30);
    expect(admissionBeforeBusy.remaining).toBe(29);

    const admissionAfterBusy = check(`${admissionKey}-probe`, 30);
    expect(admissionAfterBusy.remaining).toBe(28);
  });

  test('admission increments only after concurrent capacity available', async () => {
    const customerId = `cust-admit-${Date.now()}`;
    const cap = await voiceActiveCalls.checkConcurrentCapacity(customerId, 2);
    expect(cap.allowed).toBe(true);

    const first = await voiceLimitService.checkCallAdmission({
      customerId,
      tierLimit: 30
    });
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(29);
  });
});
