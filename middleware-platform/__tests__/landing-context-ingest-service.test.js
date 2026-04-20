'use strict';

describe('landing-context-ingest-service', () => {
  let dbState;
  let metaState;
  let metricsState;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dbState = { row: null, upsertCalls: 0 };
    metaState = new Map();
    metricsState = Object.create(null);

    jest.doMock('../database', () => ({
      getOrchestrateSessionBySessionId: jest.fn((sessionId) => {
        const row = dbState.row;
        if (!row || row.session_id !== sessionId) return null;
        return row;
      }),
      upsertOrchestrateSession: jest.fn((payload) => {
        dbState.upsertCalls += 1;
        dbState.row = { ...payload };
      })
    }));

    jest.doMock('../services/kelly-tool-executor', () => ({
      _getSessionMeta: jest.fn((sessionId, key) => metaState.get(`${sessionId}:${key}`) || null),
      _setSessionMeta: jest.fn((sessionId, key, value) => metaState.set(`${sessionId}:${key}`, String(value)))
    }));

    jest.doMock('../services/metrics', () => ({
      increment: jest.fn((name, value = 1) => {
        metricsState[name] = (metricsState[name] || 0) + value;
      })
    }));

    service = require('../services/landing-context-ingest-service');
  });

  test('deduplicates context writes by idempotency key', () => {
    const first = service.appendLandingContextEvent({
      sessionId: 'sess-1',
      eventType: 'barcode_product_context',
      text: '[Barcode Scan] Product context pinned',
      source: 'thread_event',
      idempotencyKey: 'evt-1'
    });
    const second = service.appendLandingContextEvent({
      sessionId: 'sess-1',
      eventType: 'barcode_product_context',
      text: '[Barcode Scan] Product context pinned',
      source: 'thread_event',
      idempotencyKey: 'evt-1'
    });

    expect(first.success).toBe(true);
    expect(first.duplicate).toBeFalsy();
    expect(first.context_version).toBe(1);
    expect(second.success).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.context_version).toBe(1);
    expect(dbState.upsertCalls).toBe(1);
    expect(metricsState['context.write.success']).toBe(1);
    expect(metricsState['context.write.duplicate']).toBe(1);
  });

  test('rejects stale/out-of-order writes by context version', () => {
    const first = service.appendLandingContextEvent({
      sessionId: 'sess-2',
      eventType: 'chat_turn_input',
      text: 'Is this product low risk?',
      source: 'turn_api',
      idempotencyKey: 'turn-1'
    });
    const stale = service.appendLandingContextEvent({
      sessionId: 'sess-2',
      eventType: 'chat_turn_input',
      text: 'Second message',
      source: 'turn_api',
      idempotencyKey: 'turn-2',
      expectedContextVersion: 1
    });

    expect(first.success).toBe(true);
    expect(first.context_version).toBe(1);
    expect(stale.success).toBe(false);
    expect(stale.stale_reject).toBe(true);
    expect(stale.context_version).toBe(1);
    expect(dbState.upsertCalls).toBe(1);
    expect(metricsState['context.write.stale_reject']).toBe(1);
  });
});
