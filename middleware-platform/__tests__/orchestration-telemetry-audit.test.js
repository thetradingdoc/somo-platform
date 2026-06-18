'use strict';

const { auditOrchestrationTrace, emitTelemetryGapIfNeeded } = require('../services/orchestration-telemetry-audit');

describe('orchestration telemetry audit', () => {
  test('auditOrchestrationTrace flags missing fields', () => {
    const { complete, missing } = auditOrchestrationTrace({
      conversation_mode: 'tenant_inbound_admin',
      lane: 'booking',
      step: 'schedule_visit'
    });
    expect(complete).toBe(false);
    expect(missing).toContain('gate_matched');
    expect(missing).toContain('tools_executed');
  });

  test('emitTelemetryGapIfNeeded records gap event', () => {
    const events = [];
    const db = {
      insertKellyCallEvent: (e) => events.push(e)
    };
    const result = emitTelemetryGapIfNeeded(db, 'sess-gap', { lane: 'booking' });
    expect(result.complete).toBe(false);
    expect(events.some((e) => e.event_type === 'orchestration_trace_gap')).toBe(true);
  });
});
