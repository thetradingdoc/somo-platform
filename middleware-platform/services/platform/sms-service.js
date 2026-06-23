/**
 * SMS SERVICE
 * Sends payment links via Twilio
 * Falls back to simulation if Twilio not configured
 */

const twilio = require('twilio');
const UsageMonitor = require('./usage-monitor');
const db = require('../../database');
const { normalizeToE164 } = require('../../utils/phone-e164');

class SMSService {
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
            const client = this.getTwilioClient();
            const fromNumber = process.env.TWILIO_PHONE_NUMBER;

            // Validate phone number format
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            if (!this.validatePhoneNumber(formattedPhone)) {
                throw new Error(`Invalid phone number format: ${phoneNumber}`);
            }

            // Format SMS message
            const message = this.formatPaymentMessage(paymentLink, orderDetails);
            const messageSegments = Math.ceil(message.length / 160); // SMS segments (160 chars each)

            // If Twilio is configured, send real SMS
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
                console.log('\n📱 SENDING REAL SMS VIA TWILIO');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`From: ${fromNumber}`);
                console.log(`To: ${formattedPhone}`);
                console.log(`Message Length: ${message.length} characters`);
                console.log(`Message Segments: ${messageSegments}`);
                console.log(`Message:\n${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                try {
                    const result = await client.messages.create({
                        body: message,
                        from: fromNumber,
                        to: formattedPhone
                    });

                    console.log(`✅ SMS sent successfully!`);
                    console.log(`   Message SID: ${result.sid}`);
                    console.log(`   Status: ${result.status}`);
                    console.log(`   To: ${result.to}\n`);

                    // Log SMS usage if customer/merchant info available
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
                        } catch (logError) {
                            console.warn('⚠️  Failed to log SMS usage:', logError.message);
                            // Don't fail SMS send if logging fails
                        }
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
                    console.error('   Error Code:', twilioError.code);
                    console.error('   More Info:', twilioError.moreInfo);

                    throw new Error(`Twilio SMS failed: ${twilioError.message}`);
                }
            } else {
                // Fallback to simulation if Twilio not configured
                console.log('\n📱 SMS SIMULATION (Twilio not configured)');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`To: ${formattedPhone}`);
                console.log(`Message:\n${message}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('💡 To send real SMS, add Twilio credentials to .env file');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                return {
                    success: true,
                    simulated: true,
                    message: 'SMS simulated - Twilio not configured',
                    phone: formattedPhone,
                    real_sms: false
                };
            }

        } catch (error) {
            console.error('❌ SMS Service Error:', error.message);

            // Return error details
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
     * Format SMS message for payment link
     */
    static formatPaymentMessage(paymentLink, orderDetails) {
        const { product_name, amount, merchant_name } = orderDetails;

        return `${merchant_name}: Complete your order for ${product_name} ($${amount}):\n\n${paymentLink}\n\nLink expires in 1 hour.`;
    }

    /**
     * Send generic SMS message
     * @param {string} phoneNumber - Recipient phone number
     * @param {string} message - SMS message content
     * @returns {Promise<Object>} Result object with success status
     */
    static async sendSMS(phoneNumber, message) {
        try {
            const client = this.getTwilioClient();
            const fromNumber = process.env.TWILIO_PHONE_NUMBER;
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