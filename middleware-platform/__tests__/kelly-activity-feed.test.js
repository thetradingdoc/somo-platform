'use strict';

const { formatActivityRow, listActivityForClinic } = require('../services/kelly-activity-feed-service');

describe('kelly-activity-feed-service', () => {
  test('formatActivityRow maps appointment_booked', () => {
    const row = formatActivityRow({
      id: 'e1',
      event_type: 'appointment_booked',
      created_at: '2026-06-01T12:00:00Z',
      session_id: 'sess-1',
      payload_json: JSON.stringify({
        patient_id: 'Patient/abc',
        patient_name: 'James Rivera',
        appointment_type: 'Dermatology',
      }),
    });
    expect(row.headline).toContain('James Rivera');
    expect(row.href).toContain('patient-case.html');
    expect(row.icon).toBe('calendar-days');
  });

  test('formatActivityRow maps payment_link_sent', () => {
    const row = formatActivityRow({
      id: 'e2',
      event_type: 'payment_link_sent',
      created_at: '2026-06-01T12:05:00Z',
      payload_json: JSON.stringify({
        patient_id: 'Patient/abc',
        amount: 40,
        payment_id: 'pay_1',
      }),
    });
    expect(row.headline).toContain('$40.00');
    expect(row.href).toBe('revenue.html?tab=payments');
    expect(row.payment_id).toBe('pay_1');
  });

  test('formatActivityRow maps turn_resolved with schedule tool', () => {
    const row = formatActivityRow({
      id: 'e3',
      event_type: 'turn_resolved',
      created_at: '2026-06-01T12:10:00Z',
      payload_json: JSON.stringify({
        tools_used: ['schedule_appointment'],
        patient_id: 'Patient/x',
      }),
    });
    expect(row).toBeTruthy();
    expect(row.headline).toContain('Kelly booked');
  });

  test('listActivityForClinic returns array for unknown clinic', () => {
    const items = listActivityForClinic('clinic-nonexistent-test', { limit: 5 });
    expect(Array.isArray(items)).toBe(true);
  });
});
