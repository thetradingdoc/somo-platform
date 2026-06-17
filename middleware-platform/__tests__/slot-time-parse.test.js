'use strict';

const { parseSlotTimeFromMessage, normalizeSlotTime } = require('../services/kelly-rails/slot-time-parse');

describe('slot-time-parse', () => {
  test('parseSlotTimeFromMessage extracts HH:MM', () => {
    expect(parseSlotTimeFromMessage('12:00 with Dr. Maria Santos works for me')).toBe('12:00');
    expect(parseSlotTimeFromMessage('noon tomorrow')).toBeNull();
    expect(parseSlotTimeFromMessage('3 pm please')).toBe('15:00');
  });

  test('normalizeSlotTime recovers from corrupted stored values', () => {
    expect(normalizeSlotTime('12:00 with dr. maria santos works for me')).toBe('12:00');
    expect(normalizeSlotTime('12:00')).toBe('12:00');
    expect(normalizeSlotTime('9:05')).toBe('09:05');
  });
});
