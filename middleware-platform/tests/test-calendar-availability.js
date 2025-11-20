#!/usr/bin/env node

/**
 * Test: Google Calendar events block slot availability
 * Run: node tests/test-calendar-availability.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BookingService = require('../services/booking-service');
const db = require('../database');

async function run() {
    const originalGetCalendarClient = BookingService.getCalendarClient;
    const testDate = '2099-01-02';
    const testTimezone = 'America/New_York';

    try {
        // Stub calendar client to return a conflict at 10:00 AM
        BookingService.getCalendarClient = () => ({
            client: {
                events: {
                    list: async () => ({
                        data: {
                            items: [
                                {
                                    id: 'external-event-123',
                                    status: 'confirmed',
                                    start: { dateTime: `${testDate}T10:00:00` },
                                    end: { dateTime: `${testDate}T11:00:00` }
                                }
                            ]
                        }
                    })
                }
            },
            calendarId: 'primary'
        });

        // Ensure database has no appointments on the test date
        const existing = db.getAppointmentsByDate(testDate);
        if (existing.length > 0) {
            console.log(`⚠️  Removing ${existing.length} existing test appointments on ${testDate}`);
            existing.forEach(appt => db.deleteAppointment(appt.id));
        }

        const TEST_CLINIC_ID = 'test-calendar-clinic';
        const result = await BookingService.getAvailableSlots(testDate, null, null, testTimezone, TEST_CLINIC_ID);

        if (!result.success) {
            throw new Error(`Availability check failed: ${result.error}`);
        }

        if (result.available_slots.includes('10:00')) {
            throw new Error('Slot 10:00 was still available despite external calendar event');
        }

        console.log('✅ External Google Calendar event correctly blocked slot 10:00');
        process.exit(0);
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    } finally {
        BookingService.getCalendarClient = originalGetCalendarClient;
    }
}

run();

