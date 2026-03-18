/**
 * EMAIL SERVICE
 * Supports multiple email providers:
 * - SMTP (Gmail, SendGrid, Mailgun, etc.)
 * - Azure Communication Services Email (via SMTP or SDK)
 * Falls back to console logging if not configured
 */

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  console.warn('⚠️  nodemailer not installed - emails will be logged to console');
  console.warn('   Install with: npm install nodemailer');
  nodemailer = null;
}

let azureEmailClient;
try {
  const { EmailClient } = require('@azure/communication-email');
  azureEmailClient = EmailClient;
} catch (e) {
  // Azure SDK not installed - will use SMTP if configured
  azureEmailClient = null;
}

class EmailService {
  /**
   * Check if Azure Communication Services is configured
   */
  static isAzureConfigured() {
    return !!(process.env.AZURE_COMMUNICATION_CONNECTION_STRING && azureEmailClient);
  }

  /**
   * Get Azure Email Client
   */
  static getAzureClient() {
    if (!this.isAzureConfigured()) {
      return null;
    }

    try {
      // Parse connection string: endpoint=https://...;accesskey=...
      const connString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;

      // Handle escaped semicolons and backslashes
      const cleanConnString = connString.replace(/\\;/g, ';').replace(/\\/g, '');

      const endpointMatch = cleanConnString.match(/endpoint=https?:\/\/([^;]+)/);
      const accessKeyMatch = cleanConnString.match(/accesskey=([^;]+)/);

      if (!endpointMatch || !accessKeyMatch) {
        throw new Error('Invalid connection string format');
      }

      // Remove trailing slashes and clean endpoint
      let endpoint = endpointMatch[1].trim();
      endpoint = endpoint.replace(/\/+$/, ''); // Remove trailing slashes
      endpoint = `https://${endpoint}`;

      const accessKey = accessKeyMatch[1].trim();

      // Validate endpoint URL
      try {
        new URL(endpoint);
      } catch (urlError) {
        throw new Error(`Invalid endpoint URL: ${endpoint}`);
      }

      // Create client with endpoint and access key
      return new azureEmailClient(endpoint, { key: accessKey });
    } catch (error) {
      console.error('❌ Error initializing Azure Email Client:', error.message);
      return null;
    }
  }

  /**
   * Get email transporter (SMTP)
   * Returns null if credentials not configured
   */
  static getTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;

    if (!nodemailer) {
      console.warn('⚠️  nodemailer not installed - emails will be logged to console');
      return null;
    }

    if (!smtpHost || !smtpUser || !smtpPassword) {
      return null; // Silent return - will check Azure next
    }

    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPassword
      }
    });
  }

  /**
   * Send email via Azure Communication Services
   * @private
   * Note: Azure Communication Services Email API doesn't support attachments in the current SDK
   * Attachments will be skipped when using Azure
   */
  static async _sendViaAzure({ to, subject, html, text, attachments }) {
    try {
      const client = this.getAzureClient();
      if (!client) {
        return null;
      }

      if (attachments && attachments.length > 0) {
        console.warn('⚠️  Azure Communication Services Email API does not support attachments. Falling back to SMTP.');
        return null; // Fall back to SMTP for attachments
      }

      const senderAddress = process.env.AZURE_EMAIL_SENDER || process.env.SMTP_FROM || 'DoNotReply@azurecomm.net';

      const message = {
        content: {
          subject: subject,
          plainText: text || html.replace(/<[^>]*>/g, ''),
          html: html
        },
        recipients: {
          to: [{ address: to }]
        },
        senderAddress: senderAddress
      };

      const poller = await client.beginSend(message);
      const result = await poller.pollUntilDone();

      console.log('📧 Email sent via Azure:', result.id);
      return { success: true, message_id: result.id, provider: 'azure' };

    } catch (error) {
      console.error('❌ Azure email send error:', error.message);
      return { success: false, error: error.message, provider: 'azure' };
    }
  }

  /**
   * Send email
   * Supports both Azure Communication Services and SMTP
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML body
   * @param {string} options.text - Plain text body (optional)
   * @param {Array} options.attachments - Email attachments (optional)
   */
  static async sendEmail({ to, subject, html, text, attachments }) {
    try {
      // Try Azure first if configured
      if (this.isAzureConfigured()) {
        const azureResult = await this._sendViaAzure({ to, subject, html, text, attachments });
        if (azureResult && azureResult.success) {
          return azureResult;
        }
        // If Azure fails, fall back to SMTP
        console.warn('⚠️  Azure email failed, falling back to SMTP');
      }

      // Try SMTP
      const transporter = this.getTransporter();
      const from = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.AZURE_EMAIL_SENDER || 'noreply@doclittle.health';

      if (transporter) {
        const mailOptions = {
          from: from,
          to: to,
          subject: subject,
          html: html,
          text: text || html.replace(/<[^>]*>/g, '')
        };

        // Add attachments if provided
        if (attachments && attachments.length > 0) {
          mailOptions.attachments = attachments;
        }

        const info = await transporter.sendMail(mailOptions);

        console.log('📧 Email sent via SMTP:', info.messageId);
        if (attachments && attachments.length > 0) {
          console.log(`   Attachments: ${attachments.length} file(s)`);
        }
        return { success: true, message_id: info.messageId, provider: 'smtp' };
      }

      // If no email service configured, log to console
      console.log('\n📧 EMAIL (SIMULATED):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`From: ${from}`);
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body:\n${text || html}`);
      if (attachments && attachments.length > 0) {
        console.log(`Attachments: ${attachments.length} file(s)`);
        attachments.forEach(att => {
          console.log(`  - ${att.filename || 'attachment'} (${att.content ? att.content.length : 0} bytes)`);
        });
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return { success: true, message_id: 'simulated', provider: 'console' };

    } catch (error) {
      console.error('❌ Email send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send appointment confirmation email
   * @param {Object} appointment - appointment record
   * @param {Object} [options] - { uploadLink } (Phase 5: upload portal link)
   */
  static async sendAppointmentConfirmation(appointment, options = {}) {
    const { uploadLink } = options;
    // Format confirmation number (matches booking service format)
    const confirmationNumber = appointment.id && appointment.id.length > 13
      ? appointment.id.substring(5, 13).toUpperCase()
      : (appointment.id || 'N/A');

    const dateTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: appointment.timezone || 'America/New_York'
    });

    const uploadBlock = uploadLink
      ? `<p>You can upload documents (labs, images) before your visit using this link: <a href="${uploadLink}">Upload documents</a>.</p>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .appointment-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #0891b2; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .button { display: inline-block; padding: 12px 24px; background: #0891b2; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
          .button:hover { background: #0e7490; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Appointment Confirmed</h1>
          </div>
          <div class="content">
            <p>Dear ${appointment.patient_name},</p>
            <p>Your appointment has been successfully scheduled!</p>
            
            <div class="appointment-details">
              <div class="detail-row">
                <span class="label">Date & Time:</span> ${dateTime}
              </div>
              <div class="detail-row">
                <span class="label">Type:</span> ${appointment.appointment_type || 'Mental Health Consultation'}
              </div>
              <div class="detail-row">
                <span class="label">Duration:</span> ${appointment.duration_minutes || 50} minutes
              </div>
              <div class="detail-row">
                <span class="label">Provider:</span> ${appointment.provider || 'DocLittle Mental Health Team'}
              </div>
              ${appointment.calendar_link ? `
              <div class="detail-row">
                <a href="${appointment.calendar_link}" class="button">📅 Add to Calendar</a>
              </div>
              ` : ''}
            </div>

            <p><strong>Confirmation Number:</strong> ${confirmationNumber}</p>
            ${uploadBlock}
            <p>You will receive a reminder email 1 hour before your appointment.</p>
            
            <p>If you need to reschedule or cancel, please contact us or use the link in your reminder email.</p>
            
            <p>We look forward to seeing you!</p>
            <p>Best regards,<br>DocLittle Mental Health Team</p>
          </div>
          <div class="footer">
            <p>This is an automated confirmation. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: appointment.patient_email,
      subject: `Appointment Confirmed - ${dateTime}`,
      html: html
    });
  }

  /**
   * Send appointment reminder email (1 hour before)
   * @param {Object} [options] - { joinLink } (Phase 5: video/join link for "Join here")
   */
  static async sendAppointmentReminder(appointment, options = {}) {
    const { joinLink } = options;
    const dateTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: appointment.timezone || 'America/New_York'
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
    const cancelLink = `${baseUrl}/api/appointments/${appointment.id}/cancel?token=${this._generateCancelToken(appointment.id)}`;
    const rescheduleLink = `${baseUrl}/api/appointments/${appointment.id}/reschedule?token=${this._generateCancelToken(appointment.id)}`;
    const joinBlock = joinLink
      ? `<p><strong>Join here:</strong> <a href="${joinLink}">${joinLink}</a></p>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f59e0b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .appointment-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #f59e0b; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .button { display: inline-block; padding: 12px 24px; color: white; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
          .button-primary { background: #0891b2; }
          .button-primary:hover { background: #0e7490; }
          .button-danger { background: #dc2626; }
          .button-danger:hover { background: #b91c1c; }
          .button-warning { background: #f59e0b; }
          .button-warning:hover { background: #d97706; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Appointment Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${appointment.patient_name},</p>
            <p><strong>Your appointment is in 1 hour.</strong></p>
            ${joinBlock}
            <div class="appointment-details">
              <div class="detail-row">
                <span class="label">Date & Time:</span> ${dateTime}
              </div>
              <div class="detail-row">
                <span class="label">Type:</span> ${appointment.appointment_type || 'Mental Health Consultation'}
              </div>
              <div class="detail-row">
                <span class="label">Provider:</span> ${appointment.provider || 'DocLittle Mental Health Team'}
              </div>
            </div>

            <p>Need to make changes?</p>
            <p>
              <a href="${rescheduleLink}" class="button button-warning">🔄 Reschedule</a>
              <a href="${cancelLink}" class="button button-danger">❌ Cancel</a>
            </p>
            
            <p>We look forward to seeing you soon!</p>
            <p>Best regards,<br>DocLittle Mental Health Team</p>
          </div>
          <div class="footer">
            <p>Confirmation Number: ${appointment.id}</p>
            <p>This is an automated reminder. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: appointment.patient_email,
      subject: `Appointment Reminder - ${dateTime}`,
      html: html
    });
  }

  /**
   * Send appointment reminder email (24 hours before) - Task 52 / Phase 5 Task 36
   * @param {Object} [options] - { uploadLink } (Phase 5: upload documents link)
   */
  static async sendAppointmentReminder24h(appointment, options = {}) {
    const { uploadLink } = options;
    const dateTime = new Date(appointment.start_time).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: appointment.timezone || 'America/New_York'
    });

    const uploadBlock = uploadLink
      ? `<p>Upload documents before your visit: <a href="${uploadLink}">${uploadLink}</a></p>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .appointment-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #0891b2; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Appointment Tomorrow</h1>
          </div>
          <div class="content">
            <p>Dear ${appointment.patient_name},</p>
            <p><strong>Reminder: Your appointment is tomorrow at ${dateTime}</strong></p>
            ${uploadBlock}
            <div class="appointment-details">
              <div class="detail-row"><span class="label">Type:</span> ${appointment.appointment_type || 'Mental Health Consultation'}</div>
              <div class="detail-row"><span class="label">Provider:</span> ${appointment.provider || 'DocLittle Mental Health Team'}</div>
            </div>
            <p>You will receive another reminder 1 hour before your appointment.</p>
            <p>Best regards,<br>DocLittle Mental Health Team</p>
          </div>
          <div class="footer">
            <p>Confirmation: ${appointment.id}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: appointment.patient_email,
      subject: `Appointment Tomorrow - ${dateTime}`,
      html: html
    });
  }

  /**
   * Send checkout verification code to email
   */
  static async sendCheckoutVerificationCode(email, code) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0891b2; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .code-box { background: white; padding: 20px; margin: 20px 0; text-align: center; border-radius: 8px; border: 2px dashed #0891b2; }
          .code { font-size: 32px; font-weight: bold; color: #0891b2; letter-spacing: 8px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Verification Code</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You requested a payment link. Please use the verification code below to confirm your identity:</p>
            
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this code, please ignore this email.</p>
            
            <p>Best regards,<br>DocLittle Security Team</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Your Verification Code',
      html: html
    });
  }

  /**
   * Send patient portal verification code
   */
  static async sendPatientVerificationCode(email, code) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
          .content { background: #f9f9f9; padding: 30px 20px; border-radius: 0 0 8px 8px; }
          .code-box { background: white; padding: 30px; margin: 20px 0; text-align: center; border-radius: 8px; border: 2px solid #1e40af; }
          .code { font-size: 36px; font-weight: 700; color: #1e40af; letter-spacing: 12px; font-family: 'Courier New', monospace; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          .brand { font-size: 32px; font-weight: 800; letter-spacing: -2px; font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .tagline { margin-top: 6px; font-size: 13px; opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="brand" style="margin-bottom: 10px;">
              Consʌlt
            </div>
            <h1>🔐 Patient Portal Verification</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You requested to sign in to your Consult Patient Portal. Please use the verification code below:</p>
            
            <div class="code-box">
              <div class="code">${code}</div>
            </div>
            
            <p><strong>This code will expire in 10 minutes.</strong></p>
            <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
            
            <p>Best regards,<br>Consult Patient Portal Team</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Consult Patient Portal - Verification Code',
      html: html
    });
  }

  /**
   * Send payment link email after verification (Task 37: include appointment details)
   */
  static async sendPaymentLinkEmail(email, paymentLink, order) {
    const aptDetails = (order?.appointment_date || order?.appointment_type || order?.appointment_time)
      ? `<div><strong>Appointment:</strong> ${order.appointment_type || 'Visit'}${order.appointment_date ? ` - ${order.appointment_date}${order.appointment_time ? ' at ' + order.appointment_time : ''}` : ''}</div>`
      : '';
    const baseUrl = process.env.BASE_URL || process.env.API_BASE_URL || 'https://api.doclittle.site';
    const appointmentsUrl = baseUrl.replace(/\/$/, '') + '/patients/appointments.html';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #16a34a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .order { background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #16a34a; margin-bottom: 16px; }
          .button { display: inline-block; padding: 12px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
          .button:hover { background: #15803d; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💳 Complete Your Payment</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your email has been verified. Please use the secure link below to complete your payment.</p>
            <div class="order">
              <div><strong>Product:</strong> ${order?.product_name || 'Service'}</div>
              ${aptDetails}
              <div><strong>Amount:</strong> $${(order?.amount || 0).toFixed(2)}</div>
            </div>
            <p>
              <a class="button" href="${paymentLink}">Pay Now</a>
            </p>
            <p>If the button doesn't work, copy and paste this URL into your browser:</p>
            <p>${paymentLink}</p>
            <p style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e2e8f0;">
              <strong>Next steps:</strong> After payment, you can view your appointment at
              <a href="${appointmentsUrl}" style="color: #16a34a;">My Appointments</a>.
            </p>
            <p>Thank you for choosing DocLittle.</p>
          </div>
          <div class="footer">
            <p>This is a secure payment link. Do not share it with anyone.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Complete Your Payment',
      html: html
    });
  }

  /**
   * Send post-payment receipt email (Task 12, 38: include appointment details)
   * @param {Object} checkout - Voice checkout record
   * @param {number} amount - Amount charged
   * @param {string} paymentRef - Payment intent ID or transfer ID
   * @param {Object} appointment - Optional { date, time, appointment_type }
   */
  static async sendPaymentReceipt(checkout, amount, paymentRef, appointment) {
    const name = checkout.customer_name || 'Patient';
    const product = checkout.product_name || 'Appointment';
    const aptLine = (appointment?.date || appointment?.appointment_type)
      ? `<div class="detail-row"><span class="label">Appointment:</span> ${appointment.appointment_type || product}${appointment.date ? ` - ${appointment.date}${appointment.time ? ' at ' + appointment.time : ''}` : ''}</div>`
      : '';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #16a34a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .receipt { background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #16a34a; margin: 16px 0; }
          .detail-row { margin: 8px 0; }
          .label { font-weight: bold; color: #666; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Payment Receipt</h1>
          </div>
          <div class="content">
            <p>Dear ${name},</p>
            <p>Thank you for your payment. Here is your receipt:</p>
            <div class="receipt">
              <div class="detail-row"><span class="label">Product:</span> ${product}</div>
              ${aptLine}
              <div class="detail-row"><span class="label">Amount paid:</span> $${Number(amount || 0).toFixed(2)}</div>
              <div class="detail-row"><span class="label">Order ID:</span> ${checkout.id || 'N/A'}</div>
              <div class="detail-row"><span class="label">Transaction:</span> ${paymentRef || 'N/A'}</div>
            </div>
            <p>If you have any questions, please contact support.</p>
            <p>Best regards,<br>DocLittle Team</p>
          </div>
          <div class="footer">
            <p>This is your payment receipt. Please keep for your records.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    return await this.sendEmail({
      to: checkout.customer_email,
      subject: `Payment Receipt - $${Number(amount || 0).toFixed(2)}`,
      html
    });
  }

  /**
   * Task 45: Send escrow timeout notification to provider
   */
  static async sendEscrowTimeoutNotification(providerEmail, attempt) {
    const claimId = attempt.claim_id || 'N/A';
    const amount = attempt.provider_amount ?? attempt.total_approved ?? 0;
    const html = `
      <!DOCTYPE html>
      <html>
      <head><style>body{font-family:Arial,sans-serif;line-height:1.6}.container{max-width:600px;margin:0 auto;padding:20px}.header{background:#dc2626;color:white;padding:20px;text-align:center}.content{background:#f9f9f9;padding:20px}</style></head>
      <body>
        <div class="container">
          <div class="header"><h1>⚠️ Escrow Timeout</h1></div>
          <div class="content">
            <p>An escrow settlement has exceeded the timeout threshold and requires attention.</p>
            <p><strong>Claim ID:</strong> ${claimId}<br><strong>Provider amount:</strong> $${Number(amount).toFixed(2)}</p>
            <p>Please review and retry settlement via the admin recovery endpoint if needed.</p>
            <p>DocLittle Finance Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
    return await this.sendEmail({ to: providerEmail, subject: 'Escrow Timeout – Action Required', html });
  }

  /**
   * Send insurance billing email
   */
  static async sendInsuranceBillingEmail(insurerEmail, claimData) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1e40af; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .claim-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #1e40af; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 Insurance Claim Submitted</h1>
          </div>
          <div class="content">
            <p>Dear Insurance Provider,</p>
            <p>A new insurance claim has been submitted for processing:</p>
            
            <div class="claim-details">
              <div class="detail-row">
                <span class="label">Claim ID:</span> ${claimData.claimId || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">X12 Claim ID:</span> ${claimData.x12ClaimId || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Member ID:</span> ${claimData.memberId || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Patient Name:</span> ${claimData.patientName || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Service Code:</span> ${claimData.serviceCode || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Total Amount:</span> $${(claimData.totalAmount || 0).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="label">Copay Paid:</span> $${(claimData.copayPaid || 0).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="label">Insurance Amount:</span> $${((claimData.totalAmount || 0) - (claimData.copayPaid || 0)).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="label">Date of Service:</span> ${claimData.dateOfService || 'N/A'}
              </div>
            </div>

            <p>Please process this claim according to your standard procedures.</p>
            
            <p>Best regards,<br>DocLittle Healthcare Platform</p>
          </div>
          <div class="footer">
            <p>This is an automated billing notification. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: insurerEmail,
      subject: `Insurance Claim Submitted - ${claimData.claimId || 'New Claim'}`,
      html: html
    });
  }

  /**
   * Send patient billing email
   */
  static async sendPatientBillingEmail(patientEmail, billingData) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .billing-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #dc2626; }
          .detail-row { margin: 10px 0; }
          .label { font-weight: bold; color: #666; }
          .amount { font-size: 24px; font-weight: bold; color: #dc2626; }
          .button { display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
          .button:hover { background: #b91c1c; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💳 Billing Statement</h1>
          </div>
          <div class="content">
            <p>Dear ${billingData.patientName || 'Patient'},</p>
            <p>You have a balance due for your recent appointment:</p>
            
            <div class="billing-details">
              <div class="detail-row">
                <span class="label">Appointment Date:</span> ${billingData.appointmentDate || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Service:</span> ${billingData.serviceName || 'N/A'}
              </div>
              <div class="detail-row">
                <span class="label">Total Amount:</span> $${(billingData.totalAmount || 0).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="label">Insurance Coverage:</span> $${(billingData.insuranceAmount || 0).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="label">Copay:</span> $${(billingData.copayAmount || 0).toFixed(2)}
              </div>
              <div class="detail-row">
                <span class="amount">Amount Due: $${(billingData.amountDue || 0).toFixed(2)}</span>
              </div>
            </div>

            <p>Please pay your balance at your earliest convenience.</p>
            
            ${billingData.paymentLink ? `
            <p>
              <a class="button" href="${billingData.paymentLink}">Pay Now</a>
            </p>
            ` : ''}
            
            <p>If you have any questions about this bill, please contact us.</p>
            
            <p>Best regards,<br>DocLittle Billing Department</p>
          </div>
          <div class="footer">
            <p>This is an automated billing statement. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: patientEmail,
      subject: `Billing Statement - $${(billingData.amountDue || 0).toFixed(2)} Due`,
      html: html
    });
  }

  /**
   * Generate cancel/reschedule token
   */
  static _generateCancelToken(appointmentId) {
    const crypto = require('crypto');
    const secret = process.env.APPOINTMENT_SECRET || 'default-secret-change-in-production';
    return crypto.createHmac('sha256', secret).update(appointmentId).digest('hex');
  }

  /**
   * Verify cancel/reschedule token
   */
  static verifyCancelToken(appointmentId, token) {
    const crypto = require('crypto');
    const expectedToken = this._generateCancelToken(appointmentId);
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
  }

  /**
   * Send email verification code
   */
  static async sendVerificationCode(email, code, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', sans-serif; 
            line-height: 1.6; 
            color: #1e293b; 
            margin: 0; 
            padding: 0; 
            background-color: #f8fafc;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .email-wrapper {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
          }
          .logo-brand {
            font-size: 48px;
            font-weight: 300;
            line-height: 1;
            margin-bottom: 15px;
            letter-spacing: -2px;
          }
          .logo-brand .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo-brand .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .logo-brand .dot {
            font-weight: 700;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            margin-top: 10px;
          }
          .header p {
            margin: 5px 0 0 0;
            font-size: 16px;
            opacity: 0.95;
          }
          .content { 
            background: white; 
            padding: 40px 30px; 
          }
          .content h2 {
            color: #1e293b;
            font-size: 20px;
            margin: 0 0 15px 0;
            font-weight: 600;
          }
          .content p {
            color: #64748b;
            font-size: 16px;
            margin: 15px 0;
            line-height: 1.6;
          }
          .code-box {
            background: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
          }
          .code { 
            color: #1e40af; 
            font-size: 36px; 
            font-weight: 700; 
            letter-spacing: 12px; 
            font-family: 'Courier New', monospace;
            margin: 0;
            display: inline-block;
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
            color: #64748b; 
            font-size: 14px; 
          }
          .footer a {
            color: #1e40af;
            text-decoration: none;
          }
          .footer a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <div class="logo-brand">
                <span class="doc">Doc</span><span class="little">Little</span><span class="dot">.</span>
              </div>
              <p>Verify Your Email</p>
            </div>
            <div class="content">
              <h2>Hi ${name || 'there'},</h2>
              <p>Thank you for signing up for DocLittle API! Please use the verification code below to verify your email address:</p>
              
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              
              <p><strong>This code will expire in 15 minutes.</strong></p>
              
              <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
              
              <div class="footer">
                <p>This is an automated message from DocLittle API.</p>
                <p>Visit us at <a href="https://api.doclittle.site">api.doclittle.site</a></p>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Please do not reply to this email.</p>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'DocLittle API - Verify Your Email',
      html: html
    });
  }

  /**
   * Send promotional email to customers
   * @param {string} email - Recipient email
   * @param {string} customerName - Customer name
   * @param {object} promotion - Promotion details
   * @param {string} promotion.name - Promotion name
   * @param {string} promotion.discount_type - "percentage" or "fixed_amount"
   * @param {number} promotion.discount_value - Discount value
   * @param {string} promotion.code - Promotion code (optional)
   * @param {string} promotion.description - Promotion description
   * @param {string} promotion.end_date - End date (optional)
   * @param {string} merchantName - Merchant/business name
   */
  static async sendPromotionalEmail(email, customerName, promotion, merchantName = 'DocLittle') {
    const discountText = promotion.discount_type === 'percentage'
      ? `${promotion.discount_value}% OFF`
      : `$${promotion.discount_value} OFF`;

    const endDateText = promotion.end_date
      ? new Date(promotion.end_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : null;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0; 
            padding: 0; 
            background-color: #f8fafc;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .email-wrapper {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #f59e0b 0%, #fb923c 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
          }
          .logo-brand {
            font-size: 48px;
            font-weight: 300;
            line-height: 1;
            margin-bottom: 15px;
            letter-spacing: -2px;
          }
          .logo-brand .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo-brand .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .header h1 {
            margin: 15px 0 5px 0;
            font-size: 28px;
            font-weight: 700;
          }
          .header .subtitle {
            margin: 0;
            opacity: 0.95;
            font-size: 16px;
          }
          .content { 
            background: #f9f9f9; 
            padding: 40px 30px; 
          }
          .promotion-box {
            background: white;
            border-radius: 8px;
            padding: 30px;
            margin: 25px 0;
            border-left: 4px solid #f59e0b;
            text-align: center;
          }
          .discount-badge {
            display: inline-block;
            background: linear-gradient(135deg, #f59e0b 0%, #fb923c 100%);
            color: white;
            font-size: 48px;
            font-weight: 700;
            padding: 20px 40px;
            border-radius: 12px;
            margin: 20px 0;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
          }
          .promotion-name {
            font-size: 24px;
            font-weight: 700;
            color: #1e293b;
            margin: 20px 0 10px 0;
          }
          .promotion-description {
            color: #64748b;
            font-size: 16px;
            line-height: 1.6;
            margin: 15px 0;
          }
          .promotion-code {
            background: #f8fafc;
            border: 2px dashed #f59e0b;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            display: inline-block;
          }
          .promotion-code-label {
            color: #64748b;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 5px;
          }
          .promotion-code-value {
            color: #1e293b;
            font-size: 24px;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            letter-spacing: 2px;
          }
          .promotion-details {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            border-left: 4px solid #f59e0b;
          }
          .detail-row {
            margin: 12px 0;
            display: flex;
            justify-content: space-between;
          }
          .detail-label {
            font-weight: 600;
            color: #666;
          }
          .detail-value {
            color: #1e293b;
            font-weight: 500;
          }
          .button { 
            display: inline-block; 
            padding: 14px 32px; 
            background: #f59e0b; 
            color: white; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 20px 0;
            font-weight: 600;
            font-size: 16px;
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
          }
          .button:hover { 
            background: #d97706; 
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
            color: #64748b; 
            font-size: 14px; 
          }
          .footer a {
            color: #1e40af;
            text-decoration: none;
          }
          .footer a:hover {
            text-decoration: underline;
          }
          .urgency-text {
            color: #dc2626;
            font-weight: 600;
            font-size: 14px;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <div class="logo-brand">
                <span class="doc">Doc</span><span class="little">Little</span>
              </div>
              <h1>🎉 Special Promotion!</h1>
              <p class="subtitle">${merchantName}</p>
            </div>
            <div class="content">
              <p>Hi ${customerName || 'there'},</p>
              <p>We have an exciting promotion just for you!</p>
              
              <div class="promotion-box">
                <div class="discount-badge">${discountText}</div>
                <div class="promotion-name">${promotion.name || 'Special Offer'}</div>
                ${promotion.description ? `
                <div class="promotion-description">${promotion.description}</div>
                ` : ''}
                ${promotion.code ? `
                <div class="promotion-code">
                  <div class="promotion-code-label">Use Code</div>
                  <div class="promotion-code-value">${promotion.code}</div>
                </div>
                ` : ''}
              </div>

              ${promotion.end_date ? `
              <div class="promotion-details">
                <div class="detail-row">
                  <span class="detail-label">Valid Until:</span>
                  <span class="detail-value">${endDateText}</span>
                </div>
              </div>
              <div class="urgency-text">⏰ Don't miss out! This offer expires soon.</div>
              ` : ''}

              <p style="text-align: center; margin: 30px 0;">
                <a href="${process.env.BASE_URL || 'https://api.doclittle.site'}/storefront" class="button">Shop Now</a>
              </p>

              <p>Call us or visit our store to take advantage of this special offer!</p>
              
              <p>Thank you for being a valued customer!</p>
              <p>Best regards,<br>${merchantName} Team</p>
              
              <div class="footer">
                <p>This is a promotional email from ${merchantName}.</p>
                <p>Visit us at <a href="${process.env.BASE_URL || 'https://api.doclittle.site'}">${process.env.BASE_URL || 'api.doclittle.site'}</a></p>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">You're receiving this because you're a customer. <a href="#" style="color: #94a3b8;">Unsubscribe</a></p>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: `🎉 ${discountText} - ${promotion.name || 'Special Promotion'} - ${merchantName}`,
      html: html
    });
  }

  /**
   * Send monthly invoice email to customer
   */
  static async sendInvoiceEmail(email, name, invoice) {
    const dueDate = new Date(invoice.due_date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const billingMonth = new Date(invoice.billing_month + '-01').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', sans-serif;
            line-height: 1.6;
            color: #1e293b;
            background: #f1f5f9;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .email-wrapper {
            padding: 0;
          }
          .header {
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
          }
          .logo-brand {
            font-size: 48px;
            font-weight: 300;
            line-height: 1;
            margin-bottom: 15px;
            letter-spacing: -2px;
          }
          .logo-brand .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo-brand .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .logo-brand .dot {
            font-weight: 700;
          }
          .header h1 {
            margin: 15px 0 5px 0;
            font-size: 24px;
            font-weight: 600;
          }
          .header p {
            margin: 0;
            opacity: 0.9;
            font-size: 14px;
          }
          .content {
            padding: 30px;
          }
          .content h2 {
            color: #1e293b;
            margin: 0 0 15px 0;
            font-size: 20px;
          }
          .content p {
            color: #64748b;
            margin: 0 0 20px 0;
            line-height: 1.6;
          }
          .invoice-summary {
            background: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .invoice-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .invoice-row:last-child {
            border-bottom: none;
          }
          .invoice-label {
            color: #64748b;
            font-weight: 500;
          }
          .invoice-value {
            color: #1e293b;
            font-weight: 600;
          }
          .invoice-total {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 2px solid #1e40af;
          }
          .invoice-total .invoice-label {
            font-size: 18px;
            color: #1e293b;
          }
          .invoice-total .invoice-value {
            font-size: 24px;
            color: #1e40af;
          }
          .invoice-details {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 14px;
          }
          .button {
            display: inline-block;
            background: #1e40af;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin: 20px 0;
            font-weight: 600;
          }
          .button:hover {
            background: #1d4ed8;
          }
          .footer {
            background: #f8fafc;
            padding: 30px;
            text-align: center;
            border-top: 1px solid #e2e8f0;
            color: #64748b;
            font-size: 14px;
          }
          .footer a {
            color: #1e40af;
            text-decoration: none;
          }
          .footer a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <div class="logo-brand">
                <span class="doc">Doc</span><span class="little">Little</span><span class="dot">.</span>
              </div>
              <h1>Monthly Invoice</h1>
              <p>Invoice #${invoice.invoice_number}</p>
            </div>
            <div class="content">
              <h2>Hi ${name || 'there'},</h2>
              <p>Your monthly invoice for <strong>${billingMonth}</strong> is ready for review.</p>
              
              <div class="invoice-summary">
                <div class="invoice-row">
                  <span class="invoice-label">Billing Period:</span>
                  <span class="invoice-value">${billingMonth}</span>
                </div>
                <div class="invoice-row">
                  <span class="invoice-label">Invoice Number:</span>
                  <span class="invoice-value">${invoice.invoice_number}</span>
                </div>
                <div class="invoice-row">
                  <span class="invoice-label">Due Date:</span>
                  <span class="invoice-value">${dueDate}</span>
                </div>
                ${invoice.voice_minutes > 0 ? `
                <div class="invoice-row">
                  <span class="invoice-label">Voice Minutes:</span>
                  <span class="invoice-value">${invoice.voice_minutes.toLocaleString()} min</span>
                </div>
                <div class="invoice-row">
                  <span class="invoice-label">Voice Minutes Cost:</span>
                  <span class="invoice-value">$${invoice.voice_minutes_cost.toFixed(2)}</span>
                </div>
                ` : ''}
                ${invoice.api_requests > 0 ? `
                <div class="invoice-row">
                  <span class="invoice-label">API Requests:</span>
                  <span class="invoice-value">${invoice.api_requests.toLocaleString()}</span>
                </div>
                <div class="invoice-row">
                  <span class="invoice-label">API Requests Cost:</span>
                  <span class="invoice-value">$${invoice.api_requests_cost.toFixed(2)}</span>
                </div>
                ` : ''}
                <div class="invoice-row invoice-total">
                  <span class="invoice-label">Total Amount Due:</span>
                  <span class="invoice-value">$${invoice.total.toFixed(2)}</span>
                </div>
              </div>
              
              <p>Payment is due within 15 days of the invoice date. Your stored payment method will be automatically charged on the due date.</p>
              
              <p>You can view your invoices and credits at any time in your account dashboard.</p>
              
              <div style="text-align: center;">
                <a href="https://api.doclittle.site/docs" class="button">View Dashboard</a>
              </div>
              
              <p>If you have any questions about this invoice, please contact our support team at support@doclittle.site.</p>
              
              <div class="footer">
                <p>This is an automated invoice from DocLittle API.</p>
                <p>Visit us at <a href="https://api.doclittle.site">api.doclittle.site</a></p>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Please do not reply to this email. For support, contact support@doclittle.site</p>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: `DocLittle API Invoice - $${invoice.total.toFixed(2)} Due (${invoice.invoice_number})`,
      html: html
    });
  }

  /**
   * Send welcome email with subdomain and password
   */
  static async sendWelcomeEmail(customerEmail, customerName, subdomain, customerType, merchantId, password = null) {
    const baseDomain = process.env.BASE_DOMAIN || 'doclittle.site';
    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production'
      ? `https://${baseDomain}`
      : 'http://localhost:4000');

    // Determine login URL based on subdomain
    const loginUrl = subdomain
      ? `https://${subdomain}.${baseDomain}/login`
      : `${baseUrl}/login`;

    const accountType = customerType === 'saas' ? 'SaaS Platform' : 'API Integration';
    const dashboardType = customerType === 'saas' ? 'business dashboard' : 'API documentation';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', sans-serif; 
            line-height: 1.6; 
            color: #1e293b; 
            margin: 0; 
            padding: 0; 
            background-color: #f8fafc;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
            width: 100%;
            box-sizing: border-box;
          }
          @media (max-width: 600px) {
            .container {
              padding: 10px;
            }
          }
          .email-wrapper {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
          }
          .logo-brand {
            font-size: 48px;
            font-weight: 300;
            line-height: 1;
            margin-bottom: 15px;
            letter-spacing: -2px;
          }
          .logo-brand .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo-brand .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            margin-top: 10px;
          }
          .content { 
            background: white; 
            padding: 40px 30px; 
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          .content h2 {
            color: #1e293b;
            font-size: 20px;
            margin: 0 0 15px 0;
            font-weight: 600;
          }
          .content p {
            color: #64748b;
            font-size: 16px;
            margin: 15px 0;
            line-height: 1.6;
          }
          .info-box {
            background: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          .info-row {
            display: flex;
            flex-direction: column;
            padding: 12px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #64748b;
            font-weight: 500;
            font-size: 14px;
            margin-bottom: 6px;
          }
          .info-value {
            color: #1e293b;
            font-weight: 600;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            word-break: break-all;
            overflow-wrap: break-word;
            line-height: 1.5;
          }
          @media (max-width: 600px) {
            .content {
              padding: 25px 20px;
            }
            .header {
              padding: 30px 20px;
            }
            .logo-brand {
              font-size: 36px;
            }
            .header h1 {
              font-size: 20px;
            }
            .content h2 {
              font-size: 18px;
            }
            .content p {
              font-size: 15px;
            }
            .info-box {
              padding: 15px;
            }
          }
          @media (min-width: 480px) {
            .info-row {
              flex-direction: row;
              justify-content: space-between;
              align-items: flex-start;
            }
            .info-label {
              margin-bottom: 0;
              margin-right: 15px;
              flex-shrink: 0;
            }
            .info-value {
              text-align: right;
              flex: 1;
            }
          }
          .button { 
            display: inline-block; 
            background: #1e40af; 
            color: white; 
            padding: 14px 28px; 
            text-decoration: none; 
            border-radius: 6px; 
            margin: 20px 0;
            font-weight: 600;
            font-size: 16px;
          }
          .button:hover {
            background: #1d4ed8;
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
            color: #64748b; 
            font-size: 14px; 
          }
          .footer a {
            color: #1e40af;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <div class="logo-brand">
                <span class="doc">Doc</span><span class="little">Little</span>.
              </div>
              <h1>Welcome to DocLittle!</h1>
            </div>
            <div class="content">
              <h2>Hi ${customerName || 'there'},</h2>
              <p>Thank you for signing up for DocLittle! Your account has been successfully created and is ready to use.</p>
              
              <div class="info-box">
                <div class="info-row">
                  <span class="info-label">Account Type:</span>
                  <span class="info-value">${accountType}</span>
                </div>
                ${subdomain ? `
                <div class="info-row">
                  <span class="info-label">Your Dashboard URL:</span>
                  <span class="info-value">${subdomain}.${baseDomain}</span>
                </div>
                ` : ''}
                <div class="info-row">
                  <span class="info-label">Email:</span>
                  <span class="info-value">${customerEmail}</span>
                </div>
                ${password ? `
                <div class="info-row" style="border-top: 2px solid #1e40af; margin-top: 10px; padding-top: 10px;">
                  <span class="info-label" style="color: #1e40af; font-weight: 700;">Password:</span>
                  <span class="info-value" style="color: #1e40af; font-weight: 700; font-size: 18px;">${password}</span>
                </div>
                ` : ''}
              </div>
              
              <p><strong>Getting Started:</strong></p>
              <p>To access your ${dashboardType}, please log in using your email and the password provided above.</p>
              
              ${password ? `
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 6px;">
                <p style="margin: 0; color: #92400e; font-weight: 600;">🔐 Important: Save this password securely. You can change it later in your account settings.</p>
              </div>
              ` : ''}
              
              <div style="text-align: center;">
                <a href="${loginUrl}" class="button">Log In to Dashboard</a>
              </div>
              
              ${subdomain ? `
              <p><strong>Your Unique Domain:</strong></p>
              <p>You can access your dashboard directly at:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="https://${subdomain}.${baseDomain}" style="color: #1e40af; font-weight: 600; font-size: 18px;">https://${subdomain}.${baseDomain}</a>
              </div>
              ` : ''}
              
              <p>If you have any questions or need help getting started, please don't hesitate to contact our support team.</p>
              
              <p>Best regards,<br>The DocLittle Team</p>
              
              <div class="footer">
                <p>This is an automated welcome email from DocLittle.</p>
                <p>Visit us at <a href="https://doclittle.site">doclittle.site</a></p>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Please do not reply to this email.</p>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: customerEmail,
      subject: `Welcome to DocLittle - Your Account is Ready!`,
      html: html
    });
  }

  /**
   * Send password reset email
   */
  static async sendPasswordResetEmail(email, name, resetUrl) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', sans-serif; 
            line-height: 1.6; 
            color: #1e293b; 
            margin: 0; 
            padding: 0; 
            background-color: #f8fafc;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .email-wrapper {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
          }
          .logo-brand {
            font-size: 48px;
            font-weight: 300;
            line-height: 1;
            margin-bottom: 15px;
            letter-spacing: -2px;
          }
          .logo-brand .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo-brand .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            margin-top: 10px;
          }
          .content { 
            background: white; 
            padding: 40px 30px; 
          }
          .content h2 {
            color: #1e293b;
            font-size: 20px;
            margin: 0 0 15px 0;
            font-weight: 600;
          }
          .content p {
            color: #64748b;
            font-size: 16px;
            margin: 15px 0;
            line-height: 1.6;
          }
          .button { 
            display: inline-block; 
            background: #1e40af; 
            color: white; 
            padding: 14px 28px; 
            text-decoration: none; 
            border-radius: 6px; 
            margin: 20px 0;
            font-weight: 600;
            font-size: 16px;
          }
          .button:hover {
            background: #1d4ed8;
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
            color: #64748b; 
            font-size: 14px; 
          }
          .footer a {
            color: #1e40af;
            text-decoration: none;
          }
          .warning-box {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          .warning-box p {
            margin: 0;
            color: #92400e;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <div class="logo-brand">
                <span class="doc">Doc</span><span class="little">Little</span>.
              </div>
              <h1>Reset Your Password</h1>
            </div>
            <div class="content">
              <h2>Hi ${name || 'there'},</h2>
              <p>You requested to reset your password. Click the button below to create a new password:</p>
              
              <div style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </div>
              
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #1e40af; font-family: monospace; font-size: 14px;">${resetUrl}</p>
              
              <div class="warning-box">
                <p><strong>⚠️ This link will expire in 1 hour.</strong> If you didn't request a password reset, please ignore this email.</p>
              </div>
              
              <p>If you have any questions, please contact our support team.</p>
              
              <p>Best regards,<br>The DocLittle Team</p>
              
              <div class="footer">
                <p>This is an automated email from DocLittle.</p>
                <p>Visit us at <a href="https://doclittle.site">doclittle.site</a></p>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Please do not reply to this email.</p>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'DocLittle - Reset Your Password',
      html: html
    });
  }

  /**
   * Send feature request notification to admin
   */
  static async sendFeatureRequestNotification(customerEmail, customerName, requestedFeatures, companyName) {
    const featureNames = {
      'voice_agent': 'Voice AI Agent',
      'healthcare_commerce': 'Healthcare Commerce',
      'fhir_integration': 'FHIR Integration',
      'payment_processing': 'Payment Processing',
      'appointment_management': 'Appointment Management',
      'ehr_integration': 'EHR Integration'
    };

    const featuresList = requestedFeatures.map(f => `• ${featureNames[f] || f}`).join('<br>');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, 'Helvetica Neue', sans-serif; 
            line-height: 1.6; 
            color: #1e293b;
            background: #f8fafc;
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            overflow: hidden;
          }
          .header {
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
            color: white;
            padding: 30px;
            text-align: center;
          }
          .logo {
            font-size: 28px;
            font-weight: 300;
            margin-bottom: 10px;
          }
          .logo .doc {
            font-family: 'Times New Roman', Times, serif;
            font-style: italic;
            font-weight: 400;
          }
          .logo .little {
            font-family: 'Verdana', Geneva, sans-serif;
            font-weight: 700;
          }
          .content {
            padding: 30px;
          }
          .alert-box {
            background: #eff6ff;
            border-left: 4px solid #2563eb;
            padding: 16px;
            border-radius: 6px;
            margin: 20px 0;
          }
          .features-list {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            font-size: 15px;
            line-height: 1.8;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #f1f5f9;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #64748b;
            font-weight: 500;
          }
          .info-value {
            color: #1e293b;
            font-weight: 600;
          }
          .button {
            display: inline-block;
            background: #2563eb;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            margin-top: 20px;
          }
          .footer {
            background: #f8fafc;
            padding: 20px;
            text-align: center;
            color: #64748b;
            font-size: 0.9rem;
            border-top: 1px solid #e2e8f0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">
              <span class="doc">Doc</span><span class="little">Little</span>.
            </div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 400;">New Feature Request</h2>
          </div>
          
          <div class="content">
            <div class="alert-box">
              <strong>📋 New Feature Request Received</strong>
            </div>
            
            <p>A customer has requested access to new API features:</p>
            
            <div class="features-list">
              ${featuresList}
            </div>
            
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="margin: 0 0 16px 0; font-size: 16px; color: #1e293b;">Customer Information</h3>
              <div class="info-row">
                <span class="info-label">Customer Name:</span>
                <span class="info-value">${customerName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email:</span>
                <span class="info-value">${customerEmail}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Company:</span>
                <span class="info-value">${companyName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Requested Features:</span>
                <span class="info-value">${requestedFeatures.length}</span>
              </div>
            </div>
            
            <p style="margin-top: 24px;">
              <a href="https://doclittle.site/admin" class="button">View in Admin Portal</a>
            </p>
            
            <p style="color: #64748b; font-size: 0.9rem; margin-top: 24px;">
              Please review and approve or reject these feature requests in the admin portal.
            </p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">This is an automated notification from DocLittle API</p>
            <p style="margin: 8px 0 0 0; font-size: 0.85rem;">
              <a href="https://api.doclittle.site" style="color: #2563eb;">API Documentation</a> | 
              <a href="https://doclittle.site" style="color: #2563eb;">Website</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const adminEmail = process.env.ADMIN_EMAIL || 'richard@doclittle.site';

    return await this.sendEmail({
      to: adminEmail,
      subject: `New Feature Request from ${customerName} - ${requestedFeatures.length} feature(s)`,
      html: html
    });
  }

  /**
   * Send low credit alert email
   */
  static async sendLowCreditAlert(customerEmail, customerName, creditBalance, subdomain = null) {
    const baseDomain = process.env.BASE_DOMAIN || 'doclittle.site';
    const dashboardUrl = subdomain
      ? `https://${subdomain}.${baseDomain}/billing`
      : `${process.env.BASE_URL || 'https://api.doclittle.site'}/billing`;

    const isCritical = creditBalance < 25;
    const alertLevel = isCritical ? 'Critical' : 'Low';
    const alertColor = isCritical ? '#dc2626' : '#f59e0b';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
            line-height: 1.6; 
            color: #1e293b; 
            margin: 0; 
            padding: 0; 
            background-color: #f8fafc;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px; 
          }
          .email-wrapper {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header { 
            background: linear-gradient(135deg, ${alertColor} 0%, ${isCritical ? '#991b1b' : '#d97706'} 100%); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
          }
          .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
          .content { padding: 40px 30px; }
          .alert-box {
            background: ${isCritical ? '#fef2f2' : '#fffbeb'};
            border-left: 4px solid ${alertColor};
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
          }
          .credit-display {
            font-size: 48px;
            font-weight: 900;
            color: ${alertColor};
            text-align: center;
            margin: 20px 0;
          }
          .button { 
            display: inline-block; 
            padding: 16px 32px; 
            background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); 
            color: white; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 20px 0;
            font-weight: 600;
            text-align: center;
          }
          .button:hover { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            color: #64748b; 
            font-size: 14px; 
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="email-wrapper">
            <div class="header">
              <h1>⚠️ ${alertLevel} Credit Alert</h1>
            </div>
            <div class="content">
              <p>Hi ${customerName},</p>
              
              <div class="alert-box">
                <p style="margin: 0; font-weight: 600; color: ${alertColor};">
                  ${isCritical
        ? 'Your credits are running critically low!'
        : 'Your credits are running low.'}
                </p>
              </div>

              <div class="credit-display">
                ${creditBalance} min
              </div>
              
              <p style="text-align: center; color: #64748b; margin-bottom: 30px;">
                ${isCritical
        ? 'You have less than 25 minutes remaining. Add credits now to avoid service interruption.'
        : 'You have less than 50 minutes remaining. Consider adding credits to continue uninterrupted service.'}
              </p>

              <div style="text-align: center;">
                <a href="${dashboardUrl}" class="button">Buy More Credits →</a>
              </div>

              <p style="margin-top: 30px; color: #64748b; font-size: 14px;">
                <strong>What happens when credits run out?</strong><br>
                If your credits reach zero and you don't have a payment method on file, 
                your AI assistant will pause until you add credits or a payment method.
              </p>

              <p style="margin-top: 20px; color: #64748b; font-size: 14px;">
                <strong>Need help?</strong><br>
                Contact us at <a href="mailto:support@doclittle.site" style="color: #1e40af;">support@doclittle.site</a> 
                or visit your dashboard to manage your account.
              </p>
            </div>
            <div class="footer">
              <p>This is an automated alert from DocLittle.</p>
              <p style="margin-top: 10px;">
                <a href="${dashboardUrl}" style="color: #1e40af; text-decoration: none;">Manage Credits</a> | 
                <a href="https://doclittle.site" style="color: #1e40af; text-decoration: none;">Visit Website</a>
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: customerEmail,
      subject: `⚠️ ${alertLevel} Credit Alert: ${creditBalance} minutes remaining`,
      html: html
    });
  }

  // ============================================
  // Patient portal notifications (mvp-47, mvp-48)
  // ============================================
  static async sendAppointmentRescheduled(appointment, details = {}) {
    if (!appointment || !appointment.patient_email) return { success: false, error: 'Missing patient email' };
    const prev = details.previous_datetime || details.previous || '';
    const next = details.new_datetime || details.next || '';
    const subject = 'Consult Patient Portal — Appointment Rescheduled';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-1px;">Consʌlt</div>
        <div style="color:#6b7280;margin-top:4px;">Home Care Works</div>
        <h2 style="margin-top:18px;">Your appointment was rescheduled</h2>
        <p style="color:#374151;">Previous: <strong>${prev || '—'}</strong><br/>New: <strong>${next || '—'}</strong></p>
        <p style="color:#374151;">You can review or manage your visit in your portal.</p>
      </div>
    `;
    return this.sendEmail({ to: appointment.patient_email, subject, html });
  }

  static async sendAppointmentCanceled(appointment) {
    if (!appointment || !appointment.patient_email) return { success: false, error: 'Missing patient email' };
    const subject = 'Consult Patient Portal — Appointment Canceled';
    const dt = (appointment.start_time ? new Date(appointment.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: appointment.timezone || 'America/New_York' }) : `${appointment.date || ''} ${appointment.time || ''}`);
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-1px;">Consʌlt</div>
        <div style="color:#6b7280;margin-top:4px;">Home Care Works</div>
        <h2 style="margin-top:18px;">Your appointment was canceled</h2>
        <p style="color:#374151;">Canceled visit time: <strong>${dt}</strong></p>
        <p style="color:#374151;">If this was a mistake, please schedule a new visit or contact your clinic.</p>
      </div>
    `;
    return this.sendEmail({ to: appointment.patient_email, subject, html });
  }

  static async sendPostVisitSummaryReady(appointment) {
    if (!appointment || !appointment.patient_email) return { success: false, error: 'Missing patient email' };
    const subject = 'Consult Patient Portal — Your Visit Summary Is Ready';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-1px;">Consʌlt</div>
        <div style="color:#6b7280;margin-top:4px;">Home Care Works</div>
        <h2 style="margin-top:18px;">Your visit summary is ready</h2>
        <p style="color:#374151;">You can view your records and documents in the patient portal.</p>
      </div>
    `;
    return this.sendEmail({ to: appointment.patient_email, subject, html });
  }
}

module.exports = EmailService;

