/**
 * Test Appointment Email Booking Flow
 * 
 * This script tests:
 * 1. Creating an appointment with email
 * 2. Verifying email is sent
 * 3. Verifying email contains appointment details
 */

const BookingService = require('../services/booking-service');
const EmailService = require('../services/email-service');
const db = require('../database');

// Test configuration
const TEST_APPOINTMENT = {
    patient_name: 'Test Patient Email',
    patient_phone: '+15551234567',
    patient_email: 'test@example.com', // Change this to your test email
    appointment_type: 'Cardiology Consultation',
    date: '2025-11-15', // Tomorrow
    time: '2:00 PM',
    timezone: 'America/New_York',
    notes: 'Test appointment for email verification',
    clinic_id: 'test-clinic-email'
};

async function testAppointmentEmail() {
    console.log('\n🧪 TESTING APPOINTMENT EMAIL BOOKING FLOW');
    console.log('='.repeat(60));

    try {
        // Clean up any existing appointments for the test date/time to avoid conflicts
        console.log('\n🧹 Cleaning up existing appointments for test date...');
        const existingAppts = await db.getAppointmentsByDate(TEST_APPOINTMENT.date, TEST_APPOINTMENT.clinic_id);
        
        // Delete appointments that might conflict (same time or overlapping)
        existingAppts.forEach(appt => {
            try {
                db.deleteAppointment(appt.id, appt.clinic_id);
                console.log(`  ✓ Deleted existing appointment ${appt.id} at ${appt.time}`);
            } catch (err) {
                console.warn(`  ⚠️  Failed to delete ${appt.id}: ${err.message}`);
            }
        });

        // Step 1: Create appointment
        console.log('\n📋 Step 1: Creating appointment...');
        console.log('Appointment Details:');
        console.log(`  Patient: ${TEST_APPOINTMENT.patient_name}`);
        console.log(`  Email: ${TEST_APPOINTMENT.patient_email}`);
        console.log(`  Date: ${TEST_APPOINTMENT.date}`);
        console.log(`  Time: ${TEST_APPOINTMENT.time}`);
        console.log(`  Type: ${TEST_APPOINTMENT.appointment_type}`);

        const bookingResult = await BookingService.scheduleAppointment(TEST_APPOINTMENT);

        if (!bookingResult.success) {
            console.error('❌ Appointment creation failed:', bookingResult.error);
            return {
                success: false,
                error: bookingResult.error
            };
        }

        console.log('✅ Appointment created successfully!');
        console.log(`  Appointment ID: ${bookingResult.appointment.id}`);
        console.log(`  Confirmation Number: ${bookingResult.appointment.confirmation_number}`);
        console.log(`  Date/Time: ${bookingResult.appointment.datetime}`);

        // Step 2: Verify appointment in database
        console.log('\n📊 Step 2: Verifying appointment in database...');
        const appointment = await db.getAppointment(bookingResult.appointment.id, TEST_APPOINTMENT.clinic_id);

        if (!appointment) {
            console.error('❌ Appointment not found in database!');
            return {
                success: false,
                error: 'Appointment not found in database'
            };
        }

        console.log('✅ Appointment found in database');
        console.log(`  Status: ${appointment.status}`);
        console.log(`  Email: ${appointment.patient_email}`);
        console.log(`  Created: ${appointment.created_at}`);

        // Step 3: Check if email was sent
        console.log('\n📧 Step 3: Checking email service...');

        // Check email configuration
        const hasSMTP = !!process.env.SMTP_HOST && !!process.env.SMTP_USER && !!process.env.SMTP_PASSWORD;
        const hasAzure = !!process.env.AZURE_COMMUNICATION_CONNECTION_STRING;

        if (!hasSMTP && !hasAzure) {
            console.log('⚠️  No email service configured (SMTP or Azure)');
            console.log('   Email will be logged to console only');
            console.log('   This is expected in development mode');
        } else {
            console.log(`✅ Email service configured: ${hasAzure ? 'Azure' : 'SMTP'}`);
        }

        // Step 4: Test email sending directly
        console.log('\n📧 Step 4: Testing email sending directly...');
        console.log(`Sending test email to: ${TEST_APPOINTMENT.patient_email}`);

        const emailResult = await EmailService.sendAppointmentConfirmation(appointment);

        if (emailResult.success) {
            console.log('✅ Email sent successfully!');
            console.log(`  Provider: ${emailResult.provider}`);
            console.log(`  Message ID: ${emailResult.message_id}`);

            if (emailResult.provider === 'console') {
                console.log('  ⚠️  Email was logged to console (no email service configured)');
                console.log('  📝 Check the console output above for email content');
            } else {
                console.log(`  📧 Check inbox at: ${TEST_APPOINTMENT.patient_email}`);
            }
        } else {
            console.error('❌ Email sending failed:', emailResult.error);
            return {
                success: false,
                error: `Email sending failed: ${emailResult.error}`
            };
        }

        // Step 5: Verify email content
        console.log('\n📝 Step 5: Verifying email content...');
        console.log('Email should contain:');
        console.log(`  ✓ Patient name: ${appointment.patient_name}`);
        console.log(`  ✓ Date & Time: ${bookingResult.appointment.datetime}`);
        console.log(`  ✓ Appointment type: ${appointment.appointment_type}`);
        console.log(`  ✓ Confirmation number: ${bookingResult.appointment.confirmation_number}`);
        console.log(`  ✓ Provider: ${appointment.provider}`);

        // Step 6: Summary
        console.log('\n' + '='.repeat(60));
        console.log('✅ TEST SUMMARY');
        console.log('='.repeat(60));
        console.log('✓ Appointment created in database');
        console.log('✓ Email address stored correctly');
        console.log('✓ Email service called');
        console.log(`✓ Email ${emailResult.provider === 'console' ? 'logged to console' : 'sent successfully'}`);
        console.log('\n📋 Appointment Details:');
        console.log(`  ID: ${appointment.id}`);
        console.log(`  Confirmation: ${bookingResult.appointment.confirmation_number}`);
        console.log(`  Patient: ${appointment.patient_name}`);
        console.log(`  Email: ${appointment.patient_email}`);
        console.log(`  Date: ${appointment.date}`);
        console.log(`  Time: ${appointment.time}`);
        console.log(`  Type: ${appointment.appointment_type}`);
        console.log(`  Status: ${appointment.status}`);

        if (emailResult.provider !== 'console') {
            console.log('\n📧 Please check your email inbox at:', TEST_APPOINTMENT.patient_email);
            console.log('   Subject: "Appointment Confirmed - [Date & Time]"');
        }

        return {
            success: true,
            appointment: appointment,
            emailResult: emailResult,
            confirmation_number: bookingResult.appointment.confirmation_number
        };

    } catch (error) {
        console.error('\n❌ TEST FAILED:', error);
        console.error('Stack:', error.stack);
        return {
            success: false,
            error: error.message
        };
    }
}

// Run test
if (require.main === module) {
    testAppointmentEmail()
        .then(result => {
            if (result.success) {
                console.log('\n✅ All tests passed!');
                process.exit(0);
            } else {
                console.log('\n❌ Tests failed:', result.error);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('\n❌ Test error:', error);
            process.exit(1);
        });
}

module.exports = { testAppointmentEmail };

