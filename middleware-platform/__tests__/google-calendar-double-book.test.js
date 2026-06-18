'use strict';

/**
 * CR-050 — Google Calendar double-book prevention contract.
 */

const BookingService = require('../services/booking-service');

describe('Google Calendar double-book prevention', () => {
  test('BookingService exposes slot availability check for conflict paths', () => {
    expect(typeof BookingService._checkSlotAvailability).toBe('function');
  });
});
