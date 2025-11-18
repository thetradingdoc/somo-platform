/**
 * Email Test Endpoint
 * Comprehensive email testing and diagnostics
 */

const express = require('express');
const router = express.Router();
const EmailService = require('../services/email-service');

/**
 * GET /api/test/email/status
 * Check email service configuration status
 */
router.get('/status', (req, res) => {
  const status = {
    azure_configured: EmailService.isAzureConfigured(),
    smtp_configured: !!EmailService.getTransporter(),
    smtp_host: process.env.SMTP_HOST || 'Not set',
    smtp_port: process.env.SMTP_PORT || 'Not set',
    smtp_user: process.env.SMTP_USER ? 'Set' : 'Not set',
    smtp_from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Not set',
    azure_connection_string: process.env.AZURE_COMMUNICATION_CONNECTION_STRING ? 'Set' : 'Not set',
    azure_sender: process.env.AZURE_EMAIL_SENDER || 'Not set',
    email_provider: EmailService.isAzureConfigured() ? 'Azure' : (EmailService.getTransporter() ? 'SMTP' : 'Console (Simulation)'),
    nodemailer_installed: !!require('nodemailer'),
    azure_sdk_installed: !!require('@azure/communication-email')
  };

  res.json({
    success: true,
    status: status,
    message: status.email_provider === 'Console (Simulation)' 
      ? '⚠️  Email service is in simulation mode. Configure SMTP or Azure to send real emails.'
      : `✅ Email service configured via ${status.email_provider}`
  });
});

/**
 * POST /api/test/email/send
 * Send a test email
 */
router.post('/send', async (req, res) => {
  try {
    const { to, subject, html, text } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Email address (to) is required'
      });
    }

    console.log('\n📧 TEST EMAIL REQUEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject || 'Test Email'}`);
    console.log(`Provider: ${EmailService.isAzureConfigured() ? 'Azure' : (EmailService.getTransporter() ? 'SMTP' : 'Console')}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await EmailService.sendEmail({
      to: to,
      subject: subject || 'Test Email from DocLittle',
      html: html || '<p>This is a test email from DocLittle platform.</p>',
      text: text || 'This is a test email from DocLittle platform.'
    });

    console.log('\n📧 EMAIL SEND RESULT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(JSON.stringify(result, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.json({
      success: result.success,
      result: result,
      message: result.success 
        ? `Email sent successfully via ${result.provider || 'unknown'}`
        : `Failed to send email: ${result.error || 'Unknown error'}`,
      provider: result.provider || 'unknown'
    });

  } catch (error) {
    console.error('❌ Email test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * POST /api/test/email/appointment
 * Test appointment confirmation email
 */
router.post('/appointment', async (req, res) => {
  try {
    const { to, patient_name } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Email address (to) is required'
      });
    }

    const testAppointment = {
      id: 'test-appt-' + Date.now(),
      patient_name: patient_name || 'Test Patient',
      patient_email: to,
      appointment_type: 'Therapy Session - Psychiatry',
      date: new Date().toISOString().split('T')[0],
      time: '1:00 PM',
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 50,
      provider: 'DocLittle Mental Health Team',
      timezone: 'America/New_York',
      calendar_link: 'https://calendar.google.com/test'
    };

    console.log('\n📧 TEST APPOINTMENT EMAIL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`Patient: ${testAppointment.patient_name}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await EmailService.sendAppointmentConfirmation(testAppointment);

    res.json({
      success: result.success,
      result: result,
      message: result.success 
        ? `Appointment confirmation email sent via ${result.provider || 'unknown'}`
        : `Failed to send: ${result.error || 'Unknown error'}`,
      provider: result.provider || 'unknown'
    });

  } catch (error) {
    console.error('❌ Appointment email test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/email/insurance-billing
 * Test insurance billing email
 */
router.post('/insurance-billing', async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Email address (to) is required'
      });
    }

    const testClaimData = {
      claimId: 'test-claim-' + Date.now(),
      x12ClaimId: 'X12_TEST_' + Date.now(),
      memberId: 'TEST123456',
      patientName: 'Test Patient',
      serviceCode: '90834',
      totalAmount: 150.00,
      copayPaid: 20.00,
      dateOfService: new Date().toISOString().split('T')[0]
    };

    console.log('\n📧 TEST INSURANCE BILLING EMAIL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`Claim ID: ${testClaimData.claimId}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await EmailService.sendInsuranceBillingEmail(to, testClaimData);

    res.json({
      success: result.success,
      result: result,
      message: result.success 
        ? `Insurance billing email sent via ${result.provider || 'unknown'}`
        : `Failed to send: ${result.error || 'Unknown error'}`,
      provider: result.provider || 'unknown'
    });

  } catch (error) {
    console.error('❌ Insurance billing email test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/email/patient-billing
 * Test patient billing email
 */
router.post('/patient-billing', async (req, res) => {
  try {
    const { to, patient_name } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Email address (to) is required'
      });
    }

    const testBillingData = {
      patientName: patient_name || 'Test Patient',
      appointmentDate: new Date().toISOString().split('T')[0],
      serviceName: 'Therapy Session - Psychiatry',
      totalAmount: 150.00,
      insuranceAmount: 130.00,
      copayAmount: 20.00,
      amountDue: 20.00,
      paymentLink: `${process.env.BASE_URL || 'http://localhost:4000'}/payment/test-token`
    };

    console.log('\n📧 TEST PATIENT BILLING EMAIL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`Patient: ${testBillingData.patientName}`);
    console.log(`Amount Due: $${testBillingData.amountDue}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await EmailService.sendPatientBillingEmail(to, testBillingData);

    res.json({
      success: result.success,
      result: result,
      message: result.success 
        ? `Patient billing email sent via ${result.provider || 'unknown'}`
        : `Failed to send: ${result.error || 'Unknown error'}`,
      provider: result.provider || 'unknown'
    });

  } catch (error) {
    console.error('❌ Patient billing email test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/email/checkout
 * Test checkout verification email
 */
router.post('/checkout', async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Email address (to) is required'
      });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    console.log('\n📧 TEST CHECKOUT VERIFICATION EMAIL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`Verification Code: ${verificationCode}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const result = await EmailService.sendCheckoutVerificationCode(to, verificationCode);

    res.json({
      success: result.success,
      result: result,
      verification_code: verificationCode,
      message: result.success 
        ? `Checkout verification email sent via ${result.provider || 'unknown'}`
        : `Failed to send: ${result.error || 'Unknown error'}`,
      provider: result.provider || 'unknown'
    });

  } catch (error) {
    console.error('❌ Checkout email test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/email/all
 * Test all email types
 */
router.post('/all', async (req, res) => {
  try {
    const { patient_email, insurer_email } = req.body;

    if (!patient_email || !insurer_email) {
      return res.status(400).json({
        success: false,
        error: 'Both patient_email and insurer_email are required'
      });
    }

    const results = {
      status: await EmailService.isAzureConfigured() ? 'Azure' : (EmailService.getTransporter() ? 'SMTP' : 'Console'),
      tests: []
    };

    // Test 1: Appointment Confirmation
    const testAppointment = {
      id: 'test-appt-' + Date.now(),
      patient_name: 'Test Patient',
      patient_email: patient_email,
      appointment_type: 'Therapy Session - Psychiatry',
      date: new Date().toISOString().split('T')[0],
      time: '1:00 PM',
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      duration_minutes: 50,
      provider: 'DocLittle Mental Health Team',
      timezone: 'America/New_York'
    };

    const appointmentResult = await EmailService.sendAppointmentConfirmation(testAppointment);
    results.tests.push({
      type: 'Appointment Confirmation',
      to: patient_email,
      success: appointmentResult.success,
      provider: appointmentResult.provider,
      error: appointmentResult.error
    });

    // Test 2: Insurance Billing
    const claimData = {
      claimId: 'test-claim-' + Date.now(),
      x12ClaimId: 'X12_TEST_' + Date.now(),
      memberId: 'TEST123456',
      patientName: 'Test Patient',
      serviceCode: '90834',
      totalAmount: 150.00,
      copayPaid: 20.00,
      dateOfService: new Date().toISOString().split('T')[0]
    };

    const insuranceResult = await EmailService.sendInsuranceBillingEmail(insurer_email, claimData);
    results.tests.push({
      type: 'Insurance Billing',
      to: insurer_email,
      success: insuranceResult.success,
      provider: insuranceResult.provider,
      error: insuranceResult.error
    });

    // Test 3: Patient Billing
    const billingData = {
      patientName: 'Test Patient',
      appointmentDate: new Date().toISOString().split('T')[0],
      serviceName: 'Therapy Session - Psychiatry',
      totalAmount: 150.00,
      insuranceAmount: 130.00,
      copayAmount: 20.00,
      amountDue: 20.00
    };

    const patientBillingResult = await EmailService.sendPatientBillingEmail(patient_email, billingData);
    results.tests.push({
      type: 'Patient Billing',
      to: patient_email,
      success: patientBillingResult.success,
      provider: patientBillingResult.provider,
      error: patientBillingResult.error
    });

    // Test 4: Checkout Verification
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const checkoutResult = await EmailService.sendCheckoutVerificationCode(patient_email, verificationCode);
    results.tests.push({
      type: 'Checkout Verification',
      to: patient_email,
      success: checkoutResult.success,
      provider: checkoutResult.provider,
      error: checkoutResult.error
    });

    const allSuccess = results.tests.every(t => t.success);
    const successCount = results.tests.filter(t => t.success).length;

    res.json({
      success: allSuccess,
      email_provider: results.status,
      total_tests: results.tests.length,
      successful: successCount,
      failed: results.tests.length - successCount,
      tests: results.tests,
      message: allSuccess 
        ? `All ${results.tests.length} emails sent successfully via ${results.status}`
        : `${successCount}/${results.tests.length} emails sent successfully. ${results.tests.length - successCount} failed.`
    });

  } catch (error) {
    console.error('❌ All emails test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

