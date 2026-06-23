/**
 * STRIPE ISSUING SERVICE
 * 
 * Handles Stripe Issuing API integration for creating cardholders and issuing virtual cards
 * for patients in the Somo platform.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { v4: uuidv4 } = require('uuid');

class StripeIssuingService {
  constructor() {
    this.stripe = stripe;
    this.isEnabled = !!process.env.STRIPE_SECRET_KEY;
    
    if (!this.isEnabled) {
      console.warn('⚠️  Stripe Issuing: STRIPE_SECRET_KEY not configured. Running in mock mode.');
    }
  }

  /**
   * Create a cardholder for a patient
   * @param {Object} patientData - Patient data from FHIR
   * @param {Object} options - Additional options (clinic_id, billing_address, etc.)
   * @returns {Object} Cardholder creation result
   */
  async createCardholder(patientData, options = {}) {
    if (!this.isEnabled) {
      console.warn('⚠️  Stripe Issuing: Mock mode - cardholder creation skipped');
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured'
      };
    }

    try {
      // Extract patient information
      const name = patientData.name || `${patientData.firstName || ''} ${patientData.lastName || ''}`.trim();
      const email = patientData.email || options.email || null;
      const phone = patientData.phone || options.phone || null;
      
      // Build billing address from patient data or options
      const billingAddress = options.billing_address || this._extractBillingAddress(patientData);

      // Create cardholder payload
      const cardholderData = {
        type: 'individual',
        name: name,
        email: email,
        phone_number: phone,
        billing: {
          address: billingAddress
        },
        metadata: {
          patient_id: patientData.id || patientData.resource_id,
          clinic_id: options.clinic_id || null,
          created_by: 'somo-platform'
        }
      };

      // Add individual-specific fields if available
      if (patientData.firstName && patientData.lastName) {
        cardholderData.individual = {
          first_name: patientData.firstName,
          last_name: patientData.lastName
        };
        
        // Add date of birth if available
        if (patientData.birthDate) {
          cardholderData.individual.dob = {
            day: parseInt(patientData.birthDate.split('-')[2]) || 1,
            month: parseInt(patientData.birthDate.split('-')[1]) || 1,
            year: parseInt(patientData.birthDate.split('-')[0]) || 1990
          };
        }

        // Add user terms acceptance (required for card issuance)
        // In test mode, we can use a test IP and current date
        cardholderData.individual.card_issuing = {
          user_terms_acceptance: {
            date: Math.floor(Date.now() / 1000), // Current timestamp
            ip: options.user_ip || '127.0.0.1' // Test IP or provided IP
          }
        };
      }

      console.log(`💳 Creating Stripe cardholder for patient: ${name}`);
      
      const cardholder = await this.stripe.issuing.cardholders.create(cardholderData);

      console.log(`✅ Stripe cardholder created: ${cardholder.id}`);

      return {
        success: true,
        cardholder_id: cardholder.id,
        cardholder: cardholder
      };
    } catch (error) {
      console.error('❌ Failed to create Stripe cardholder:', error.message);
      return {
        success: false,
        error: error.message,
        error_details: error.type || null
      };
    }
  }

  /**
   * Issue a virtual card for a cardholder
   * @param {string} cardholderId - Stripe cardholder ID
   * @param {Object} options - Card options (spending_controls, currency, etc.)
   * @returns {Object} Card creation result
   */
  async issueVirtualCard(cardholderId, options = {}) {
    if (!this.isEnabled) {
      console.warn('⚠️  Stripe Issuing: Mock mode - card creation skipped');
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured',
        mock_card_id: `card_mock_${uuidv4()}`
      };
    }

    try {
      // Default spending controls
      const defaultSpendingControls = {
        spending_limits: [
          {
            amount: options.spending_limit || 100000, // $1,000 in cents (default)
            interval: options.spending_interval || 'all_time'
          }
        ],
        allowed_categories: options.allowed_categories || null,
        blocked_categories: options.blocked_categories || null
      };

      // Create card payload
      const cardData = {
        cardholder: cardholderId,
        currency: options.currency || 'usd',
        type: 'virtual',
        status: 'active',
        spending_controls: defaultSpendingControls,
        metadata: {
          patient_id: options.patient_id || null,
          clinic_id: options.clinic_id || null,
          created_by: 'somo-platform'
        }
      };

      console.log(`💳 Issuing virtual card for cardholder: ${cardholderId}`);
      
      const card = await this.stripe.issuing.cards.create(cardData);

      console.log(`✅ Virtual card issued: ${card.id} (****${card.last4})`);

      return {
        success: true,
        card_id: card.id,
        card: card,
        last4: card.last4,
        brand: card.brand,
        expiry_month: card.exp?.exp_month || card.exp_month || null,
        expiry_year: card.exp?.exp_year || card.exp_year || null
      };
    } catch (error) {
      console.error('❌ Failed to issue virtual card:', error.message);
      return {
        success: false,
        error: error.message,
        error_details: error.type || null
      };
    }
  }

  /**
   * Create cardholder and issue virtual card for a patient (convenience method)
   * @param {Object} patientData - Patient data from FHIR
   * @param {Object} options - Additional options
   * @returns {Object} Cardholder and card creation result
   */
  async createCardholderAndCard(patientData, options = {}) {
    // Step 1: Create cardholder
    const cardholderResult = await this.createCardholder(patientData, options);
    
    if (!cardholderResult.success) {
      return cardholderResult;
    }

    // Step 2: Issue virtual card
    const cardResult = await this.issueVirtualCard(cardholderResult.cardholder_id, {
      patient_id: patientData.id || patientData.resource_id,
      clinic_id: options.clinic_id || null,
      spending_limit: options.spending_limit || 100000,
      spending_interval: options.spending_interval || 'all_time',
      currency: options.currency || 'usd',
      allowed_categories: options.allowed_categories || null,
      blocked_categories: options.blocked_categories || null
    });

    if (!cardResult.success) {
      // Card creation failed, but cardholder was created
      return {
        success: false,
        cardholder_id: cardholderResult.cardholder_id,
        error: `Cardholder created but card creation failed: ${cardResult.error}`
      };
    }

    return {
      success: true,
      cardholder_id: cardholderResult.cardholder_id,
      card_id: cardResult.card_id,
      card: cardResult.card,
      last4: cardResult.last4,
      brand: cardResult.brand,
      expiry_month: cardResult.expiry_month,
      expiry_year: cardResult.expiry_year
    };
  }

  /**
   * Update card spending controls
   * @param {string} cardId - Stripe card ID
   * @param {Object} spendingControls - New spending controls
   * @returns {Object} Update result
   */
  async updateCardSpendingControls(cardId, spendingControls) {
    if (!this.isEnabled) {
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured'
      };
    }

    try {
      // Clean spending controls - remove any invalid parameters
      const cleanControls = JSON.parse(JSON.stringify(spendingControls));
      // Remove any currency-related fields that might cause issues
      if (cleanControls.spending_limits) {
        cleanControls.spending_limits = cleanControls.spending_limits.map(limit => {
          const cleanLimit = { ...limit };
          delete cleanLimit.currency;
          delete cleanLimit.spending_limits_currency;
          return cleanLimit;
        });
      }
      delete cleanControls.spending_limits_currency;
      
      const card = await this.stripe.issuing.cards.update(cardId, {
        spending_controls: cleanControls
      });

      return {
        success: true,
        card: card
      };
    } catch (error) {
      console.error('❌ Failed to update card spending controls:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get card details (including PAN and CVC for virtual cards)
   * @param {string} cardId - Stripe card ID
   * @returns {Object} Card details
   */
  async getCardDetails(cardId) {
    if (!this.isEnabled) {
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured'
      };
    }

    try {
      // Retrieve card
      const card = await this.stripe.issuing.cards.retrieve(cardId);
      
      // For virtual cards, retrieve PAN and CVC
      let pan = null;
      let cvc = null;
      
      if (card.type === 'virtual') {
        try {
          const cardDetails = await this.stripe.issuing.cards.retrieve(cardId, {
            expand: ['number', 'cvc']
          });
          pan = cardDetails.number;
          cvc = cardDetails.cvc;
        } catch (detailError) {
          // PAN/CVC might not be available in test mode or for security reasons
          console.warn('⚠️  Could not retrieve PAN/CVC for card:', detailError.message);
        }
      }

      return {
        success: true,
        card: card,
        pan: pan,
        cvc: cvc,
        last4: card.last4,
        brand: card.brand,
        expiry_month: card.exp?.exp_month || card.exp_month || null,
        expiry_year: card.exp?.exp_year || card.exp_year || null
      };
    } catch (error) {
      console.error('❌ Failed to get card details:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel a card
   * @param {string} cardId - Stripe card ID
   * @returns {Object} Cancellation result
   */
  async cancelCard(cardId) {
    if (!this.isEnabled) {
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured'
      };
    }

    try {
      const card = await this.stripe.issuing.cards.update(cardId, {
        status: 'canceled'
      });

      return {
        success: true,
        card: card
      };
    } catch (error) {
      console.error('❌ Failed to cancel card:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract billing address from patient data
   * @param {Object} patientData - Patient data from FHIR
   * @returns {Object} Billing address object
   */
  _extractBillingAddress(patientData) {
    // Default address (required by Stripe)
    const defaultAddress = {
      line1: '123 Main St',
      city: 'New York',
      state: 'NY',
      postal_code: '10001',
      country: 'US'
    };

      // Try to extract from FHIR address
      if (patientData.address && patientData.address.length > 0) {
        const address = patientData.address[0];
        const addressObj = {
          line1: address.line?.[0] || defaultAddress.line1,
          city: address.city || defaultAddress.city,
          state: address.state || defaultAddress.state,
          postal_code: address.postalCode || defaultAddress.postal_code,
          country: address.country || defaultAddress.country
        };
        // Only include line2 if it exists and is not empty
        if (address.line?.[1] && address.line[1].trim()) {
          addressObj.line2 = address.line[1];
        }
        return addressObj;
      }

    // Try to extract from resource_data if it's a FHIR resource
    if (patientData.resource_data) {
      try {
        const resourceData = typeof patientData.resource_data === 'string' 
          ? JSON.parse(patientData.resource_data) 
          : patientData.resource_data;
        
        if (resourceData.address && resourceData.address.length > 0) {
          const address = resourceData.address[0];
          const addressObj = {
            line1: address.line?.[0] || defaultAddress.line1,
            city: address.city || defaultAddress.city,
            state: address.state || defaultAddress.state,
            postal_code: address.postalCode || defaultAddress.postal_code,
            country: address.country || defaultAddress.country
          };
          // Only include line2 if it exists and is not empty
          if (address.line?.[1] && address.line[1].trim()) {
            addressObj.line2 = address.line[1];
          }
          return addressObj;
        }
      } catch (parseError) {
        console.warn('⚠️  Could not parse resource_data for address:', parseError.message);
      }
    }

    // Return default address
    return defaultAddress;
  }

  /**
   * Set spending limit for a card (e.g., $1,000)
   * @param {string} cardId - Stripe card ID
   * @param {number} amount - Amount in cents
   * @param {string} interval - 'all_time', 'daily', 'weekly', 'monthly', 'yearly'
   * @returns {Object} Update result
   */
  async setSpendingLimit(cardId, amount, interval = 'all_time') {
    if (!this.isEnabled) {
      return {
        success: false,
        mock: true,
        error: 'Stripe Issuing not configured'
      };
    }

    try {
      const card = await this.stripe.issuing.cards.retrieve(cardId);
      const currentControls = card.spending_controls || {};
      
      const updatedControls = {
        ...currentControls,
        spending_limits: [
          {
            amount: amount,
            interval: interval
          }
        ]
      };

      return await this.updateCardSpendingControls(cardId, updatedControls);
    } catch (error) {
      console.error('❌ Failed to set spending limit:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = StripeIssuingService;

