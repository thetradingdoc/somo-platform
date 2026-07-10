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
const { validatePhiSafeMessage } = require('../utils/phi-safe-messaging');

let azureEmailClient;
try {
  const { EmailClient } = require('@azure/communication-email');
  azureEmailClient = EmailClient;
} catch (e) {
  // Azure SDK not installed - will use SMTP if configured
  azureEmailClient = null;
}

const SomoEmail = require('../lib/somo-email-layout');

class EmailService {
  /** @private Somo-branded HTML wrapper — see lib/somo-email-layout.js */
  static _somoLayout(title, subtitle, bodyHtml, opts = {}) {
    return SomoEmail.layout({ title, subtitle, bodyHtml, ...opts });
  }
  /**
   * Resolved email provider: smtp | azure | auto (azure-first legacy)
   */
  static getEmailProviderMode() {
    const mode = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase().trim();
    if (mode === 'smtp' || mode === 'azure') return mode;
    return 'auto';
  }

  static getEmailHealth() {
    const mode = this.getEmailProviderMode();
    const azureConfigured = this.isAzureConfigured();
    const smtpConfigured = !!this.getTransporter();
    const from =
      process.env.SMTP_FROM ||
      process.env.SMTP_USER ||
      process.env.AZURE_EMAIL_SENDER ||
      'richard@callsomo.com';

    let provider_configured = 'none';
    if (mode === 'smtp' && smtpConfigured) provider_configured = 'smtp';
    else if (mode === 'azure' && azureConfigured) provider_configured = 'azure';
    else if (mode === 'auto') {
      if (azureConfigured) provider_configured = 'azure';
      else if (smtpConfigured) provider_configured = 'smtp';
    } else if (smtpConfigured) provider_configured = 'smtp';
    else if (azureConfigured) provider_configured = 'azure';

    return {
      provider_mode: mode,
      provider_configured,
      azure_configured: azureConfigured,
      smtp_configured: smtpConfigured,
      from_address: from,
      smtp_host: process.env.SMTP_HOST || null,
      smtp_user: process.env.SMTP_USER || null
    };
  }

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
    const smtpPassword = (process.env.SMTP_PASSWORD || '').trim();
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
  static _ensureRcmE2eEmailOutbox() {
    if (process.env.RCM_E2E_RECORD_EMAIL !== '1') return;
    try {
      const db = require('../database');
      if (!db.db) return;
      db.db.exec(`
        CREATE TABLE IF NOT EXISTS rcm_e2e_email_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient TEXT NOT NULL,
          subject TEXT,
          template TEXT,
          provider TEXT,
          success INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (e) {
      console.warn('[RCM_E2E_RECORD_EMAIL] outbox table:', e.message);
    }
  }

  static _recordRcmE2eEmail({ to, subject, template, provider, success }) {
    if (process.env.RCM_E2E_RECORD_EMAIL !== '1') return;
    try {
      this._ensureRcmE2eEmailOutbox();
      const db = require('../database');
      db.db
        .prepare(
          `INSERT INTO rcm_e2e_email_outbox (recipient, subject, template, provider, success)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          String(to || '').toLowerCase(),
          String(subject || ''),
          String(template || 'generic'),
          String(provider || ''),
          success ? 1 : 0
        );
    } catch (e) {
      console.warn('[RCM_E2E_RECORD_EMAIL] insert failed:', e.message);
    }
  }

  static async sendEmail({ to, subject, html, text, attachments, replyTo }) {
    try {
      const bodyCheck = validatePhiSafeMessage(
        [subject, text, html].filter(Boolean).join('\n')
      );
      if (!bodyCheck.safe) {
        return {
          success: false,
          error: 'Email blocked: message contains potential PHI patterns',
          error_code: 'PHI_SAFE_MESSAGE_BLOCKED',
          violations: bodyCheck.violations
        };
      }

      const mode = this.getEmailProviderMode();
      const tryAzure = mode === 'azure' || mode === 'auto';
      const trySmtp = mode === 'smtp' || mode === 'auto';

      if (tryAzure && this.isAzureConfigured()) {
        const azureResult = await this._sendViaAzure({ to, subject, html, text, attachments });
        if (azureResult && azureResult.success) {
          this._recordRcmE2eEmail({
            to,
            subject,
            template: 'generic',
            provider: 'azure',
            success: true
          });
          return azureResult;
        }
        if (mode === 'azure') {
          return azureResult || { success: false, error: 'Azure email failed', provider: 'azure' };
        }
        console.warn('⚠️  Azure email failed, falling back to SMTP');
      }

      if (trySmtp) {
        const transporter = this.getTransporter();
        const from = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.AZURE_EMAIL_SENDER || 'Somo <richard@callsomo.com>';

        if (transporter) {
          const mailOptions = {
            from: from,
            to: to,
            subject: subject,
            html: html,
            text: text || html.replace(/<[^>]*>/g, ''),
            ...(replyTo ? { replyTo } : {})
          };

          if (attachments && attachments.length > 0) {
            mailOptions.attachments = attachments;
          }

          const info = await transporter.sendMail(mailOptions);

          console.log('📧 Email sent via SMTP:', info.messageId);
          if (attachments && attachments.length > 0) {
            console.log(`   Attachments: ${attachments.length} file(s)`);
          }
          this._recordRcmE2eEmail({
            to,
            subject,
            template: 'generic',
            provider: 'smtp',
            success: true
          });
          return { success: true, message_id: info.messageId, provider: 'smtp' };
        }

        if (mode === 'smtp') {
          return { success: false, error: 'SMTP not configured', provider: 'smtp' };
        }
      }

      const from = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.AZURE_EMAIL_SENDER || 'Somo <richard@callsomo.com>';
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
      this._recordRcmE2eEmail({
        to,
        subject,
        template: 'generic',
        provider: 'console',
        success: false
      });
      if (process.env.RCM_E2E_RECORD_EMAIL === '1') {
        return {
          success: false,
          error: 'SMTP not configured — set SMTP_USER/SMTP_PASS for real email (RCM_E2E_RECORD_EMAIL=1)',
          provider: 'console'
        };
      }
      return { success: false, error: 'No email provider configured', provider: 'console' };

    } catch (error) {
      console.error('❌ Email send error:', error.message);
      this._recordRcmE2eEmail({
        to,
        subject,
        template: 'generic',
        provider: 'error',
        success: false
      });
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
    const locale = String(options.locale || appointment.preferred_language || 'en').slice(0, 2);
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

    const subjects = {
      en: `Appointment Confirmed - ${dateTime}`,
      es: `Cita confirmada - ${dateTime}`,
      zh: `预约已确认 - ${dateTime}`,
      ru: `Запись подтверждена - ${dateTime}`
    };
    const titles = {
      en: 'Appointment confirmed',
      es: 'Cita confirmada',
      zh: '预约已确认',
      ru: 'Запись подтверждена'
    };
    const intro = {
      en: 'Your appointment is scheduled.',
      es: 'Su cita está programada.',
      zh: '您的预约已安排。',
      ru: 'Ваша запись запланирована.'
    };

    const calBtn = appointment.calendar_link
      ? `<p style="text-align:center;margin-top:16px;">${SomoEmail.button(appointment.calendar_link, 'Add to calendar')}</p>`
      : '';
    const clinicName = await (async () => {
      if (appointment.clinic_name) return appointment.clinic_name;
      if (!appointment.clinic_id) return 'Your care team';
      try {
        const db = require('../database');
        const clinic = db.getClinicById?.(appointment.clinic_id);
        return clinic?.name || 'Your care team';
      } catch (_) {
        return 'Your care team';
      }
    })();

    const html = this._somoLayout(titles[locale] || titles.en, dateTime, `
      <h2>Hi ${SomoEmail.escapeHtml(appointment.patient_name)},</h2>
      <p>${intro[locale] || intro.en}</p>
      <p><em>On behalf of ${SomoEmail.escapeHtml(clinicName)}</em></p>
      ${SomoEmail.infoRows([
        { label: 'Date & time', value: dateTime },
        { label: 'Type', value: appointment.appointment_type || 'Consultation' },
        { label: 'Duration', value: `${appointment.duration_minutes || 50} minutes` },
        { label: 'Provider', value: appointment.provider || clinicName },
        { label: 'Confirmation', value: confirmationNumber }
      ])}
      ${uploadBlock}
      ${calBtn}
      <p>You will receive a reminder about one hour before your visit.</p>
      <p>Best regards,<br>${SomoEmail.escapeHtml(clinicName)} via Somo</p>
    `, { preheader: `Confirmed: ${dateTime}` });

    let replyTo = null;
    if (appointment.clinic_id) {
      try {
        const db = require('../database');
        const clinic = db.getClinicById?.(appointment.clinic_id);
        replyTo = clinic?.email || null;
      } catch (_) {}
    }

    return await this.sendEmail({
      to: appointment.patient_email,
      subject: `${clinicName} — ${subjects[locale] || subjects.en}`,
      html: html,
      replyTo
    });
  }

  /**
   * Alert practice staff that a caller requested live handoff.
   */
  static async sendHandoffAlert({ to, clinic_name, session_id, reason, locale = 'en' } = {}) {
    if (!to) return { skipped: true };
    const title = locale === 'es' ? 'Solicitud de transferencia' : 'Caller handoff requested';
    const html = this._somoLayout(title, clinic_name || 'Practice', `
      <h2>${SomoEmail.escapeHtml(clinic_name || 'Your practice')}</h2>
      <p>A caller on your Somo voice line requested live assistance.</p>
      ${SomoEmail.infoRows([
        { label: 'Reason', value: reason || 'handoff' },
        { label: 'Session', value: session_id || 'n/a' }
      ])}
      <p>Check your provider dashboard for active escalations.</p>
    `, { preheader: 'Caller handoff requested' });
    return await this.sendEmail({ to, subject: `${clinic_name || 'Practice'} — caller handoff requested`, html });
  }

  static async sendProviderInvite({ to, practiceName, inviteUrl } = {}) {
    if (!to || !inviteUrl) return { skipped: true };
    const html = this._somoLayout(
      'Set up Kelly',
      practiceName || 'Your practice',
      `
      <h2>You're invited to Somo</h2>
      <p>Set up Kelly, your AI front desk, for <strong>${SomoEmail.escapeHtml(practiceName || 'your practice')}</strong>.</p>
      <p><a href="${SomoEmail.escapeHtml(inviteUrl)}" style="display:inline-block;padding:12px 20px;background:#16a637;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Set up Kelly</a></p>
      <p style="font-size:13px;color:#64748b">This invite link expires in 14 days.</p>
    `,
      { preheader: 'Set up your AI front desk' }
    );
    return await this.sendEmail({
      to,
      subject: `${practiceName || 'Your practice'} — Set up Kelly on Somo`,
      html
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

    const html = this._somoLayout('Appointment in 1 hour', dateTime, `
      <h2>Hi ${SomoEmail.escapeHtml(appointment.patient_name)},</h2>
      <p><strong>Your appointment starts in about one hour.</strong></p>
      ${joinBlock}
      ${SomoEmail.infoRows([
        { label: 'Date & time', value: dateTime },
        { label: 'Type', value: appointment.appointment_type || 'Consultation' },
        { label: 'Provider', value: appointment.provider || 'Somo care team' }
      ])}
      <p style="text-align:center;">
        ${SomoEmail.button(rescheduleLink, 'Reschedule', 'warning')}
        ${SomoEmail.button(cancelLink, 'Cancel', 'danger')}
      </p>
      <p>Best regards,<br>The Somo team</p>
    `, { preheader: `Reminder: ${dateTime}` });

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

    const html = this._somoLayout('Appointment tomorrow', dateTime, `
      <h2>Hi ${SomoEmail.escapeHtml(appointment.patient_name)},</h2>
      <p><strong>Your appointment is tomorrow.</strong></p>
      ${uploadBlock}
      ${SomoEmail.infoRows([
        { label: 'When', value: dateTime },
        { label: 'Type', value: appointment.appointment_type || 'Consultation' },
        { label: 'Provider', value: appointment.provider || 'Somo care team' }
      ])}
      <p>We will send another reminder about one hour before your visit.</p>
      <p>Best regards,<br>The Somo team</p>
    `);

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
    const html = this._somoLayout('Verification code', 'Checkout', `
      <p>Enter this code to continue checkout:</p>
      ${SomoEmail.codeBox(code)}
      <p><strong>Expires in 15 minutes.</strong></p>
    `, { preheader: `Code: ${code}` });
    return await this.sendEmail({
      to: email,
      subject: 'Somo — Email verification code',
      html
    });
  }

  /**
   * Send patient portal verification code
   */
  static async sendPatientVerificationCode(email, code) {
    const html = this._somoLayout('Patient portal sign-in', 'Verification code', `
      <p>Use this code to sign in to your Somo patient portal:</p>
      ${SomoEmail.codeBox(code)}
      <p><strong>Expires in 10 minutes.</strong></p>
      <p>If you did not request this code, you can ignore this email.</p>
    `, { preheader: `Code: ${code}` });

    return await this.sendEmail({
      to: email,
      subject: 'Somo — Patient portal verification code',
      html
    });
  }

  /**
   * Send payment link email after verification (Task 37: include appointment details)
   */
  static async sendPaymentLinkEmail(email, paymentLink, order) {
    const aptLine =
      order?.appointment_date || order?.appointment_type || order?.appointment_time
        ? `${order.appointment_type || 'Visit'}${order.appointment_date ? ` — ${order.appointment_date}${order.appointment_time ? ` at ${order.appointment_time}` : ''}` : ''}`
        : '';
    const baseUrl = process.env.BASE_URL || process.env.API_BASE_URL || 'https://api.callsomo.com';
    const appointmentsUrl = baseUrl.replace(/\/$/, '') + '/patients/appointments.html';

    const html = this._somoLayout('Complete your payment', 'Secure checkout', `
      <p>Your email is verified. Use the button below to pay securely.</p>
      ${SomoEmail.infoRows([
        { label: 'Product', value: order?.product_name || 'Service' },
        ...(aptLine ? [{ label: 'Appointment', value: aptLine }] : []),
        { label: 'Amount', value: `$${(order?.amount || 0).toFixed(2)}` }
      ])}
      <p style="text-align:center;">${SomoEmail.button(paymentLink, 'Pay now')}</p>
      <p style="word-break:break-all;font-size:14px;">${SomoEmail.escapeHtml(paymentLink)}</p>
      <p>After payment, view your appointment at <a href="${appointmentsUrl}">My appointments</a>.</p>
    `, { preheader: 'Complete payment for your Somo visit' });

    const result = await this.sendEmail({
      to: email,
      subject: 'Complete Your Payment',
      html: html
    });
    this._recordRcmE2eEmail({
      to: email,
      subject: 'Complete Your Payment',
      template: 'payment_link',
      provider: result?.provider || '',
      success: !!result?.success
    });
    return result;
  }

  /**
   * Send post-payment receipt email (Task 12, 38: include appointment details)
   * @param {Object} checkout - Voice checkout record
   * @param {number} amount - Amount charged
   * @param {string} paymentRef - Payment intent ID or transfer ID
   * @param {Object} appointment - Optional { date, time, appointment_type }
   */
  static async sendPaymentReceipt(checkout, amount, paymentRef, appointment, branding = {}) {
    const escapeHtml = (value) =>
      String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const name = escapeHtml(checkout.customer_name || 'Patient');
    const product = escapeHtml(checkout.product_name || 'Appointment');
    const amountPaid = Number(amount || 0).toFixed(2);
    const orderId = escapeHtml(checkout.id || 'N/A');
    const txRef = escapeHtml(paymentRef || 'N/A');
    const email = escapeHtml(checkout.customer_email || '');
    const baseUrl = String(process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');

    let clinicName = branding.clinicName || branding.clinic_name || null;
    let clinicLogoUrl = branding.clinicLogoUrl || branding.clinic_logo_url || null;
    if ((!clinicName || !clinicLogoUrl) && checkout.merchant_id) {
      try {
        const db = require('../database');
        const merchant = db.getMerchant ? db.getMerchant(checkout.merchant_id) : null;
        if (merchant) {
          clinicName = clinicName || merchant.name || merchant.company_name || null;
          const rawLogo = String(merchant.logo_url || merchant.image_url || '').trim();
          if (!clinicLogoUrl && rawLogo) {
            clinicLogoUrl = /^https?:\/\//i.test(rawLogo)
              ? rawLogo
              : `${baseUrl}${rawLogo.startsWith('/') ? '' : '/'}${rawLogo}`;
          }
        }
      } catch (_) {}
    }
    const brandLabel = escapeHtml(clinicName || 'Somo');
    const brandLogoBlock = clinicLogoUrl
      ? `<img src="${escapeHtml(clinicLogoUrl)}" alt="${brandLabel}" style="max-height:40px;margin-bottom:8px;" />`
      : '';

    let productImageUrl = '';
    try {
      const db = require('../database');
      const productRow = checkout.product_id && db.getProduct
        ? db.getProduct(checkout.product_id)
        : null;
      const rawImage = String(productRow?.image_url || '').trim();
      if (rawImage) {
        productImageUrl = /^https?:\/\//i.test(rawImage)
          ? rawImage
          : `${baseUrl}${rawImage.startsWith('/') ? '' : '/'}${rawImage}`;
      }
    } catch (_) {}

    const aptLine = (appointment?.date || appointment?.appointment_type)
      ? `
        <tr>
          <td style="padding: 6px 0; color: #6b7280;">Appointment</td>
          <td style="padding: 6px 0; color: #111827; font-weight: 600; text-align: right;">
            ${escapeHtml(appointment.appointment_type || checkout.product_name || 'Visit')}
            ${appointment.date ? ` - ${escapeHtml(appointment.date)}${appointment.time ? ` at ${escapeHtml(appointment.time)}` : ''}` : ''}
          </td>
        </tr>`
      : '';

    const productImageBlock = productImageUrl
      ? `
        <tr>
          <td colspan="2" style="padding: 0 0 12px 0;">
            <img
              src="${escapeHtml(productImageUrl)}"
              alt="${product}"
              style="display:block;width:100%;max-width:220px;height:auto;border-radius:14px;border:1px solid #ece8df;"
            />
          </td>
        </tr>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #f7f6f3;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1f2937;
          }
          .wrapper { width: 100%; padding: 28px 12px; box-sizing: border-box; }
          .container {
            max-width: 640px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid #e9e4db;
            border-radius: 18px;
            overflow: hidden;
          }
          .header {
            background: linear-gradient(180deg, #ffffff 0%, #fcfaf6 100%);
            border-bottom: 1px solid #efe9dc;
            padding: 22px 24px 18px;
          }
          .brand {
            margin: 0;
            font-size: 28px;
            line-height: 1;
            letter-spacing: -0.02em;
            color: #111827;
            font-weight: 700;
          }
          .header-subtitle {
            margin: 8px 0 0;
            color: #6b7280;
            font-size: 14px;
          }
          .content { padding: 24px; }
          .lead {
            margin: 0 0 16px;
            color: #374151;
            font-size: 16px;
            line-height: 1.55;
          }
          .receipt-card {
            background: #ffffff;
            border: 1px solid #ece8df;
            border-radius: 14px;
            padding: 16px;
          }
          .chip {
            display: inline-block;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            color: #065f46;
            background: #ecfdf5;
            border: 1px solid #bbf7d0;
            border-radius: 999px;
            padding: 5px 10px;
            margin-bottom: 12px;
          }
          .summary-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
          }
          .total-row td {
            border-top: 1px dashed #e5e7eb;
            padding-top: 10px !important;
            font-size: 16px;
            font-weight: 700;
            color: #111827 !important;
          }
          .footer {
            padding: 18px 24px 24px;
            color: #6b7280;
            font-size: 12px;
            border-top: 1px solid #f0ece2;
            background: #fffdfa;
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
        <div class="container">
          <div class="header">
            ${brandLogoBlock}
            <h1 class="brand">${brandLabel}</h1>
            <p class="header-subtitle">Payment receipt</p>
          </div>
          <div class="content">
            <p class="lead">Hi ${name}, thanks for your order. Your payment was successful and your receipt is below.</p>
            <div class="receipt-card">
              <span class="chip">Paid</span>
              <table class="summary-table" role="presentation">
                ${productImageBlock}
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Product</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 600; text-align: right;">${product}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Quantity</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 600; text-align: right;">${Number(checkout.quantity || 1)}</td>
                </tr>
                ${aptLine}
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Order ID</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 600; text-align: right;">${orderId}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Transaction</td>
                  <td style="padding: 6px 0; color: #111827; font-weight: 600; text-align: right; word-break: break-all;">${txRef}</td>
                </tr>
                <tr class="total-row">
                  <td style="padding: 6px 0;">Amount paid</td>
                  <td style="padding: 6px 0; text-align: right;">$${amountPaid}</td>
                </tr>
              </table>
            </div>
            <p class="lead" style="margin-top: 16px; font-size: 14px;">
              Receipt sent to: <strong>${email || 'your email'}</strong><br/>
              Need help? Reply to this email and our team will assist.
            </p>
          </div>
          <div class="footer">
            <p>This is your payment receipt. Please keep for your records.</p>
          </div>
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
            <p>Somo Finance Team</p>
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
          .header { background: #16a637; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .claim-details { background: white; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #16a637; }
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
            
            <p>Best regards,<br>Somo Healthcare Platform</p>
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
            
            <p>Best regards,<br>Somo Billing Department</p>
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
    const html = this._somoLayout('Email verification', 'Somo', `
      <h2>Hi ${SomoEmail.escapeHtml(name) || 'there'},</h2>
      <p>Use this code to verify your email address:</p>
      ${SomoEmail.codeBox(code)}
      <p><strong>Expires in 15 minutes.</strong></p>
      <p>If you did not request this, you can ignore this email.</p>
    `, { preheader: `Email verification code: ${code}` });

    return await this.sendEmail({
      to: email,
      subject: 'Somo — Email verification code',
      html
    });
  }

  static async sendAdminLoginCode(email, code, name) {
    const html = this._somoLayout('Admin sign-in verification', 'Somo', `
      <h2>Hi ${SomoEmail.escapeHtml(name) || 'there'},</h2>
      <p>Use this code to finish signing in to the Somo admin portal:</p>
      ${SomoEmail.codeBox(code)}
      <p><strong>Expires in 15 minutes.</strong></p>
      <p>If you did not request this, secure your account and contact support.</p>
    `, { preheader: `Admin sign-in code: ${code}` });

    return await this.sendEmail({
      to: email,
      subject: 'Somo — Admin sign-in verification code',
      html
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
  static async sendPromotionalEmail(email, customerName, promotion, merchantName = 'Somo') {
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

    const shopUrl = `${(process.env.BASE_URL || 'https://api.callsomo.com').replace(/\/$/, '')}/storefront`;
    const html = this._somoLayout('Special offer', SomoEmail.escapeHtml(merchantName), `
      <h2>Hi ${SomoEmail.escapeHtml(customerName) || 'there'},</h2>
      <p style="text-align:center;">
        <span style="display:inline-block;background:${SomoEmail.TOKENS.green};color:#fff;font-size:32px;font-weight:700;padding:16px 28px;border-radius:12px;">${SomoEmail.escapeHtml(discountText)}</span>
      </p>
      <h2 style="text-align:center;color:${SomoEmail.TOKENS.text};">${SomoEmail.escapeHtml(promotion.name || 'Special offer')}</h2>
      ${promotion.description ? `<p>${SomoEmail.escapeHtml(promotion.description)}</p>` : ''}
      ${promotion.code ? SomoEmail.codeBox(promotion.code) : ''}
      ${endDateText ? SomoEmail.infoRows([{ label: 'Valid until', value: endDateText }]) : ''}
      <p style="text-align:center;">${SomoEmail.button(shopUrl, 'Shop now')}</p>
      <p>Best regards,<br>${SomoEmail.escapeHtml(merchantName)}</p>
    `, { preheader: `${discountText} from ${merchantName}` });

    return await this.sendEmail({
      to: email,
      subject: `${discountText} — ${promotion.name || 'Special offer'} (${merchantName})`,
      html
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

    const rows = [
      { label: 'Billing period', value: billingMonth },
      { label: 'Invoice number', value: invoice.invoice_number },
      { label: 'Due date', value: dueDate }
    ];
    if (invoice.voice_minutes > 0) {
      rows.push(
        { label: 'Voice minutes', value: `${invoice.voice_minutes.toLocaleString()} min` },
        { label: 'Voice cost', value: `$${invoice.voice_minutes_cost.toFixed(2)}` }
      );
    }
    if (invoice.api_requests > 0) {
      rows.push(
        { label: 'API requests', value: invoice.api_requests.toLocaleString() },
        { label: 'API cost', value: `$${invoice.api_requests_cost.toFixed(2)}` }
      );
    }
    rows.push({
      label: 'Total due',
      valueHtml: `<strong style="font-size:20px;color:${SomoEmail.TOKENS.green}">$${invoice.total.toFixed(2)}</strong>`
    });

    const html = this._somoLayout(
      'Monthly invoice',
      `Invoice #${invoice.invoice_number}`,
      `
      <h2>Hi ${SomoEmail.escapeHtml(name) || 'there'},</h2>
      <p>Your invoice for <strong>${SomoEmail.escapeHtml(billingMonth)}</strong> is ready.</p>
      ${SomoEmail.infoRows(rows)}
      <p>Payment is due within 15 days. Your stored payment method will be charged on the due date.</p>
      <p style="text-align:center;">${SomoEmail.button('https://api.callsomo.com/docs', 'View dashboard')}</p>
      <p>Questions? Contact <a href="mailto:${SomoEmail.SUPPORT_EMAIL}">${SomoEmail.SUPPORT_EMAIL}</a>.</p>
    `
    );

    return await this.sendEmail({
      to: email,
      subject: `Somo invoice — $${invoice.total.toFixed(2)} due (${invoice.invoice_number})`,
      html
    });
  }

  /**
   * Send welcome email with subdomain and password
   */
  static async sendWelcomeEmail(customerEmail, customerName, subdomain, customerType, merchantId, password = null) {
    const baseDomain = process.env.BASE_DOMAIN || 'callsomo.com';
    const baseUrl = process.env.BASE_URL || (process.env.NODE_ENV === 'production'
      ? `https://${baseDomain}`
      : 'http://localhost:4000');

    // Determine login URL based on subdomain
    const loginUrl = subdomain
      ? `https://${subdomain}.${baseDomain}/login`
      : `${baseUrl}/login`;

    const accountType = customerType === 'saas' ? 'SaaS Platform' : 'API Integration';
    const dashboardType = customerType === 'saas' ? 'business dashboard' : 'API documentation';

    const infoRows = [
      { label: 'Account type', value: accountType },
      { label: 'Email', value: customerEmail }
    ];
    if (subdomain) {
      infoRows.push({ label: 'Dashboard URL', value: `${subdomain}.${baseDomain}` });
    }
    if (password) {
      infoRows.push({
        label: 'Temporary password',
        valueHtml: `<strong style="color:${SomoEmail.TOKENS.green}">${SomoEmail.escapeHtml(password)}</strong>`
      });
    }

    const html = this._somoLayout('Welcome to Somo', 'Your account is ready', `
      <h2>Hi ${SomoEmail.escapeHtml(customerName) || 'there'},</h2>
      <p>Your Somo account is ready. Sign in to access your ${SomoEmail.escapeHtml(dashboardType)}.</p>
      ${SomoEmail.infoRows(infoRows)}
      ${password ? SomoEmail.panel('<p style="margin:0;color:#92400e;font-weight:600;">Save this password securely. You can change it in account settings.</p>', 'warning') : ''}
      <p style="text-align:center;">${SomoEmail.button(loginUrl, 'Log in')}</p>
      ${subdomain ? `<p style="text-align:center;"><a href="https://${SomoEmail.escapeHtml(subdomain)}.${SomoEmail.escapeHtml(baseDomain)}">https://${SomoEmail.escapeHtml(subdomain)}.${SomoEmail.escapeHtml(baseDomain)}</a></p>` : ''}
      <p>Best regards,<br>The Somo team</p>
    `);

    return await this.sendEmail({
      to: customerEmail,
      subject: 'Welcome to Somo — your account is ready',
      html
    });
  }

  /**
   * Send password reset email
   */
  static async sendPasswordResetEmail(email, name, resetUrl) {
    const html = this._somoLayout('Password reset', 'Somo', `
      <h2>Hi ${SomoEmail.escapeHtml(name) || 'there'},</h2>
      <p>We received a request to reset your password.</p>
      <p style="text-align:center;">${SomoEmail.button(resetUrl, 'Reset password')}</p>
      <p style="word-break:break-all;font-family:monospace;font-size:14px;">${SomoEmail.escapeHtml(resetUrl)}</p>
      ${SomoEmail.panel('<p style="margin:0;color:#92400e;"><strong>This link expires in 1 hour.</strong> If you did not request a reset, ignore this email.</p>', 'warning')}
      <p>Best regards,<br>The Somo team</p>
    `);

    return await this.sendEmail({
      to: email,
      subject: 'Somo — Password reset',
      html
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
            background: linear-gradient(135deg, #16a637 0%, #3b82f6 100%);
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
              .
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
              <a href="https://callsomo.com/admin" class="button">View in Admin Portal</a>
            </p>
            
            <p style="color: #64748b; font-size: 0.9rem; margin-top: 24px;">
              Please review and approve or reject these feature requests in the admin portal.
            </p>
          </div>
          
          <div class="footer">
            <p style="margin: 0;">This is an automated notification from Somo API</p>
            <p style="margin: 8px 0 0 0; font-size: 0.85rem;">
              <a href="https://api.callsomo.com" style="color: #2563eb;">API Documentation</a> | 
              <a href="https://callsomo.com" style="color: #2563eb;">Website</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const adminEmail = process.env.ADMIN_EMAIL || 'richard@callsomo.com';

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
    const baseDomain = process.env.BASE_DOMAIN || 'callsomo.com';
    const dashboardUrl = subdomain
      ? `https://${subdomain}.${baseDomain}/billing`
      : `${process.env.BASE_URL || 'https://api.callsomo.com'}/billing`;

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
            background: linear-gradient(135deg, #16a637 0%, #3b82f6 100%); 
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
                Contact us at <a href="mailto:support@callsomo.com" style="color: #16a637;">support@callsomo.com</a> 
                or visit your dashboard to manage your account.
              </p>
            </div>
            <div class="footer">
              <p>This is an automated alert from Somo.</p>
              <p style="margin-top: 10px;">
                <a href="${dashboardUrl}" style="color: #16a637; text-decoration: none;">Manage Credits</a> | 
                <a href="https://callsomo.com" style="color: #16a637; text-decoration: none;">Visit Website</a>
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
        <div style="color:#6b7280;margin-top:4px;">Healthcare at your home</div>
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
        <div style="color:#6b7280;margin-top:4px;">Healthcare at your home</div>
        <h2 style="margin-top:18px;">Your appointment was canceled</h2>
        <p style="color:#374151;">Canceled visit time: <strong>${dt}</strong></p>
        <p style="color:#374151;">If this was a mistake, please schedule a new visit or contact your clinic.</p>
      </div>
    `;
    return this.sendEmail({ to: appointment.patient_email, subject, html });
  }

  static async sendPostVisitSummaryReady(appointment) {
    if (!appointment || !appointment.patient_email) return { success: false, error: 'Missing patient email' };
    const baseUrl = (process.env.DASHBOARD_BASE_URL || process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
    const feedbackExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    const { createFeedbackToken } = require('../utils/upload-token');
    const feedbackToken = createFeedbackToken(appointment.id, feedbackExpiry);
    const feedbackUrl = `${baseUrl}/patients/feedback.html?appointment_id=${encodeURIComponent(appointment.id)}&token=${encodeURIComponent(feedbackToken)}`;
    const subject = 'Consult Patient Portal — Your Visit Summary Is Ready';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:16px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-1px;">Consʌlt</div>
        <div style="color:#6b7280;margin-top:4px;">Healthcare at your home</div>
        <h2 style="margin-top:18px;">Your visit summary is ready</h2>
        <p style="color:#374151;">You can view your records and documents in the patient portal.</p>
        <p style="margin-top:20px;color:#374151;font-weight:600;">Was this visit helpful?</p>
        <p style="margin-top:8px;">
          <a href="${feedbackUrl + '&helpful=1'}" style="display:inline-block;padding:10px 16px;margin-right:8px;background:#16a34a;color:white!important;text-decoration:none;border-radius:8px;font-weight:600;">👍 Yes</a>
          <a href="${feedbackUrl + '&helpful=0'}" style="display:inline-block;padding:10px 16px;background:#dc2626;color:white!important;text-decoration:none;border-radius:8px;font-weight:600;">👎 No</a>
        </p>
        <p style="margin-top:12px;font-size:13px;color:#6b7280;">Or leave detailed feedback: <a href="${feedbackUrl}" style="color:#16a637;">${feedbackUrl}</a></p>
      </div>
    `;
    return this.sendEmail({ to: appointment.patient_email, subject, html });
  }
}

module.exports = EmailService;

