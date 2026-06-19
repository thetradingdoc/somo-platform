'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { isOrchestrationMetaKey } = require('../services/kelly-rails/meta-kv-policy');

describe('meta-kv-policy phase 1 (T-010)', () => {
  test('orchestration keys are classified', () => {
    expect(isOrchestrationMetaKey('conversation_mode')).toBe(true);
    expect(isOrchestrationMetaKey('payment_token')).toBe(false);
  });

  test('direct orchestration meta_kv write is blocked', () => {
    const sid = 'meta-kv-test-' + Date.now();
    KellyToolExecutor._setSessionMeta(sid, 'conversation_mode', 'tenant_inbound_admin');
    expect(KellyToolExecutor._getSessionMeta(sid, 'conversation_mode')).toBeNull();
  });

  test('commerce keys still writable', () => {
    const sid = 'meta-kv-commerce-' + Date.now();
    KellyToolExecutor._setSessionMeta(sid, 'payment_token', 'tok_123');
    expect(KellyToolExecutor._getSessionMeta(sid, 'payment_token')).toBe('tok_123');
  });
});
