/**
 * PROVIDER DIRECTORY SERVICE
 * Finds healthcare providers that accept specific insurance payers
 * 
 * Note: Stedi doesn't have a provider directory API, so we use:
 * 1. Insurance company's own provider directory API (if available)
 * 2. Local database of provider-insurance relationships
 * 3. Eligibility checks to verify (requires provider NPI first)
 */

const axios = require('axios');
const db = require('../database');
const InsuranceService = require('./insurance-service');

class ProviderDirectoryService {
  /**
   * Find providers that accept a specific insurance payer
   * 
   * @param {Object} options - Search options
   * @param {string} options.payerId - Insurance payer ID (e.g., "BCBS", "AETNA")
   * @param {string} options.payerName - Insurance payer name (alternative to payerId)
   * @param {string} options.zipCode - Zip code for location-based search (optional)
   * @param {string} options.specialty - Provider specialty filter (optional)
   * @param {number} options.radius - Search radius in miles (optional, default: 25)
   * @param {number} options.limit - Maximum number of results (default: 50)
   * @returns {Object} List of providers
   */
  static async findProvidersByInsurance(options = {}) {
    try {
      console.log('\n🏥 PROVIDER DIRECTORY: Finding Providers by Insurance');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Payer ID:', options.payerId || options.payerName);
      console.log('Location:', options.zipCode || 'Not specified');
      console.log('Specialty:', options.specialty || 'Any');

      // Step 1: Resolve payer ID if only name provided
      let payerId = options.payerId;
      if (!payerId && options.payerName) {
        const payerSearch = await InsuranceService.searchPayer(options.payerName);
        if (payerSearch.success && payerSearch.payers.length > 0) {
          payerId = payerSearch.payers[0].payer_id;
          console.log(`   Resolved payer: ${options.payerName} → ${payerId}`);
        } else {
          return {
            success: false,
            providers: [],
            error: `Insurance payer not found: ${options.payerName}`
          };
        }
      }

      if (!payerId) {
        return {
          success: false,
          providers: [],
          error: 'Payer ID or payer name required'
        };
      }

      // Step 2: Check local database for provider-insurance relationships
      const localProviders = this._getProvidersFromDatabase(payerId, options);
      
      if (localProviders.length > 0) {
        console.log(`✅ Found ${localProviders.length} provider(s) in local database`);
        return {
          success: true,
          providers: localProviders,
          count: localProviders.length,
          source: 'local_database'
        };
      }

      // Step 3: Try insurance company's provider directory API (if available)
      const apiProviders = await this._searchInsuranceProviderDirectory(payerId, options);
      
      if (apiProviders.length > 0) {
        console.log(`✅ Found ${apiProviders.length} provider(s) via insurance API`);
        // Cache results in local database
        this._cacheProviders(payerId, apiProviders);
        return {
          success: true,
          providers: apiProviders,
          count: apiProviders.length,
          source: 'insurance_api'
        };
      }

      // Step 4: Return empty result with guidance
      console.log('⚠️  No providers found. Consider:');
      console.log('   1. Adding providers to local database');
      console.log('   2. Using insurance company\'s provider directory website');
      console.log('   3. Contacting insurance company directly');

      return {
        success: true,
        providers: [],
        count: 0,
        source: 'none',
        message: 'No providers found. Stedi does not provide a provider directory API.'
      };

    } catch (error) {
      console.error('❌ Error finding providers:', error.message);
      return {
        success: false,
        providers: [],
        error: error.message
      };
    }
  }

  /**
   * Get providers from local database that accept the specified payer
   * @private
   */
  static _getProvidersFromDatabase(payerId, options) {
    try {
      // Check if we have a provider_insurance_networks table
      // For now, we'll check appointments and clinics
      const query = `
        SELECT DISTINCT
          a.provider,
          a.clinic_id,
          c.name as clinic_name,
          c.address as clinic_address,
          c.phone_number as clinic_phone
        FROM appointments a
        LEFT JOIN clinics c ON a.clinic_id = c.clinic_id
        WHERE a.status IN ('scheduled', 'confirmed', 'completed')
        AND EXISTS (
          SELECT 1 FROM patient_insurance pi
          WHERE pi.payer_id = ?
          AND pi.patient_id = a.patient_id
        )
        LIMIT ?
      `;

      const limit = options.limit || 50;
      const results = db.prepare(query).all(payerId, limit);
      
      return results.map(row => ({
        provider_name: row.provider,
        clinic_id: row.clinic_id,
        clinic_name: row.clinic_name,
        address: row.clinic_address,
        phone: row.clinic_phone,
        accepts_insurance: true,
        verified: false // Not verified via API
      }));
    } catch (error) {
      console.warn('⚠️  Error querying local database:', error.message);
      return [];
    }
  }

  /**
   * Search insurance company's provider directory API
   * Note: This requires insurance-specific API integration
   * @private
   */
  static async _searchInsuranceProviderDirectory(payerId, options) {
    // TODO: Implement insurance-specific provider directory APIs
    // Each insurance company may have different endpoints:
    // - BCBS: Blue Cross Blue Shield provider finder API
    // - Aetna: Aetna provider directory API
    // - UHC: UnitedHealthcare provider directory API
    // - etc.
    
    // For now, return empty array
    // In production, you would:
    // 1. Map payerId to insurance company
    // 2. Call their specific provider directory API
    // 3. Parse and normalize results
    
    return [];
  }

  /**
   * Cache provider-insurance relationships in local database
   * @private
   */
  static _cacheProviders(payerId, providers) {
    // TODO: Create provider_insurance_networks table if it doesn't exist
    // Then cache the relationships for faster future lookups
    console.log('💾 Caching providers (not yet implemented)');
  }

  /**
   * Verify if a specific provider accepts a specific insurance
   * Uses eligibility check as verification method
   * 
   * @param {Object} options
   * @param {string} options.providerNpi - Provider NPI number
   * @param {string} options.payerId - Insurance payer ID
   * @param {string} options.memberId - Patient member ID (optional, for verification)
   * @returns {Object} Verification result
   */
  static async verifyProviderAcceptsInsurance(options) {
    try {
      console.log('\n🔍 PROVIDER DIRECTORY: Verifying Provider Accepts Insurance');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Provider NPI:', options.providerNpi);
      console.log('Payer ID:', options.payerId);

      // Option 1: Check local database
      const localCheck = this._checkLocalDatabase(options.providerNpi, options.payerId);
      if (localCheck.found) {
        return {
          success: true,
          accepts: localCheck.accepts,
          verified: localCheck.verified,
          source: 'local_database'
        };
      }

      // Option 2: Perform eligibility check (requires member ID)
      if (options.memberId) {
        const eligibilityCheck = await InsuranceService.checkEligibility({
          memberId: options.memberId,
          payerId: options.payerId,
          providerNpi: options.providerNpi,
          serviceCode: '90834', // Default mental health code
          dateOfService: new Date().toISOString().split('T')[0]
        });

        if (eligibilityCheck.success && eligibilityCheck.eligible) {
          return {
            success: true,
            accepts: true,
            verified: true,
            source: 'eligibility_check',
            eligibility: eligibilityCheck
          };
        }
      }

      // Option 3: Return unknown
      return {
        success: true,
        accepts: null,
        verified: false,
        source: 'unknown',
        message: 'Could not verify. Provider directory lookup not available via Stedi.'
      };

    } catch (error) {
      console.error('❌ Error verifying provider:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check local database for provider-insurance relationship
   * @private
   */
  static _checkLocalDatabase(providerNpi, payerId) {
    // TODO: Query provider_insurance_networks table
    return {
      found: false,
      accepts: null,
      verified: false
    };
  }
}

module.exports = ProviderDirectoryService;

