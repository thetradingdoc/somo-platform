'use strict';

const { buildCallTimeline, labelForEvent } = require('../services/call-timeline-service');

describe('call-timeline-service', () => {
  test('maps call_opener_used to disclosure label', () => {
    expect(labelForEvent('call_opener_used', {})).toMatch(/Opener played/);
  });

  test('buildCallTimeline dedupes and sorts events', () => {
    const rows = buildCallTimeline([
      { event_type: 'booking_outcome', created_at: '2026-06-02T10:00:00Z', payload_json: '{}' },
      { event_type: 'call_opener_used', created_at: '2026-06-02T09:00:00Z', payload_json: '{}' },
      { event_type: 'call_opener_used', created_at: '2026-06-02T09:01:00Z', payload_json: '{}' }
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].event_type).toBe('call_opener_used');
    expect(rows[1].event_type).toBe('booking_outcome');
  });
});
