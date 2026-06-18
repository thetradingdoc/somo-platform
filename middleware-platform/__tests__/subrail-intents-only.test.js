'use strict';

const fs = require('fs');
const path = require('path');

describe('subrail intents-only audit', () => {
  const subrailDir = path.join(__dirname, '../services/conversation-mode/subrails');

  test('booking subrail does not write current_booking_slot', () => {
    const src = fs.readFileSync(path.join(subrailDir, 'booking-subrail.js'), 'utf8');
    expect(src).not.toMatch(/current_booking_slot\s*:/);
  });

  test('cancellation subrail does not write current_booking_slot', () => {
    const src = fs.readFileSync(path.join(subrailDir, 'cancellation-subrail.js'), 'utf8');
    expect(src).not.toMatch(/current_booking_slot\s*:/);
  });

  test('records subrail does not write slot or appointment ids', () => {
    const src = fs.readFileSync(path.join(subrailDir, 'records-qa-subrail.js'), 'utf8');
    expect(src).not.toMatch(/current_booking_slot/);
    expect(src).not.toMatch(/appointment_id\s*:/);
  });
});
