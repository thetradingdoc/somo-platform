'use strict';

process.env.VOICE_RATE_LIMIT_BACKEND = 'memory';

const voiceActiveCalls = require('../services/voice-active-calls-service');
const { getConcurrentCallsForCustomer } = require('../services/billing-access');

describe('voice concurrent calls', () => {
  const customerId = `cust-concurrent-${Date.now()}`;
  const max = getConcurrentCallsForCustomer({ plan_tier: 'starter' });

  beforeEach(() => {
    voiceActiveCalls._memoryActive.clear();
  });

  test('allows up to max concurrent then rejects', async () => {
    for (let i = 0; i < max; i++) {
      const cap = await voiceActiveCalls.checkConcurrentCapacity(customerId, max);
      expect(cap.allowed).toBe(true);
      await voiceActiveCalls.reserveSlot(customerId, `call-${i}`);
    }
    const blocked = await voiceActiveCalls.checkConcurrentCapacity(customerId, max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.active).toBe(max);
  });

  test('releases slot after call end', async () => {
    await voiceActiveCalls.reserveSlot(customerId, 'call-a');
    await voiceActiveCalls.reserveSlot(customerId, 'call-b');
    expect(await voiceActiveCalls.getActiveCount(customerId)).toBe(2);
    await voiceActiveCalls.releaseSlot(customerId, 'call-a');
    expect(await voiceActiveCalls.getActiveCount(customerId)).toBe(1);
    const cap = await voiceActiveCalls.checkConcurrentCapacity(customerId, max);
    expect(cap.allowed).toBe(true);
  });
});
