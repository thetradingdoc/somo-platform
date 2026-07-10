/**
 * SMS SERVICE
 * Sends payment links via Twilio
 * Falls back to simulation if Twilio not configured
 */

const twilio = require('twilio');
const UsageMonitor = require('./usage-monitor');
const db = require('../database');
const { normalizeToE164 } = require('../utils/phone-e164');
const { validatePhiSafeMessage } = require('../utils/phi-safe-messaging');

class SMSService {
    static _assertPhiSafeOutbound(message) {
        const check = validatePhiSafeMessage(message);
        if (!check.safe) {
            const err = new Error('SMS blocked: message contains potential PHI patterns');
            err.code = 'PHI_SAFE_MESSAGE_BLOCKED';
            err.violations = check.violations;
            throw err;
        }
    }

    static _testNumbers() {
        const raw = String(process.env.SMS_TEST_NUMBERS || process.env.TEST_SMS_NUMBERS || '').trim();
        if (!raw) return new Set();
        return new Set(
            raw
                .split(',')
                .map((p) => this.formatPhoneNumber(p))
                .filter(Boolean)
        );
    }

    static isTestNumber(phoneNumber) {
        const formatted = this.formatPhoneNumber(phoneNumber);
        if (!formatted) return false;
        if (formatted === '+15555555555' || formatted === '+15005550006') return true;
        // E.164 test harness (+1555 + 7 digits) and NANP 555 exchange — never hit live Twilio.
        if (/^\+1555\d{7}$/.test(formatted)) return true;
        if (process.env.SMS_FORCE_SIMULATE === '1' || process.env.VOICE_EVAL_SIMULATE_SMS === '1') {
            return true;
        }
        return this._testNumbers().has(formatted);
    }
    /**
     * Get Twilio client
     * Returns null if credentials not configured
     */
    static getTwilioClient() {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            console.warn('⚠️  Twilio credentials not configured - SMS will be simulated');
            return null;
        }

        return twilio(accountSid, authToken);
    }

    /**
     * Send payment link via SMS
     * Uses Twilio if configured, otherwise simulates
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} paymentLink - Payment link URL
     * @param {object} orderDetails - Order details (product_name, amount, merchant_name)
     * @param {string} customerId - Optional customer ID for usage tracking
     * @param {string} merchantId - Optional merchant ID for usage tracking
     */
    static async sendPaymentLink(phoneNumber, paymentLink, orderDetails, customerId = null, merchantId = null) {
        try {
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            if (!this.validatePhoneNumber(formattedPhone)) {
                throw new Error(`Invalid phone number format: ${phoneNumber}`);
            }

            const message = this.formatPaymentMessage(paymentLink, orderDetails);
            const result = await this._dispatchPaymentLinkSms(
                formattedPhone,
                message,
                orderDetails,
                customerId,
                merchantId
            );
            return { ...result, sms_body: message };

        } catch (error) {
            console.error('❌ SMS Service Error:', error.message);

            return {
                success: false,
                error: error.message,
                code: error.code || 'UNKNOWN',
                phone: phoneNumber,
                real_sms: false
            };
        }
    }

    /**
     * Format SMS message for payment link (commerce checkout).
     */
    static formatPaymentMessage(paymentLink, orderDetails) {
        const { product_name, amount, merchant_name } = orderDetails;
        const clinic = merchant_name || process.env.CLINIC_DISPLAY_NAME || 'Your clinic';

        return `${clinic}: Complete your order for ${product_name} ($${amount}):\n\n${paymentLink}\n\nLink expires in 1 hour.`;
    }

    /**
     * Patient-facing copay / balance SMS (RCM voice path) — localized, no commerce copy.
     */
    static formatCopayPaymentSms({ locale = 'en', clinicName, amount, paymentLink }) {
        const clinic = clinicName || process.env.CLINIC_DISPLAY_NAME || 'Your clinic';
        const amt = Number(amount);
        const formatted = Number.isFinite(amt) ? amt.toFixed(2) : String(amount || '0');
        const loc = String(locale || 'en').slice(0, 2).toLowerCase();
        const templates = {
            en: `${clinic}: Your estimated copay is $${formatted}. Pay securely: ${paymentLink}`,
            es: `${clinic}: Su copago estimado es $${formatted}. Pague de forma segura: ${paymentLink}`,
            ru: `${clinic}: Ваш ориентировочный копай — $${formatted}. Оплатите по ссылке: ${paymentLink}`,
            zh: `${clinic}：您的预估自付额为 $${formatted}。安全支付链接：${paymentLink}`
        };
        return templates[loc] || templates.en;
    }

    /**
     * Send copay payment link SMS (uses formatCopayPaymentSms).
     */
    static async sendCopayPaymentLink(phoneNumber, paymentLink, { locale, clinicName, amount }, customerId = null, merchantId = null) {
        const message = this.formatCopayPaymentSms({ locale, clinicName, amount, paymentLink });
        const orderDetails = { product_name: 'Copay / balance due', amount, merchant_name: clinicName, locale };
        const baseResult = await this._dispatchPaymentLinkSms(phoneNumber, message, orderDetails, customerId, merchantId);
        return { ...baseResult, sms_body: message, sms_locale: String(locale || 'en').slice(0, 2) };
    }

    /** @private */
    static async _dispatchPaymentLinkSms(phoneNumber, message, orderDetails, customerId, merchantId) {
        try {
            this._assertPhiSafeOutbound(message);
            const client = this.getTwilioClient();
            const fromNumber = process.env.TWILIO_PHONE_NUMBER;
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            if (!this.validatePhoneNumber(formattedPhone)) {
                throw new Error(`Invalid phone number format: ${phoneNumber}`);
            }
            const messageSegments = Math.ceil(message.length / 160);

            if (this.isTestNumber(formattedPhone)) {
                console.log('\n📱 COPAY SMS (test number — simulated)');
                console.log(`To: ${formattedPhone}\nMessage:\n${message}\n`);
                return {
                    success: true,
                    simulated: true,
                    message: 'SMS simulated for test number',
                    phone: formattedPhone,
                    provider: 'test',
                    real_sms: false
                };
            }

            if (client && fromNumber) {
                console.log('\n📱 SENDING COPAY SMS VIA TWILIO');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`From: ${fromNumber}`);
                console.log(`To: ${formattedPhone}`);
                console.log(`Message:\n${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                try {
                    const result = await client.messages.create({
                        body: message,
                        from: fromNumber,
                        to: formattedPhone
                    });
                    if (customerId || merchantId) {
                        try {
                            UsageMonitor.logSMSUsage(
                                customerId,
                                merchantId,
                                formattedPhone,
                                'outbound',
                                result.sid,
                                messageSegments
                            );
                        } catch (_) {}
                    }
                    return {
                        success: true,
                        message_sid: result.sid,
                        status: result.status,
                        to: formattedPhone,
                        provider: 'twilio',
                        real_sms: true
                    };
                } catch (twilioError) {
                    console.error('❌ Twilio API Error:', twilioError.message);
                    return {
                        success: false,
                        error: twilioError.message,
                        code: twilioError.code,
                        phone: formattedPhone,
                        real_sms: false
                    };
                }
            }

            console.log('\n📱 COPAY SMS SIMULATION (Twilio not configured)');
            console.log(`To: ${formattedPhone}\nMessage:\n${message}\n`);
            return {
                success: true,
                simulated: true,
                message: 'SMS simulated - Twilio not configured',
                phone: formattedPhone,
                real_sms: false
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                phone: phoneNumber,
                real_sms: false
            };
        }
    }

    /**
     * Send generic SMS message
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} message - SMS message content
     * @returns {Promise<Object>} Result object with success status
     */
    static async sendSMS(phoneNumber, message, fromOverride = null) {
        try {
            this._assertPhiSafeOutbound(message);
            const client = this.getTwilioClient();
            const fromNumber = fromOverride || process.env.TWILIO_PHONE_NUMBER;
            const formattedPhone = this.formatPhoneNumber(phoneNumber);

            if (!this.validatePhoneNumber(formattedPhone)) {
                throw new Error(`Invalid phone number format: ${phoneNumber}`);
            }

            if (this.isTestNumber(formattedPhone)) {
                return {
                    success: true,
                    simulated: true,
                    message: 'SMS simulated for test number',
                    phone: formattedPhone,
                    provider: 'test',
                    real_sms: false
                };
            }

            if (client && fromNumber) {
                console.log('\n📱 SENDING SMS VIA TWILIO');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`From: ${fromNumber}`);
                console.log(`To: ${formattedPhone}`);
                console.log(`Message: ${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                const result = await client.messages.create({
                    body: message,
                    from: fromNumber,
                    to: formattedPhone
                });

                console.log(`✅ SMS sent successfully!`);
                console.log(`   Message SID: ${result.sid}`);
                console.log(`   Status: ${result.status}\n`);

                return {
                    success: true,
                    message_sid: result.sid,
                    status: result.status,
                    to: formattedPhone,
                    provider: 'twilio',
                    real_sms: true
                };
            } else {
                // Fallback to simulation
                console.log('\n📱 SMS SIMULATION (Twilio not configured)');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`To: ${formattedPhone}`);
                console.log(`Message: ${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                return {
                    success: true,
                    simulated: true,
                    message: 'SMS simulated - Twilio not configured',
                    phone: formattedPhone,
                    provider: 'console',
                    real_sms: false
                };
            }

        } catch (error) {
            console.error('❌ SMS Service Error:', error.message);
            return {
                success: false,
                error: error.message,
                code: error.code || 'UNKNOWN',
                phone: phoneNumber,
                real_sms: false
            };
        }
    }

    /**
     * Send order confirmation SMS
     * Called after payment is completed
     */
    static async sendOrderConfirmation(phoneNumber, orderDetails) {
        try {
            const client = this.getTwilioClient();
            const fromNumber = process.env.TWILIO_PHONE_NUMBER;
            const formattedPhone = this.formatPhoneNumber(phoneNumber);

            const message = `Order confirmed! Your ${orderDetails.product_name} will be shipped soon. Order #${orderDetails.order_id}`;

            if (this.isTestNumber(formattedPhone)) {
                return {
                    success: true,
                    simulated: true,
                    message: 'SMS simulated for test number',
                    phone: formattedPhone,
                    provider: 'test',
                    real_sms: false
                };
            }

            if (client && fromNumber) {
                console.log('\n📱 SENDING ORDER CONFIRMATION');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`To: ${formattedPhone}`);
                console.log(`Message: ${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                const result = await client.messages.create({
                    body: message,
                    from: fromNumber,
                    to: formattedPhone
                });

                console.log(`✅ Confirmation sent! SID: ${result.sid}\n`);

                return {
                    success: true,
                    message_sid: result.sid,
                    status: result.status,
                    real_sms: true
                };
            } else {
                console.log('\n📱 ORDER CONFIRMATION SIMULATION');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`To: ${formattedPhone}`);
                console.log(`Message: ${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                return {
                    success: true,
                    simulated: true,
                    real_sms: false
                };
            }

        } catch (error) {
            console.error('❌ Order confirmation SMS error:', error.message);
            return {
                success: false,
                error: error.message,
                real_sms: false
            };
        }
    }

    /**
     * Validate phone number format (E.164)
     */
    static validatePhoneNumber(phoneNumber) {
        // E.164 format: +[country code][number]
        // Example: +18622307479
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        return phoneRegex.test(phoneNumber);
    }

    /**
     * Format phone number to E.164 standard (stored and compared with leading +, digits only).
     */
    static formatPhoneNumber(phoneNumber) {
        if (phoneNumber == null || String(phoneNumber).trim() === '') return '';
        return normalizeToE164(phoneNumber);
    }

    /**
     * Check if Twilio is configured
     */
    static isConfigured() {
        return !!(
            process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            process.env.TWILIO_PHONE_NUMBER
        );
    }

    /**
     * Get configuration status
     */
    static getStatus() {
        return {
            configured: this.isConfigured(),
            account_sid: process.env.TWILIO_ACCOUNT_SID ? '✅ Set' : '❌ Missing',
            auth_token: process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Missing',
            phone_number: process.env.TWILIO_PHONE_NUMBER || '❌ Missing'
        };
    }
}

module.exports = SMSService;