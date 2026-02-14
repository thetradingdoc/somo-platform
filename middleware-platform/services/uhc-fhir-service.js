/**
 * UHC FHIR SERVICE
 * Integrates with UHC FLEX FHIR API to pull provider directory, patient data, coverage, claims, etc.
 * 
 * This service attempts to pull all available data types from UHC FHIR sandbox/production.
 * Requires OAuth 2.0 credentials from UHC.
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { getOrCreate, FHIR } = require('../utils/circuit-breaker');

const fhirBreaker = getOrCreate(FHIR, { failureThreshold: 3, windowMs: 30000, resetTimeMs: 30000 });

class UHCFHIRService {
  // UHC FHIR API Configuration
  static OAUTH_URL = process.env.UHC_OAUTH_URL || 'https://flex.optum.com/authz';
  static FHIR_BASE = process.env.UHC_FHIR_BASE || 'https://flex.optum.com/fhir/R4';
  static FHIR_SANDBOX = process.env.UHC_FHIR_SANDBOX || 'https://flex.optum.com/fhir/sandbox/R4';
  static FHIR_PUBLIC = process.env.UHC_FHIR_PUBLIC || 'https://flex.optum.com/fhirpublic';
  
  // OAuth Credentials (from environment or UHC registration)
  static CLIENT_ID = process.env.UHC_CLIENT_ID || null;
  static CLIENT_SECRET = process.env.UHC_CLIENT_SECRET || null;
  
  // Token cache
  static tokenCache = {
    accessToken: null,
    expiresAt: null,
    tokenType: 'Bearer'
  };

  /**
   * Get OAuth access token
   * Uses client credentials flow
   */
  static async getAccessToken() {
    try {
      // Check if we have valid cached token
      if (this.tokenCache.accessToken && this.tokenCache.expiresAt) {
        const now = Date.now();
        // Refresh if expires in less than 5 minutes
        if (now < (this.tokenCache.expiresAt - 300000)) {
          return this.tokenCache.accessToken;
        }
      }

      // Validate credentials
      if (!this.CLIENT_ID || !this.CLIENT_SECRET) {
        throw new Error('UHC OAuth credentials not configured. Set UHC_CLIENT_ID and UHC_CLIENT_SECRET environment variables.');
      }

      console.log('\n🔐 UHC FHIR: Getting OAuth Token');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('OAuth URL:', this.OAUTH_URL);

      // Request token using client credentials flow (Section 2.1: circuit breaker)
      const tokenResponse = await fhirBreaker.execute(
        () => axios.post(
          `${this.OAUTH_URL}/oauth/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.CLIENT_ID,
          client_secret: this.CLIENT_SECRET,
          scope: 'patient/Coverage.read patient/Patient.read patient/Condition.read patient/MedicationStatement.read patient/AllergyIntolerance.read patient/Organization.read patient/Practitioner.read patient/Claim.read patient/ExplanationOfBenefit.read'
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 30000
        }
      ),
        () => { throw new Error('UHC FHIR unavailable (circuit open)'); }
      );

      if (tokenResponse.data && tokenResponse.data.access_token) {
        this.tokenCache.accessToken = tokenResponse.data.access_token;
        this.tokenCache.tokenType = tokenResponse.data.token_type || 'Bearer';
        // Set expiration (default to 1 hour if not provided)
        const expiresIn = tokenResponse.data.expires_in || 3600;
        this.tokenCache.expiresAt = Date.now() + (expiresIn * 1000);

        console.log('✅ OAuth token obtained');
        console.log('   Token expires in:', expiresIn, 'seconds');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return this.tokenCache.accessToken;
      } else {
        throw new Error('Invalid token response from UHC OAuth');
      }

    } catch (error) {
      console.error('❌ UHC OAuth Error:', error.message);
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Response:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Get FHIR API client with OAuth authentication
   * @param {boolean} useSandbox - Use sandbox endpoint instead of production
   */
  static async getFHIRClient(useSandbox = false) {
    const baseURL = useSandbox ? this.FHIR_SANDBOX : this.FHIR_BASE;
    
    try {
      const accessToken = await this.getAccessToken();
      
      return axios.create({
        baseURL: baseURL,
        headers: {
          'Authorization': `${this.tokenCache.tokenType} ${accessToken}`,
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        timeout: 30000
      });
    } catch (error) {
      // If OAuth fails, return client without auth (for public endpoints)
      console.warn('⚠️  OAuth failed, using unauthenticated client');
      return axios.create({
        baseURL: baseURL,
        headers: {
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        timeout: 30000
      });
    }
  }

  /**
   * Pull Provider Directory Data
   * Gets Organization, Practitioner, Location, and PractitionerRole resources
   */
  static async pullProviderDirectory(options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling Provider Directory');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const useSandbox = options.useSandbox !== false; // Default to sandbox
      const zipCode = options.zipCode || null;
      const specialty = options.specialty || null;
      const limit = options.limit || 50;

      const client = await this.getFHIRClient(useSandbox);
      const results = {
        organizations: [],
        practitioners: [],
        locations: [],
        practitionerRoles: [],
        errors: []
      };

      // 1. Search Organizations (Provider Organizations)
      try {
        console.log('   Searching Organizations...');
        let orgUrl = '/Organization?_count=' + limit;
        if (zipCode) {
          orgUrl += '&address-postalcode=' + zipCode;
        }
        
        const orgResponse = await client.get(orgUrl);
        if (orgResponse.data && orgResponse.data.entry) {
          results.organizations = orgResponse.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.organizations.length} organizations`);
        }
      } catch (error) {
        const errorMsg = `Organization search failed: ${error.message}`;
        console.warn('   ⚠️  ' + errorMsg);
        results.errors.push(errorMsg);
      }

      // 2. Search Practitioners (Individual Providers)
      try {
        console.log('   Searching Practitioners...');
        let pracUrl = '/Practitioner?_count=' + limit;
        if (specialty) {
          pracUrl += '&specialty=' + specialty;
        }
        
        const pracResponse = await client.get(pracUrl);
        if (pracResponse.data && pracResponse.data.entry) {
          results.practitioners = pracResponse.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.practitioners.length} practitioners`);
        }
      } catch (error) {
        const errorMsg = `Practitioner search failed: ${error.message}`;
        console.warn('   ⚠️  ' + errorMsg);
        results.errors.push(errorMsg);
      }

      // 3. Search Locations (Provider Locations)
      try {
        console.log('   Searching Locations...');
        let locUrl = '/Location?_count=' + limit;
        if (zipCode) {
          locUrl += '&address-postalcode=' + zipCode;
        }
        
        const locResponse = await client.get(locUrl);
        if (locResponse.data && locResponse.data.entry) {
          results.locations = locResponse.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.locations.length} locations`);
        }
      } catch (error) {
        const errorMsg = `Location search failed: ${error.message}`;
        console.warn('   ⚠️  ' + errorMsg);
        results.errors.push(errorMsg);
      }

      // 4. Search PractitionerRoles (Provider-Specialty relationships)
      try {
        console.log('   Searching PractitionerRoles...');
        const roleResponse = await client.get('/PractitionerRole?_count=' + limit);
        if (roleResponse.data && roleResponse.data.entry) {
          results.practitionerRoles = roleResponse.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.practitionerRoles.length} practitioner roles`);
        }
      } catch (error) {
        const errorMsg = `PractitionerRole search failed: ${error.message}`;
        console.warn('   ⚠️  ' + errorMsg);
        results.errors.push(errorMsg);
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.errors.length === 0 || (results.organizations.length > 0 || results.practitioners.length > 0),
        data: results,
        totalProviders: results.organizations.length + results.practitioners.length,
        errors: results.errors
      };

    } catch (error) {
      console.error('❌ Error pulling provider directory:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Pull Patient Clinical Data
   * Gets Condition, MedicationStatement, AllergyIntolerance, Immunization, Observation, Procedure
   */
  static async pullPatientClinicalData(patientId, options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling Patient Clinical Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Patient ID:', patientId);

      const useSandbox = options.useSandbox !== false;
      const client = await this.getFHIRClient(useSandbox);
      const results = {
        conditions: [],
        medications: [],
        allergies: [],
        immunizations: [],
        observations: [],
        procedures: [],
        carePlans: [],
        errors: []
      };

      // 1. Get Conditions (Diagnoses)
      try {
        console.log('   Fetching Conditions...');
        const response = await client.get(`/Condition?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.conditions = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.conditions.length} conditions`);
        }
      } catch (error) {
        results.errors.push(`Conditions failed: ${error.message}`);
        console.warn('   ⚠️  Conditions fetch failed');
      }

      // 2. Get Medication Statements
      try {
        console.log('   Fetching Medications...');
        const response = await client.get(`/MedicationStatement?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.medications = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.medications.length} medications`);
        }
      } catch (error) {
        results.errors.push(`Medications failed: ${error.message}`);
        console.warn('   ⚠️  Medications fetch failed');
      }

      // 3. Get Allergies
      try {
        console.log('   Fetching Allergies...');
        const response = await client.get(`/AllergyIntolerance?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.allergies = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.allergies.length} allergies`);
        }
      } catch (error) {
        results.errors.push(`Allergies failed: ${error.message}`);
        console.warn('   ⚠️  Allergies fetch failed');
      }

      // 4. Get Immunizations
      try {
        console.log('   Fetching Immunizations...');
        const response = await client.get(`/Immunization?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.immunizations = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.immunizations.length} immunizations`);
        }
      } catch (error) {
        results.errors.push(`Immunizations failed: ${error.message}`);
        console.warn('   ⚠️  Immunizations fetch failed');
      }

      // 5. Get Observations (Lab results, vitals)
      try {
        console.log('   Fetching Observations...');
        const response = await client.get(`/Observation?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.observations = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.observations.length} observations`);
        }
      } catch (error) {
        results.errors.push(`Observations failed: ${error.message}`);
        console.warn('   ⚠️  Observations fetch failed');
      }

      // 6. Get Procedures
      try {
        console.log('   Fetching Procedures...');
        const response = await client.get(`/Procedure?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.procedures = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.procedures.length} procedures`);
        }
      } catch (error) {
        results.errors.push(`Procedures failed: ${error.message}`);
        console.warn('   ⚠️  Procedures fetch failed');
      }

      // 7. Get Care Plans
      try {
        console.log('   Fetching Care Plans...');
        const response = await client.get(`/CarePlan?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.carePlans = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.carePlans.length} care plans`);
        }
      } catch (error) {
        results.errors.push(`Care Plans failed: ${error.message}`);
        console.warn('   ⚠️  Care Plans fetch failed');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.errors.length < results.conditions.length + results.medications.length,
        data: results,
        errors: results.errors
      };

    } catch (error) {
      console.error('❌ Error pulling patient clinical data:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Pull Coverage Information
   * Gets Coverage and CoverageEligibilityResponse resources
   */
  static async pullCoverageData(patientId, options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling Coverage Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Patient ID:', patientId);

      const useSandbox = options.useSandbox !== false;
      const client = await this.getFHIRClient(useSandbox);
      const results = {
        coverage: [],
        eligibilityResponses: [],
        errors: []
      };

      // 1. Get Coverage resources
      try {
        console.log('   Fetching Coverage...');
        const response = await client.get(`/Coverage?beneficiary=Patient/${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.coverage = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.coverage.length} coverage records`);
        }
      } catch (error) {
        results.errors.push(`Coverage failed: ${error.message}`);
        console.warn('   ⚠️  Coverage fetch failed');
      }

      // 2. Get CoverageEligibilityResponse
      try {
        console.log('   Fetching Eligibility Responses...');
        const response = await client.get(`/CoverageEligibilityResponse?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.eligibilityResponses = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.eligibilityResponses.length} eligibility responses`);
        }
      } catch (error) {
        results.errors.push(`Eligibility Responses failed: ${error.message}`);
        console.warn('   ⚠️  Eligibility Responses fetch failed');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.errors.length === 0 || results.coverage.length > 0,
        data: results,
        errors: results.errors
      };

    } catch (error) {
      console.error('❌ Error pulling coverage data:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Pull Claims and EOB Data
   * Gets Claim, ClaimResponse, and ExplanationOfBenefit resources
   */
  static async pullClaimsData(patientId, options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling Claims & EOB Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Patient ID:', patientId);

      const useSandbox = options.useSandbox !== false;
      const client = await this.getFHIRClient(useSandbox);
      const results = {
        claims: [],
        claimResponses: [],
        eobs: [],
        errors: []
      };

      // 1. Get Claims
      try {
        console.log('   Fetching Claims...');
        const response = await client.get(`/Claim?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.claims = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.claims.length} claims`);
        }
      } catch (error) {
        results.errors.push(`Claims failed: ${error.message}`);
        console.warn('   ⚠️  Claims fetch failed');
      }

      // 2. Get Claim Responses
      try {
        console.log('   Fetching Claim Responses...');
        const response = await client.get(`/ClaimResponse?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.claimResponses = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.claimResponses.length} claim responses`);
        }
      } catch (error) {
        results.errors.push(`Claim Responses failed: ${error.message}`);
        console.warn('   ⚠️  Claim Responses fetch failed');
      }

      // 3. Get Explanation of Benefits
      try {
        console.log('   Fetching EOBs...');
        const response = await client.get(`/ExplanationOfBenefit?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.eobs = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.eobs.length} EOBs`);
        }
      } catch (error) {
        results.errors.push(`EOBs failed: ${error.message}`);
        console.warn('   ⚠️  EOBs fetch failed');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.errors.length === 0 || results.claims.length > 0 || results.eobs.length > 0,
        data: results,
        errors: results.errors
      };

    } catch (error) {
      console.error('❌ Error pulling claims data:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Pull Prior Authorization Data
   * Gets ServiceRequest and Task resources for prior auth
   */
  static async pullPriorAuthData(patientId, options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling Prior Authorization Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Patient ID:', patientId);

      const useSandbox = options.useSandbox !== false;
      const client = await this.getFHIRClient(useSandbox);
      const results = {
        serviceRequests: [],
        tasks: [],
        errors: []
      };

      // 1. Get Service Requests (Prior Auth Requests)
      try {
        console.log('   Fetching Service Requests...');
        const response = await client.get(`/ServiceRequest?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.serviceRequests = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.serviceRequests.length} service requests`);
        }
      } catch (error) {
        results.errors.push(`Service Requests failed: ${error.message}`);
        console.warn('   ⚠️  Service Requests fetch failed');
      }

      // 2. Get Tasks (Prior Auth Workflow)
      try {
        console.log('   Fetching Tasks...');
        const response = await client.get(`/Task?patient=${patientId}&_count=100`);
        if (response.data && response.data.entry) {
          results.tasks = response.data.entry.map(entry => entry.resource).filter(Boolean);
          console.log(`   ✅ Found ${results.tasks.length} tasks`);
        }
      } catch (error) {
        results.errors.push(`Tasks failed: ${error.message}`);
        console.warn('   ⚠️  Tasks fetch failed');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.errors.length === 0 || results.serviceRequests.length > 0,
        data: results,
        errors: results.errors
      };

    } catch (error) {
      console.error('❌ Error pulling prior auth data:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Pull ALL available data for a patient
   * Comprehensive data pull - tries everything
   */
  static async pullAllPatientData(patientId, options = {}) {
    try {
      console.log('\n🏥 UHC FHIR: Pulling ALL Patient Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Patient ID:', patientId);
      console.log('Use Sandbox:', options.useSandbox !== false);

      const results = {
        providerDirectory: null,
        clinicalData: null,
        coverage: null,
        claims: null,
        priorAuth: null,
        summary: {
          totalResources: 0,
          errors: []
        }
      };

      // Pull all data types
      results.providerDirectory = await this.pullProviderDirectory(options);
      results.clinicalData = await this.pullPatientClinicalData(patientId, options);
      results.coverage = await this.pullCoverageData(patientId, options);
      results.claims = await this.pullClaimsData(patientId, options);
      results.priorAuth = await this.pullPriorAuthData(patientId, options);

      // Calculate summary
      if (results.clinicalData && results.clinicalData.data) {
        const cd = results.clinicalData.data;
        results.summary.totalResources += 
          cd.conditions.length + cd.medications.length + cd.allergies.length +
          cd.immunizations.length + cd.observations.length + cd.procedures.length + cd.carePlans.length;
      }
      if (results.coverage && results.coverage.data) {
        results.summary.totalResources += 
          results.coverage.data.coverage.length + results.coverage.data.eligibilityResponses.length;
      }
      if (results.claims && results.claims.data) {
        results.summary.totalResources += 
          results.claims.data.claims.length + results.claims.data.claimResponses.length + results.claims.data.eobs.length;
      }
      if (results.priorAuth && results.priorAuth.data) {
        results.summary.totalResources += 
          results.priorAuth.data.serviceRequests.length + results.priorAuth.data.tasks.length;
      }

      // Collect all errors
      [
        results.providerDirectory,
        results.clinicalData,
        results.coverage,
        results.claims,
        results.priorAuth
      ].forEach(result => {
        if (result && result.errors) {
          results.summary.errors.push(...result.errors);
        }
      });

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 SUMMARY');
      console.log('   Total Resources:', results.summary.totalResources);
      console.log('   Errors:', results.summary.errors.length);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: results.summary.errors.length < results.summary.totalResources,
        data: results,
        summary: results.summary
      };

    } catch (error) {
      console.error('❌ Error pulling all patient data:', error.message);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Test connection to UHC FHIR API
   * Tries to access metadata endpoint (public, no auth required)
   */
  static async testConnection(useSandbox = true) {
    try {
      console.log('\n🔍 UHC FHIR: Testing Connection');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const baseURL = useSandbox ? this.FHIR_SANDBOX : this.FHIR_BASE;
      console.log('Testing:', baseURL);

      // Try public metadata endpoint (no auth required) - Section 2.1: circuit breaker
      try {
        const response = await fhirBreaker.execute(
          () => axios.get(`${baseURL}/metadata`, {
            headers: { 'Accept': 'application/fhir+json' },
            timeout: 10000
          }),
          () => { throw new Error('UHC FHIR unavailable (circuit open)'); }
        );

        console.log('✅ Connection successful!');
        console.log('   Status:', response.status);
        if (response.data && response.data.resourceType === 'CapabilityStatement') {
          console.log('   FHIR Version:', response.data.fhirVersion);
          console.log('   Software:', response.data.software?.name || 'Unknown');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return {
          success: true,
          endpoint: baseURL,
          metadata: response.data
        };
      } catch (error) {
        console.error('❌ Connection failed:', error.message);
        if (error.response) {
          console.error('   Status:', error.response.status);
          console.error('   Response:', error.response.data);
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return {
          success: false,
          endpoint: baseURL,
          error: error.message,
          status: error.response?.status
        };
      }

    } catch (error) {
      console.error('❌ Test connection error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = UHCFHIRService;










