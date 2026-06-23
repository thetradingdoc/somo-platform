/**
 * RETELL CUSTOM FUNCTION ENDPOINTS
 * 
 * These endpoints are called by Retell when the agent invokes custom functions
 * during a call. They handle email and SMS follow-ups from the sales agent.
 */

const express = require('express');
const router = express.Router();
const EmailService = require('../../services/platform/email-service');
const SMSService = require('../../services/platform/sms-service');
const db = require('../../database');

/**
 * Middleware to verify Retell webhook secret
 * SECURITY: In production, webhook secret is REQUIRED
 */
function verifyRetellSecret(req, res, next) {
  const secret = req.headers['x-retell-secret'];
  const expectedSecret = process.env.RETELL_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';

  // SECURITY: In production, webhook secret is REQUIRED
  if (!expectedSecret) {
    if (isProduction) {
      console.error('❌ SECURITY ERROR: RETELL_WEBHOOK_SECRET is required in production');
      return res.status(500).json({
        success: false,
        error: 'Webhook authentication is not configured. Server misconfiguration.'
      });
    }
    // Development: warn but allow (for local testing only)
    console.warn('⚠️  RETELL_WEBHOOK_SECRET not configured - allowing request (DEVELOPMENT ONLY)');
    return next();
  }

  if (!secret || secret !== expectedSecret) {
    console.error('❌ Invalid Retell secret:', secret ? 'provided but incorrect' : 'missing');
    return res.status(401).json({
      success: false,
      error: 'Invalid Retell secret'
    });
  }

  next();
}

/**
 * POST /api/retell/send-followup-email
 * Send a follow-up email from the sales agent during a call
 * 
 * Expected payload from Retell:
 * {
 *   "call": { "call_id": "..." },
 *   "parameters": {
 *     "to_email": "clinic@example.com",
 *     "subject": "Follow-up from Somo",
 *     "body": "Email content here",
 *     "lead_id": "lead-uuid" (optional)
 *   }
 * }
 */
router.post('/send-followup-email', verifyRetellSecret, express.json(), async (req, res) => {
  try {
    console.log('\n📧 RETELL: Send Follow-up Email');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const { safeLogRequestBody } = require('../../services/commerce/payment-security');
    safeLogRequestBody('Request body:', req);

    // Extract parameters from Retell payload
    // Retell sends: { call: {...}, parameters: {...} }
    const parameters = req.body.parameters || req.body;
    const callId = req.body.call?.call_id || req.body.call_id || null;
    const leadId = parameters.lead_id || null;

    const toEmail = parameters.to_email || parameters.email;
    const subject = parameters.subject || 'Follow-up from Somo';
    const body = parameters.body || parameters.message || '';

    if (!toEmail) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: to_email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toEmail)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Format email HTML
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Somo Voice Assistant</h1>
          </div>
          <div class="content">
            ${body.replace(/\n/g, '<br>')}
          </div>
          <div class="footer">
            <p>This email was sent by the Somo voice assistant during a call.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    const emailResult = await EmailService.sendEmail({
      to: toEmail,
      subject: subject,
      html: html,
      text: body
    });

    if (!emailResult.success) {
      console.error('❌ Email send failed:', emailResult.error);
      return res.status(500).json({
        success: false,
        error: emailResult.error || 'Failed to send email'
      });
    }

    console.log(`✅ Email sent to ${toEmail}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Provider: ${emailResult.provider}`);

    // Log to lead activity if lead_id provided
    if (leadId) {
      try {
        db.createLeadActivity({
          lead_id: leadId,
          activity_type: 'email',
          activity_subject: 'Follow-up Email Sent',
          activity_description: `Email sent to ${toEmail}: ${subject}`,
          created_by: 'voice_agent',
          metadata: JSON.stringify({
            call_id: callId,
            email: toEmail,
            subject: subject,
            provider: emailResult.provider,
            message_id: emailResult.message_id
          })
        });
      } catch (activityError) {
        console.warn('⚠️  Failed to log email activity:', activityError.message);
      }
    }

    res.json({
      success: true,
      message: 'Email sent successfully',
      email: {
        to: toEmail,
        subject: subject,
        provider: emailResult.provider,
        message_id: emailResult.message_id
      },
      call_id: callId,
      lead_id: leadId
    });

  } catch (error) {
    console.error('❌ Send follow-up email error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/retell/send-followup-sms
 * Send a follow-up SMS from the sales agent during a call
 * 
 * Expected payload from Retell:
 * {
 *   "call": { "call_id": "..." },
 *   "parameters": {
 *     "to_phone": "+15551234567",
 *     "message": "SMS content here",
 *     "lead_id": "lead-uuid" (optional)
 *   }
 * }
 */
router.post('/send-followup-sms', verifyRetellSecret, express.json(), async (req, res) => {
  try {
    console.log('\n📱 RETELL: Send Follow-up SMS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const { safeLogRequestBody } = require('../../services/commerce/payment-security');
    safeLogRequestBody('Request body:', req);

    // Extract parameters from Retell payload
    const parameters = req.body.parameters || req.body;
    const callId = req.body.call?.call_id || req.body.call_id || null;
    const leadId = parameters.lead_id || null;

    const toPhone = parameters.to_phone || parameters.phone;
    const message = parameters.message || parameters.body || '';

    if (!toPhone) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: to_phone'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: message'
      });
    }

    // Format phone number (ensure E.164)
    let formattedPhone = toPhone.trim();
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.length === 10) {
        formattedPhone = `+1${formattedPhone}`;
      } else {
        formattedPhone = `+${formattedPhone}`;
      }
    }

    // Send SMS
    const smsResult = await SMSService.sendSMS(formattedPhone, message);

    if (!smsResult.success) {
      console.error('❌ SMS send failed:', smsResult.error);
      return res.status(500).json({
        success: false,
        error: smsResult.error || 'Failed to send SMS'
      });
    }

    console.log(`✅ SMS sent to ${formattedPhone}`);
    console.log(`   Provider: ${smsResult.provider || 'twilio'}`);

    // Log to lead activity if lead_id provided
    if (leadId) {
      try {
        db.createLeadActivity({
          lead_id: leadId,
          activity_type: 'sms',
          activity_subject: 'Follow-up SMS Sent',
          activity_description: `SMS sent to ${formattedPhone}`,
          created_by: 'voice_agent',
          metadata: JSON.stringify({
            call_id: callId,
            phone: formattedPhone,
            message: message,
            provider: smsResult.provider || 'twilio',
            message_sid: smsResult.message_sid
          })
        });
      } catch (activityError) {
        console.warn('⚠️  Failed to log SMS activity:', activityError.message);
      }
    }

    res.json({
      success: true,
      message: 'SMS sent successfully',
      sms: {
        to: formattedPhone,
        provider: smsResult.provider || 'twilio',
        message_sid: smsResult.message_sid
      },
      call_id: callId,
      lead_id: leadId
    });

  } catch (error) {
    console.error('❌ Send follow-up SMS error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

module.exports = router;

