'use strict';

const { formatActivityRow } = require('../services/kelly-activity-feed-service');

describe('activity feed first-contact rows', () => {
  test('voice call_opener_used renders a first-contact (voice) row', () => {
    const row = formatActivityRow({
      id: 1,
      created_at: '2026-06-30T00:00:00Z',
      event_type: 'call_opener_used',
      session_id: 'call-1',
      payload_json: JSON.stringify({ direction: 'inbound', opener_source: 'default' })
    });
    expect(row).toBeTruthy();
    expect(row.icon).toBe('phone');
    expect(row.subline).toMatch(/voice/i);
    expect(row.href).toContain('call-1');
  });

  test('chat first_contact renders a first-contact (chat) row with patient name', () => {
    const row = formatActivityRow({
      id: 2,
      created_at: '2026-06-30T00:00:00Z',
      event_type: 'first_contact',
      session_id: 'sess-1',
      payload_json: JSON.stringify({ channel: 'chat', patient_name: 'Maria Gomez' })
    });
    expect(row).toBeTruthy();
    expect(row.icon).toBe('message');
    expect(row.headline).toMatch(/Maria Gomez/);
    expect(row.subline).toMatch(/chat/i);
  });

  test('chat first_contact without a name falls back to generic headline', () => {
    const row = formatActivityRow({
      id: 3,
      created_at: '2026-06-30T00:00:00Z',
      event_type: 'first_contact',
      session_id: 'sess-2',
      payload_json: JSON.stringify({ channel: 'chat' })
    });
    expect(row.headline).toMatch(/new chat/i);
  });
});
