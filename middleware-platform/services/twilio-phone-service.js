/**
 * Twilio Phone Number Provisioning Service
 * 
 * Handles automatic provisioning of Twilio phone numbers for SaaS customers
 */

const axios = require('axios');

/** US area codes that cannot be used for Twilio local search (e.g. +1555… test lines). */
const INVALID_US_AREA_CODES = new Set(['555', '000', '001']);

/**
 * Extract 3-digit US area code from E.164 (+1XXXXXXXXXX).
 * @returns {string|null}
 */
function extractUsAreaCodeFromE164(phoneE164) {
  const digitsOnly = String(phoneE164 || '').replace(/\D/g, '');
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1, 4);
  }
  if (digitsOnly.length === 10) {
    return digitsOnly.substring(0, 3);
  }
  return null;
}

/**
 * @param {string|null|undefined} areaCode
 * @returns {boolean}
 */
function isValidUsAreaCode(areaCode) {
  if (!areaCode || !/^\d{3}$/.test(areaCode)) return false;
  if (INVALID_US_AREA_CODES.has(areaCode)) return false;
  if (areaCode.startsWith('0') || areaCode.startsWith('1')) return false;
  return true;
}

/**
 * Prefer mobile area code when valid; otherwise null.
 * @param {string} phoneE164
 * @returns {string|null}
 */
function normalizeUsAreaCode(phoneE164) {
  const ac = extractUsAreaCodeFromE164(phoneE164);
  return isValidUsAreaCode(ac) ? ac : null;
}

class TwilioPhoneService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.apiBaseUrl = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}`;
    this.isConfigured = !!(this.accountSid && this.authToken);
  }

  /**
   * Check if Twilio is configured
   */
  isAvailable() {
    return this.isConfigured;
  }

  /**
   * Search for available phone numbers in a specific area
   * @param {Object} options - Search options
   * @param {string} options.country - Country code (default: 'US')
   * @param {string} options.areaCode - Area code (optional)
   * @param {string} options.contains - Phone number pattern to match (optional)
   * @returns {Promise<Array>} Array of available phone numbers
   */
  async searchAvailablePhoneNumbers(options = {}) {
    if (!this.isConfigured) {
      throw new Error('Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    }

    try {
      const { country = 'US', areaCode, contains } = options;
      const ac = areaCode && isValidUsAreaCode(String(areaCode)) ? String(areaCode) : null;

      // Build search params
      const params = new URLSearchParams({
        Country: country,
        Type: 'Local',
        SmsEnabled: 'true',
        VoiceEnabled: 'true'
      });

      if (ac) {
        params.append('AreaCode', ac);
      }

      if (contains) {
        params.append('Contains', contains);
      }

      console.log(`🔍 Searching for available Twilio phone numbers...`);
      console.log(`   Country: ${country}`);
      if (ac) console.log(`   Area Code: ${ac}`);

      const response = await axios.get(
        `${this.apiBaseUrl}/AvailablePhoneNumbers/${country}/Local.json?${params.toString()}`,
        {
          auth: {
            username: this.accountSid,
            password: this.authToken
          },
          timeout: 10000
        }
      );

      const numbers = response.data.available_phone_numbers || [];
      console.log(`✅ Found ${numbers.length} available phone numbers`);

      return numbers.map(num => ({
        phoneNumber: num.phone_number,
        friendlyName: num.friendly_name,
        capabilities: num.capabilities,
        locality: num.locality,
        region: num.region,
        postalCode: num.postal_code
      }));
    } catch (error) {
      console.error('❌ Failed to search available phone numbers:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Purchase a phone number from Twilio
   * @param {string} phoneNumber - Phone number to purchase (e.g., '+15551234567')
   * @param {string} webhookUrl - Webhook URL for voice calls
   * @returns {Promise<Object>} Purchased phone number details
   */
  async purchasePhoneNumber(phoneNumber, webhookUrl) {
    if (!this.isConfigured) {
      throw new Error('Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    }

    try {
      console.log(`📞 Purchasing Twilio phone number: ${phoneNumber}`);
      console.log(`   Webhook URL: ${webhookUrl}`);

      const params = new URLSearchParams({
        PhoneNumber: phoneNumber,
        VoiceUrl: webhookUrl,
        VoiceMethod: 'POST',
        SmsUrl: webhookUrl,
        SmsMethod: 'POST'
      });

      const response = await axios.post(
        `${this.apiBaseUrl}/IncomingPhoneNumbers.json`,
        params.toString(),
        {
          auth: {
            username: this.accountSid,
            password: this.authToken
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      const purchased = response.data;
      console.log(`✅ Successfully purchased phone number: ${purchased.phone_number}`);
      console.log(`   Phone SID: ${purchased.sid}`);

      return {
        sid: purchased.sid,
        phoneNumber: purchased.phone_number,
        friendlyName: purchased.friendly_name,
        capabilities: purchased.capabilities,
        voiceUrl: purchased.voice_url,
        smsUrl: purchased.sms_url,
        status: 'active'
      };
    } catch (error) {
      console.error('❌ Failed to purchase phone number:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Search with fallbacks: mobile area code → TRIAL_DEFAULT_AREA_CODE → nationwide.
   * @returns {Promise<{ numbers: Array, strategy: string }>}
   */
  async searchAvailableWithFallback(options = {}) {
    const { country = 'US', phoneE164 } = options;
    const preferred = options.areaCode != null
      ? (isValidUsAreaCode(String(options.areaCode)) ? String(options.areaCode) : null)
      : normalizeUsAreaCode(phoneE164);
    const defaultAc = process.env.TRIAL_DEFAULT_AREA_CODE
      ? String(process.env.TRIAL_DEFAULT_AREA_CODE).trim()
      : null;
    const fallbackAc = isValidUsAreaCode(defaultAc) ? defaultAc : null;

    const strategies = [];
    if (preferred) strategies.push({ areaCode: preferred, label: 'mobile_area_code' });
    if (fallbackAc && fallbackAc !== preferred) {
      strategies.push({ areaCode: fallbackAc, label: 'trial_default_area_code' });
    }
    strategies.push({ areaCode: null, label: 'nationwide' });

    for (const s of strategies) {
      const numbers = await this.searchAvailablePhoneNumbers({
        country,
        areaCode: s.areaCode
      });
      if (numbers.length > 0) {
        return { numbers, strategy: s.label };
      }
    }

    return { numbers: [], strategy: 'none' };
  }

  /**
   * Provision a phone number for a customer (search and purchase)
   * @param {Object} options - Provisioning options
   * @param {string} options.customerId - Customer ID
   * @param {string} options.areaCode - Area code preference (optional)
   * @param {string} options.phoneE164 - Mobile used for area-code preference (optional)
   * @param {string} options.webhookUrl - Webhook URL for voice calls
   * @returns {Promise<Object>} Provisioned phone number details
   */
  async provisionPhoneNumberForCustomer(options) {
    const { customerId, areaCode, phoneE164, webhookUrl } = options;

    if (!customerId) {
      throw new Error('Customer ID is required');
    }

    if (!webhookUrl) {
      throw new Error('Webhook URL is required');
    }

    try {
      const { numbers, strategy } = await this.searchAvailableWithFallback({
        country: 'US',
        areaCode: areaCode || null,
        phoneE164: phoneE164 || null
      });

      if (!numbers || numbers.length === 0) {
        throw new Error('No available phone numbers found in Twilio inventory');
      }

      console.log(`   Search strategy: ${strategy}`);

      const phoneNumber = numbers[0].phoneNumber;
      const purchased = await this.purchasePhoneNumber(phoneNumber, webhookUrl);

      console.log(`✅ Successfully provisioned phone number for customer ${customerId}:`);
      console.log(`   Phone: ${purchased.phoneNumber}`);
      console.log(`   SID: ${purchased.sid}`);

      return { ...purchased, searchStrategy: strategy };
    } catch (error) {
      console.error(`❌ Failed to provision phone number for customer ${customerId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update webhook URL for an existing phone number
   * @param {string} phoneSid - Twilio Phone SID
   * @param {string} webhookUrl - New webhook URL
   * @returns {Promise<Object>} Updated phone number details
   */
  async updatePhoneNumberWebhook(phoneSid, webhookUrl) {
    if (!this.isConfigured) {
      throw new Error('Twilio not configured');
    }

    try {
      console.log(`📞 Updating webhook for phone SID: ${phoneSid}`);
      console.log(`   New webhook URL: ${webhookUrl}`);

      const params = new URLSearchParams({
        VoiceUrl: webhookUrl,
        VoiceMethod: 'POST',
        SmsUrl: webhookUrl,
        SmsMethod: 'POST'
      });

      const response = await axios.post(
        `${this.apiBaseUrl}/IncomingPhoneNumbers/${phoneSid}.json`,
        params.toString(),
        {
          auth: {
            username: this.accountSid,
            password: this.authToken
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      console.log(`✅ Successfully updated webhook for phone SID: ${phoneSid}`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to update phone number webhook:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Release (delete) a phone number from Twilio account
   * @param {string} phoneSid - Twilio Phone SID
   * @returns {Promise<boolean>} Success status
   */
  async releasePhoneNumber(phoneSid) {
    if (!this.isConfigured) {
      throw new Error('Twilio not configured');
    }

    try {
      console.log(`📞 Releasing phone number SID: ${phoneSid}`);

      await axios.delete(
        `${this.apiBaseUrl}/IncomingPhoneNumbers/${phoneSid}.json`,
        {
          auth: {
            username: this.accountSid,
            password: this.authToken
          },
          timeout: 10000
        }
      );

      console.log(`✅ Successfully released phone number SID: ${phoneSid}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to release phone number:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Get phone number details
   * @param {string} phoneSid - Twilio Phone SID
   * @returns {Promise<Object>} Phone number details
   */
  async getPhoneNumber(phoneSid) {
    if (!this.isConfigured) {
      throw new Error('Twilio not configured');
    }

    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/IncomingPhoneNumbers/${phoneSid}.json`,
        {
          auth: {
            username: this.accountSid,
            password: this.authToken
          },
          timeout: 10000
        }
      );

      return {
        sid: response.data.sid,
        phoneNumber: response.data.phone_number,
        friendlyName: response.data.friendly_name,
        capabilities: response.data.capabilities,
        voiceUrl: response.data.voice_url,
        smsUrl: response.data.sms_url,
        status: response.data.status
      };
    } catch (error) {
      console.error('❌ Failed to get phone number:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', error.response.data);
      }
      throw error;
    }
  }
}

module.exports = TwilioPhoneService;
module.exports.extractUsAreaCodeFromE164 = extractUsAreaCodeFromE164;
module.exports.isValidUsAreaCode = isValidUsAreaCode;
module.exports.normalizeUsAreaCode = normalizeUsAreaCode;

