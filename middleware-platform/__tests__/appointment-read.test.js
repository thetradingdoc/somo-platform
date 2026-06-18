'use strict';

const {
  readAppointmentRowById,
  formatAppointmentWhen
} = require('../services/kelly-rails/appointment-read');

describe('appointment-read (confirm DB path)', () => {
  test('formatAppointmentWhen joins date and time', () => {
    expect(
      formatAppointmentWhen({ appointment_date: '2026-06-10', appointment_time: '12:00' })
    ).toBe('2026-06-10 at 12:00');
  });

  test('readAppointmentRowById returns null without id', () => {
    expect(readAppointmentRowById(null)).toBeNull();
  });
});
