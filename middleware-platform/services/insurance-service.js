/**
 * INSURANCE SERVICE
 * Integrates with Stedi API for healthcare insurance operations
 * Handles X12 EDI transactions for eligibility checks and claim submission
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { getOrCreate, STEDI } = require('../utils/circuit-breaker');
const secureLogger = require('./secure-logger');
const { redactForLog } = require('./log-redaction');

const stediBreaker = getOrCreate(STEDI, { failureThreshold: 5, windowMs: 60000, resetTimeMs: 30000 });

function classifyEligibilityQuality(response = {}) {
  if (response._simulate === true || response.eligibility_source === 'simulate') return 'simulate';
  if (!response || response.eligible === false) return 'inactive';
  const copay = response.copay;
  const hasCopay = copay !== null && copay !== undefined && !Number.isNaN(Number(copay));
  const hasBenefitDepth =
    hasCopay ||
    response.allowedAmount > 0 ||
    response.deductibleRemaining != null ||
    (response.planSummary && typeof response.planSummary === 'object' && Object.keys(response.planSummary).length > 0);
  if (hasCopay && response.eligible) return 'hard_copay';
  if (response.eligible && !hasBenefitDepth) return 'thin';
  if (response.eligible) return 'hard_copay';
  return 'thin';
}

class InsuranceService {
  // Stedi API Configuration (translate fallback on core; eligibility/claims on healthcare)
  static STEDI_API_BASE = process.env.STEDI_API_BASE || 'https://core.us.stedi.com';

  static resolveStediApiKey() {
    const key = String(process.env.STEDI_API_KEY || '').trim();
    if (key) return key;
    const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
    const isTest = nodeEnv === 'test' || process.env.JEST_WORKER_ID != null;
    if (isTest && process.env.STEDI_TEST_MODE !== '0') {
      return 'test_stedi_key_for_jest';
    }
    return '';
  }

  static STEDI_API_KEY = InsuranceService.resolveStediApiKey();
  static STEDI_ELIGIBILITY_V3_PATH =
    process.env.STEDI_ELIGIBILITY_V3_PATH || '/2024-04-01/change/medicalnetwork/eligibility/v3';

  /** Stedi expects raw API key or `Key <token>` — not `Bearer` (Healthcare returns 403 with Bearer). */
  static getStediAuthorizationHeader() {
    const key = String(this.STEDI_API_KEY || '').trim();
    if (!key) return '';
    if (key.startsWith('Bearer ') || key.startsWith('Key ')) return key;
    return key;
  }

  /**
   * Get Stedi API client with authentication
   */
  static getStediClient() {
    return axios.create({
      baseURL: this.STEDI_API_BASE,
      headers: {
        Authorization: this.getStediAuthorizationHeader(),
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
  }

  /** @returns {'professional'|'institutional'} */
  static getStediClaimSubmissionMode() {
    const mode = String(process.env.STEDI_CLAIM_SUBMISSION_MODE || '').trim().toLowerCase();
    if (mode === 'professional' || process.env.STEDI_USE_PROFESSIONAL_CLAIMS === '1') {
      return 'professional';
    }
    return 'institutional';
  }

  static getStediClaimApiPaths() {
    const base = '/2024-04-01/change/medicalnetwork';
    if (this.getStediClaimSubmissionMode() === 'professional') {
      return {
        submit: `${base}/professionalclaims/v1/raw-x12-submission`,
        status: (claimId) => `${base}/professionalclaims/v1/${encodeURIComponent(claimId)}`
      };
    }
    return {
      submit: `${base}/institutionalclaims/v1/raw-x12-submission`,
      status: (claimId) => `${base}/institutionalclaims/v1/${encodeURIComponent(claimId)}`
    };
  }

  static hasRealStediKey() {
    return Boolean(this.STEDI_API_KEY && !String(this.STEDI_API_KEY).startsWith('test_'));
  }

  static isStediTestMode() {
    const flag = String(process.env.STEDI_TEST_MODE || '').trim().toLowerCase();
    if (flag === '0' || flag === 'false') return false;
    if (flag === '1' || flag === 'true') return true;
    return String(this.STEDI_API_KEY || '').startsWith('test_');
  }

  /** Production-like key, or test key with STEDI_TEST_MODE enabled. */
  static canCallStediHealthcare() {
    if (!this.STEDI_API_KEY) return false;
    if (this.hasRealStediKey()) return true;
    return this.isStediTestMode();
  }

  static getHealthcareClient() {
    const healthcareBase = process.env.STEDI_HEALTHCARE_BASE || 'https://healthcare.us.stedi.com';
    return axios.create({
      baseURL: healthcareBase,
      headers: {
        Authorization: this.getStediAuthorizationHeader(),
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * Re-verify eligibility within grace window before claim submit (shared by voice + provider).
   * @returns {{ eligibilityReverified: boolean, eligibilityWarning: object|null }}
   */
  static async reverifyEligibilityIfNeeded(claimData) {
    const out = { eligibilityReverified: false, eligibilityWarning: null };
    if (!claimData.patientId || !claimData.memberId || !claimData.payerId || !claimData.serviceCode) {
      return out;
    }
    try {
      const existingChecks = db.getEligibilityChecksByPatient ? db.getEligibilityChecksByPatient(claimData.patientId) : [];
      const relevantCheck = existingChecks.find((check) =>
        check.member_id === claimData.memberId &&
        check.payer_id === claimData.payerId &&
        check.service_code === claimData.serviceCode
      );
      const ELIGIBILITY_GRACE_DAYS = parseFloat(process.env.ELIGIBILITY_GRACE_DAYS || '30');
      const needsRecheck = !relevantCheck ||
        (relevantCheck.created_at &&
          new Date(relevantCheck.created_at) < new Date(Date.now() - ELIGIBILITY_GRACE_DAYS * 24 * 60 * 60 * 1000));

      if (!needsRecheck) return out;

      const eligibilityResult = await this.checkEligibility({
        patientId: claimData.patientId,
        patientName: claimData.patientName || 'Patient',
        dateOfBirth: claimData.dateOfBirth || '1990-01-01',
        memberId: claimData.memberId,
        payerId: claimData.payerId,
        serviceCode: claimData.serviceCode,
        dateOfService: claimData.dateOfService,
        surface: claimData.surface || 'claim_submit_reverify'
      });
      out.eligibilityReverified = true;
      if (!eligibilityResult.eligible) {
        out.eligibilityWarning = {
          message: `Eligibility re-verification failed: ${eligibilityResult.message || 'Not eligible'}`,
          eligible: false,
          action: 'claim_submission_allowed',
          reason: 'Some payers allow retroactive eligibility or coverage may be restored'
        };
      }
    } catch (eligError) {
      out.eligibilityWarning = {
        message: `Eligibility re-verification failed: ${eligError.message}`,
        action: 'claim_submission_allowed',
        reason: 'Eligibility check error - claim submission proceeding'
      };
    }
    return out;
  }

  /** @returns {Promise<{ edi: string|null, stediTranslateOk: boolean }>} */
  static async translate837ToEdi(claimData) {
    const x12Claim = this._buildClaimRequest(claimData);
    const stediClient = this.getStediClient();
    try {
      const translateResponse = await stediBreaker.execute(
        () => stediClient.post('/x12/translate/837-to-edi', { json: x12Claim }),
        () => { throw new Error('Circuit open'); }
      );
      const edi = translateResponse.data?.edi || translateResponse.data?.output || null;
      return { edi, stediTranslateOk: Boolean(edi) };
    } catch (apiError) {
      console.warn('⚠️  Stedi 837 translate failed:', apiError.message);
      return { edi: null, stediTranslateOk: false };
    }
  }

  /**
   * Translate 837 and submit to Stedi Healthcare when configured; else simulation fallback.
   */
  static async submit837ToStedi(claimData) {
    const { edi, stediTranslateOk } = await this.translate837ToEdi(claimData);

    if (this.canCallStediHealthcare() && edi) {
      try {
        const healthClient = this.getHealthcareClient();
        const paths = this.getStediClaimApiPaths();
        const submitRes = await healthClient.post(paths.submit, { x12: edi });
        const x12Id = submitRes?.data?.claimId || submitRes?.data?.correlationId;
        if (x12Id) {
          return {
            claimId: x12Id,
            status: 'submitted',
            message: 'Claim submitted via Stedi Healthcare',
            stediTranslateOk: true,
            healthcareSubmitted: true,
            stediFallback: false,
            estimatedProcessingDays: 14
          };
        }
      } catch (e) {
        const status = e.response?.status;
        console.warn('⚠️  Stedi Healthcare submit failed:', e.message, status ? `(HTTP ${status})` : '');
        if (status === 403 && this.isStediTestMode()) {
          return {
            claimId: `X12_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            status: 'submitted',
            message: '837 translated; Healthcare submit denied in test mode (403) — manual review',
            stediTranslateOk,
            healthcareSubmitted: false,
            stediFallback: true,
            manualReview: true,
            testModeClaimBlocked: true,
            estimatedProcessingDays: 1
          };
        }
      }
    }

    if (!this.canCallStediHealthcare()) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      claimId: `X12_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      status: 'submitted',
      message: stediTranslateOk
        ? '837 translated; clearinghouse submit pending or failed'
        : 'Claim submitted (simulation)',
      stediTranslateOk,
      healthcareSubmitted: false,
      stediFallback: !stediTranslateOk || !this.canCallStediHealthcare(),
      estimatedProcessingDays: 1
    };
  }

  /**
   * Apply Stedi 277/835-style status payload to claim + code acceptance tracking.
   * @param {object} claim - insurance_claims row
   * @param {string} status - approved|paid|denied|rejected|processing|submitted
   */
  static applyClaimAdjudicationOutcome(claim, status) {
    if (!claim?.id || !status) return;
    const normalized = String(status).toLowerCase();
    db.updateInsuranceClaim(claim.id, { status: normalized });
    if (['approved', 'paid', 'denied', 'rejected'].includes(normalized)) {
      try {
        const CodeAcceptanceService = require('./code-acceptance-service');
        const codes = [];
        if (claim.service_code) {
          claim.service_code.split(',').forEach((s) => {
            const t = s.trim();
            if (t && t !== 'N/A') codes.push(t);
          });
        }
        if (codes.length > 0 && claim.payer_id) {
          CodeAcceptanceService.trackCodeOutcome(claim.id, codes, normalized, claim.payer_id);
        }
        const providerNpi = claim.provider_npi || null;
        if (providerNpi) {
          CodeAcceptanceService.updateProviderTrustScore(providerNpi, normalized === 'approved' || normalized === 'paid');
        }
      } catch (e) {
        console.warn('⚠️  applyClaimAdjudicationOutcome tracking skipped:', e.message);
      }
    }
    try {
      const orchestrator = require('./rcm-journey-orchestrator');
      const clinicId = claim.clinic_id || claim.clinicId;
      if (clinicId && claim.id) {
        orchestrator.onClaimAdjudication({
          clinicId,
          claimId: claim.id,
          status: normalized,
          payload: { source: 'insurance_service' },
        });
      }
    } catch (e) {
      console.warn('⚠️  onClaimAdjudication bridge skipped:', e.message);
    }
  }

  /**
   * Check patient insurance eligibility
   * X12 270/271 transaction
   * 
   * @param {Object} eligibilityData - Patient and insurance info
   * @param {string} eligibilityData.patientName - Patient full name
   * @param {string} eligibilityData.dateOfBirth - DOB (YYYY-MM-DD)
   * @param {string} eligibilityData.memberId - Insurance member ID
   * @param {string} eligibilityData.payerId - Insurance payer ID (e.g., "BCBS")
   * @param {string} eligibilityData.serviceCode - CPT code (e.g., "90834")
   * @param {string} eligibilityData.dateOfService - Service date (YYYY-MM-DD)
   * @returns {Object} Eligibility response
   */
  static async checkEligibility(eligibilityData) {
    try {
      const { isStediCircuitOpen, recordStediFailure, recordStediSuccess } = require('./stedi-circuit-breaker');
      const { mergeByoCredentialing } = require('./byo-credentialing');
      eligibilityData = mergeByoCredentialing(eligibilityData);

      const customerId = eligibilityData.customerId || null;
      if (customerId) {
        const customer = db.getCustomer?.(customerId);
        const enforcementPaused =
          process.env.BILLING_ENFORCEMENT_PAUSED === '1' || customer?.billing_enforcement_paused === 1;
        if (!enforcementPaused) {
          const { checkDailyCap } = require('./eligibility-usage-service');
          const cap = checkDailyCap(customerId);
          if (!cap.allowed) {
            return {
              success: false,
              eligible: false,
              error: cap.message,
              code: cap.code
            };
          }
        }
      }

      if (isStediCircuitOpen()) {
        return {
          success: false,
          eligible: false,
          error: 'Eligibility temporarily unavailable. Please try again shortly.',
          code: 'STEDI_CIRCUIT_OPEN'
        };
      }

      secureLogger.info('INSURANCE: Checking Eligibility', redactForLog({
        payerId: eligibilityData.payerId,
        serviceCode: eligibilityData.serviceCode,
        dateOfService: eligibilityData.dateOfService,
        patientName: eligibilityData.patientName,
        memberId: eligibilityData.memberId,
        dateOfBirth: eligibilityData.dateOfBirth
      }));

      const willUseV3 = this.canCallStediHealthcare();

      const stedi271Parser = require('./stedi-271-parser');
      let eligibilityResponse = null;
      let usedHealthcareV3 = false;
      let stediFailed = true;

      // Option A: simulate mode never probes Stedi (global semantics for eval/demo).
      if (process.env.VOICE_ELIGIBILITY_SIMULATE === '1') {
        eligibilityResponse = await this._simulateEligibilityCheck(eligibilityData);
      } else if (this.canCallStediHealthcare()) {
        try {
          const v3 = await this.checkEligibilityViaHealthcareV3(eligibilityData);
          if (v3.ok && v3.data) {
            usedHealthcareV3 = true;
            const parsed = stedi271Parser.parse271Response(v3.data);
            eligibilityResponse = this._eligibilityFromParsed271(parsed);
            const aaa = stedi271Parser.extractAaaErrors(v3.data);
            if (!stedi271Parser.hasMeaningfulData(parsed)) {
              const errs = (v3.data.errors || [])
                .map((e) => e.description || e.code)
                .filter(Boolean);
              if (aaa.codes.length) {
                eligibilityResponse.eligible = false;
                eligibilityResponse.aaa_codes = aaa.codes;
                eligibilityResponse.aaa_messages = aaa.messages;
                eligibilityResponse.message =
                  aaa.messages.join('; ') || `AAA ${aaa.codes.join(',')}`;
              } else if (errs.length) {
                eligibilityResponse.eligible = false;
                eligibilityResponse.message = errs.join('; ');
              }
            } else if (aaa.codes.length) {
              eligibilityResponse.aaa_codes = aaa.codes;
              eligibilityResponse.aaa_messages = aaa.messages;
            }
            secureLogger.info('Stedi Healthcare eligibility v3 response', {
              eligible: eligibilityResponse.eligible,
              copay: eligibilityResponse.copay,
              searchId: v3.data.eligibilitySearchId || null
            });
          }
        } catch (apiError) {
          secureLogger.warn('Stedi Healthcare eligibility v3 failed', { message: apiError.message });
          try { recordStediFailure(); } catch (_) {}
          if (apiError.response) {
            const msg = apiError.response.data?.message || apiError.response.data?.error;
            secureLogger.warn('Stedi v3 HTTP detail', {
              status: apiError.response.status,
              detail: msg ? String(msg).slice(0, 200) : null
            });
          }
        }
      }

      if (!eligibilityResponse && process.env.VOICE_ELIGIBILITY_SIMULATE !== '1') {
        const x12Request = this._buildEligibilityRequest(eligibilityData);
        const stediClient = this.getStediClient();
        try {
          const translateResponse = await stediBreaker.execute(
            () => stediClient.post('/x12/translate/270-to-edi', { json: x12Request }),
            () => { throw new Error('Circuit open - using simulation'); }
          );
          secureLogger.info('Stedi translate API response received');
          const parsed = stedi271Parser.parse271Response(translateResponse.data || translateResponse);
          if (stedi271Parser.hasMeaningfulData(parsed)) {
            eligibilityResponse = this._eligibilityFromParsed271(parsed);
          }
        } catch (apiError) {
          secureLogger.warn('Stedi translate eligibility failed, using simulation', { message: apiError.message });
          try {
            const Metrics = require('./metrics');
            Metrics.increment('stedi_eligibility_error_rate');
          } catch (_) {}
          if (apiError.response) {
            secureLogger.warn('Stedi translate HTTP detail', { status: apiError.response.status });
          }
        }
      }

      if (process.env.VOICE_ELIGIBILITY_SIMULATE !== '1') {
        stediFailed = !eligibilityResponse;
        if (usedHealthcareV3 && eligibilityResponse) {
          stediFailed = false;
        } else if (stediFailed) {
          const voiceSimulate =
            process.env.VOICE_ELIGIBILITY_SIMULATE === '1' ||
            (process.env.NODE_ENV !== 'production' && process.env.VOICE_ELIGIBILITY_SIMULATE !== '0');
          if (voiceSimulate) {
            eligibilityResponse = await this._simulateEligibilityCheck(eligibilityData);
          } else {
            throw new Error('Stedi eligibility unavailable and simulation disabled for voice');
          }
        }
      }

      const eligibilityQuality = classifyEligibilityQuality(eligibilityResponse);
      const planSummary = eligibilityResponse.planSummary || null;
      const deductibleTotal = eligibilityResponse.deductibleTotal ?? null;
      const deductibleRemaining = eligibilityResponse.deductibleRemaining ?? null;
      const coinsurancePercent = eligibilityResponse.coinsurancePercent ?? null;
      const oopMax = eligibilityResponse.oopMax ?? null;
      const oopMet = eligibilityResponse.oopMet ?? 0;
      const priorAuthIndicator = eligibilityResponse.priorAuthIndicator || null;
      const priorAuthNotes = Array.isArray(eligibilityResponse.priorAuthNotes) ? eligibilityResponse.priorAuthNotes : [];

      const safePatientId = this._resolveEligibilityPatientId(eligibilityData.patientId);

      const eligibilityRecord = {
        id: `elig_${uuidv4()}`,
        patient_id: safePatientId,
        member_id: eligibilityData.memberId,
        payer_id: eligibilityData.payerId,
        service_code: eligibilityData.serviceCode,
        date_of_service: eligibilityData.dateOfService,
        eligible: eligibilityResponse.eligible,
        copay_amount: eligibilityResponse.copay || 0,
        allowed_amount: eligibilityResponse.allowedAmount || 0,
        insurance_pays: eligibilityResponse.insurancePays || 0,
        deductible_total: deductibleTotal,
        deductible_remaining: deductibleRemaining,
        coinsurance_percent: coinsurancePercent,
        oop_max: oopMax,
        oop_met: oopMet,
        plan_summary: planSummary,
        prior_auth_indicator: priorAuthIndicator,
        prior_auth_notes: priorAuthNotes.length ? JSON.stringify(priorAuthNotes) : null,
        prior_auth_source: priorAuthIndicator ? '271' : null,
        eligibility_quality: eligibilityQuality,
        response_data: JSON.stringify(eligibilityResponse),
        created_at: new Date().toISOString()
      };

      db.createEligibilityCheck(eligibilityRecord);

      try {
        if (customerId) {
          const { applyEligibilityUsage } = require('./apply-eligibility-usage');
          const eventId =
            eligibilityData.sessionId || eligibilityData.callId
              ? `elig:${eligibilityData.callId || eligibilityData.sessionId}:${eligibilityData.payerId}:${eligibilityData.memberId || 'x'}`
              : eligibilityRecord.id;
          applyEligibilityUsage(db, {
            customerId,
            eventId,
            payerId: eligibilityData.payerId,
            quality: eligibilityQuality,
            source: stediFailed ? 'simulation' : 'stedi'
          });
        }
        try { recordStediSuccess(); } catch (_) {}
      } catch (_) {}

      secureLogger.info('Eligibility check completed', {
        eligible: eligibilityResponse.eligible,
        copay: eligibilityResponse.eligible ? eligibilityResponse.copay : null,
        insurancePays: eligibilityResponse.eligible ? eligibilityResponse.insurancePays : null,
        quality: eligibilityQuality,
        source: stediFailed ? 'simulation' : 'stedi'
      });

      const result = {
        success: true,
        eligible: eligibilityResponse.eligible,
        copay: eligibilityResponse.copay || 0,
        allowedAmount: eligibilityResponse.allowedAmount || 0,
        insurancePays: eligibilityResponse.insurancePays || 0,
        deductibleTotal: deductibleTotal,
        deductibleRemaining: deductibleRemaining,
        coinsurancePercent: coinsurancePercent,
        oopMax: oopMax,
        oopMet: oopMet,
        planSummary: planSummary,
        priorAuthIndicator: priorAuthIndicator,
        priorAuthNotes: priorAuthNotes,
        patientResponsibility: eligibilityResponse.copay || 0,
        eligibilityId: eligibilityRecord.id,
        eligibility_quality: eligibilityQuality,
        message: eligibilityResponse.eligible
          ? `Eligible - Copay: $${eligibilityResponse.copay}, Insurance pays: $${eligibilityResponse.insurancePays}`
          : 'Not eligible for this service'
      };
      if (stediFailed) {
        result.settled = false;
        result.manualReview = true;
        result.stediFallback = true;
      }
      return result;

    } catch (error) {
      secureLogger.error('Error checking eligibility', { message: error.message });
      return {
        success: false,
        eligible: false,
        error: error.message,
        settled: false,
        manualReview: true
      };
    }
  }

  /**
   * Submit insurance claim
   * X12 837 transaction
   * 
   * @param {Object} claimData - Claim information
   * @param {string} claimData.appointmentId - Appointment ID
   * @param {string} claimData.patientId - FHIR patient ID
   * @param {string} claimData.memberId - Insurance member ID
   * @param {string} claimData.payerId - Insurance payer ID
   * @param {string} claimData.serviceCode - CPT code
   * @param {string} claimData.diagnosisCode - ICD-10 code
   * @param {number} claimData.totalAmount - Total charge amount
   * @param {number} claimData.copayPaid - Amount patient paid (copay)
   * @param {string} claimData.dateOfService - Service date
   * @param {string} claimData.blockchainProof - Blockchain transaction ID (optional)
   * @returns {Object} Claim submission result
   */
  static async submitClaim(claimData) {
    try {
      const billingEnvelope = require('./billing-claim-envelope-service');
      if (!claimData.placeOfService) {
        claimData.placeOfService = billingEnvelope.resolvePlaceOfService({
          visit_mode: claimData.visit_mode,
          place_of_service: claimData.place_of_service
        });
      }
      if (!claimData.modifiers || claimData.modifiers.length === 0) {
        claimData.modifiers = billingEnvelope.resolveTelehealthModifiers({
          place_of_service: claimData.placeOfService,
          visit_mode: claimData.visit_mode,
          payer_id: claimData.payerId,
          existing_modifiers: claimData.modifiers || []
        });
      }
      if (claimData.npi && !claimData.taxonomyCode && db.getPrimaryTaxonomyForNpi) {
        claimData.taxonomyCode = db.getPrimaryTaxonomyForNpi(claimData.npi) || claimData.taxonomyCode;
      }

      console.log('\n📋 INSURANCE: Submitting Claim');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Appointment ID:', claimData.appointmentId);
      console.log('Member ID:', claimData.memberId);
      console.log('Service Code:', claimData.serviceCode);
      console.log('Place of Service:', claimData.placeOfService || '(default)');
      console.log('Modifiers:', (claimData.modifiers || []).join(', ') || '(none)');
      if (claimData.taxonomyCode) console.log('Provider Taxonomy:', claimData.taxonomyCode);
      console.log('Total Amount: $' + claimData.totalAmount);
      console.log('Copay Paid: $' + claimData.copayPaid);

      // Idempotency: avoid duplicate submissions within a time window
      const idemKey = claimData.idempotency_key ||
        (claimData.patientId && claimData.memberId && claimData.serviceCode && claimData.dateOfService
          ? `idem_${claimData.patientId}_${claimData.memberId}_${claimData.serviceCode}_${claimData.dateOfService}`
          : null);

      if (idemKey) {
        const existing = db.getInsuranceClaimByIdempotency ? db.getInsuranceClaimByIdempotency(idemKey) : null;
        if (existing) {
          console.log('🔁 Idempotent submit detected, returning existing claim:', existing.id);
          return {
            success: true,
            claimId: existing.id,
            x12ClaimId: existing.x12_claim_id || null,
            status: existing.status,
            idempotent: true,
            message: 'Duplicate submission ignored (idempotent)'
          };
        }
      }

      claimData.surface = claimData.surface || 'voice_submit_claim';
      const { eligibilityReverified, eligibilityWarning } = await this.reverifyEligibilityIfNeeded(claimData);

      const claimResponse = await this.submit837ToStedi(claimData);

      // Store claim in database
      const claimRecord = {
        id: `claim_${uuidv4()}`,
        appointment_id: claimData.appointmentId,
        patient_id: claimData.patientId,
        member_id: claimData.memberId,
        payer_id: claimData.payerId,
        service_code: claimData.serviceCode,
        diagnosis_code: claimData.diagnosisCode || null,
        total_amount: claimData.totalAmount,
        copay_amount: claimData.copayPaid,
        insurance_amount: claimData.totalAmount - claimData.copayPaid,
        status: 'submitted',
        x12_claim_id: claimResponse.claimId || null,
        idempotency_key: idemKey || null,
        blockchain_proof: claimData.blockchainProof || null,
        submitted_at: new Date().toISOString(),
        response_data: JSON.stringify(claimResponse),
        provider_npi: claimData.providerNpi || null,
        proof_of_care_hash: (() => {
          try {
            const SettlementService = require('./settlement-service');
            const notes = claimData.clinicalNote || claimData.encounterNotes || '';
            const codes = { icd10: claimData.diagnosisCode, cpt: claimData.serviceCode };
            return SettlementService.generateProofOfCare(notes, codes, new Date().toISOString());
          } catch (_) { return null; }
        })()
      };

      db.createInsuranceClaim(claimRecord);

      try {
        const orchestrator = require('./rcm-journey-orchestrator');
        const appointment = claimData.appointmentId ? await db.getAppointment(claimData.appointmentId) : null;
        const clinicId = appointment?.clinic_id || claimData.clinicId || claimData.clinic_id;
        if (clinicId) {
          let journey =
            orchestrator.findOpenJourneyForPatient(clinicId, claimData.patientId) ||
            (appointment?.id
              ? db.db
                  .prepare(
                    `SELECT * FROM rcm_journeys WHERE clinic_id = ? AND appointment_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`
                  )
                  .get(String(clinicId), String(appointment.id))
              : null);
          if (journey) {
            orchestrator.linkClaimToJourney(clinicId, journey.id, claimRecord.id);
          }
        }
      } catch (e) {
        console.warn('⚠️  linkClaimToJourney skipped:', e.message);
      }

      // Create Stripe card on-demand if patient owes money (copay or patient responsibility)
      if (claimData.copayPaid > 0 || (claimData.totalAmount - claimData.copayPaid) > 0) {
        try {
          const FHIRService = require('./fhir-service');
          const patientOwed = claimData.totalAmount - claimData.copayPaid;
          
          // If patient owes money after insurance, create card for the bill
          if (patientOwed > 0) {
            console.log(`💳 Creating payment card for patient responsibility: $${patientOwed.toFixed(2)}`);
            await FHIRService.createCardForBill(claimData.patientId, patientOwed, {
              claim_id: claimRecord.id,
              appointment_id: claimData.appointmentId
            });
          }
          // If copay was paid, card might already exist, but create one if needed
          else if (claimData.copayPaid > 0) {
            console.log(`💳 Creating payment card for copay: $${claimData.copayPaid.toFixed(2)}`);
            await FHIRService.createCardForCopay(claimData.patientId, claimData.copayPaid, {
              appointment_id: claimData.appointmentId,
              claim_id: claimRecord.id
            });
          }
        } catch (cardError) {
          // Don't fail claim submission if card creation fails
          console.warn('⚠️  Failed to create payment card for claim:', cardError.message);
        }
      }

      console.log('✅ Claim submitted successfully');
      console.log('   Claim ID:', claimRecord.id);
      console.log('   X12 Claim ID:', claimResponse.claimId);
      console.log('   Status: Submitted - Pending approval');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const result = {
        success: true,
        claimId: claimRecord.id,
        x12ClaimId: claimResponse.claimId,
        status: 'submitted',
        message: 'Claim submitted successfully'
      };
      if (claimResponse.stediFallback) {
        result.settled = false;
        result.manualReview = true;
        result.stediFallback = true;
      }
      if (claimResponse.healthcareSubmitted) {
        result.healthcareSubmitted = true;
      }
      if (eligibilityReverified) {
        result.eligibilityReverified = true;
      }
      if (eligibilityWarning) {
        result.eligibilityWarning = eligibilityWarning;
      }
      return result;

    } catch (error) {
      console.error('❌ Error submitting claim:', error.message);
      return {
        success: false,
        error: error.message,
        settled: false,
        manualReview: true
      };
    }
  }

  /**
   * Submit an existing claim row to Stedi (837 translate + Healthcare submit + x12_claim_id).
   * 278 prior auth is not supported by Stedi; PA gate uses approved auth_number on file.
   */
  static async submitExistingClaim(claimId) {
    const claim = db.getClaimById ? db.getClaimById(claimId) : db.getInsuranceClaim?.(claimId);
    if (!claim) throw new Error('Claim not found');

    // Idempotency: if we already have a submitted/approved/paid claim, do a no-op.
    // (submit-payment route already checks status, but the service should also be safe.)
    const currentStatus = (claim.status || '').toString().trim().toLowerCase();
    if (['submitted', 'approved', 'paid'].includes(currentStatus)) {
      let parsed = {};
      try {
        if (claim.response_data) {
          parsed = typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data;
        }
      } catch (_) {}
      return {
        success: true,
        claimId: claim.id,
        x12ClaimId: claim.x12_claim_id || parsed.claimId || parsed.x12_claim_id || null,
        stediTranslateOk: parsed.stedi_translate_ok ?? parsed.stediTranslateOk ?? null,
        healthcareSubmitted: parsed.healthcare_submitted ?? parsed.healthcareSubmitted ?? null,
        stediFallback: Boolean(parsed.stediFallback ?? parsed.stedi_fallback ?? parsed.testModeClaimBlocked ?? false),
        manualReview: Boolean(parsed.stediFallback ?? parsed.stedi_fallback ?? parsed.testModeClaimBlocked ?? false),
        priorAuthorizationNumber: parsed.prior_authorization_number ?? parsed.priorAuthorizationNumber ?? null,
        eligibilityReverified: false,
        eligibilityWarning: null,
        idempotent: true,
        status: claim.status || currentStatus
      };
    }

    let priorAuthorizationNumber = null;
    if (claim.appointment_id && db.getAppointment) {
      const appt = db.getAppointment(claim.appointment_id);
      if (appt?.requires_prior_auth) {
        const paRows = db.getPriorAuthRequestsByAppointment ? db.getPriorAuthRequestsByAppointment(claim.appointment_id) : [];
        const approved = (paRows || []).find((r) => String(r.status || '').toLowerCase() === 'approved' && r.auth_number);
        if (!approved) {
          const err = new Error('Prior authorization is required for this appointment, but no approved auth number is on file.');
          err.code = 'PRIOR_AUTH_REQUIRED';
          throw err;
        }
        priorAuthorizationNumber = approved.auth_number;
      }
    }

    let patientName = 'Patient';
    let dateOfBirth = '1990-01-01';
    if (claim.patient_id && db.getFHIRPatient) {
      const fp = db.getFHIRPatient(claim.patient_id);
      if (fp) {
        // Prefer canonical flattened columns (when present)
        if (fp.name) patientName = fp.name;

        // Most real-world FHIR data lives in resource_data; use that for demographics
        let resourceData = fp.resource_data || {};
        try {
          if (typeof resourceData === 'string') resourceData = JSON.parse(resourceData);
        } catch (_) {}

        const name0 = Array.isArray(resourceData?.name) ? resourceData.name[0] : null;
        const given = name0?.given || [];
        const family = name0?.family || '';
        const composedName = [Array.isArray(given) ? given.join(' ') : null, family].filter(Boolean).join(' ').trim();
        if (composedName) patientName = composedName;

        const dobCandidate =
          resourceData?.birthDate ||
          resourceData?.birth_date ||
          resourceData?.dateOfBirth ||
          resourceData?.date_of_birth ||
          resourceData?.dob ||
          fp.birth_date ||
          fp.date_of_birth ||
          dateOfBirth;

        if (dobCandidate) {
          const s = String(dobCandidate);
          dateOfBirth = s.length >= 10 ? s.slice(0, 10) : s;
        }
      }
    }

    const claimData = {
      patientId: claim.patient_id,
      patientName,
      dateOfBirth,
      memberId: claim.member_id,
      payerId: claim.payer_id,
      serviceCode: claim.service_code,
      diagnosisCode: claim.diagnosis_code,
      totalAmount: Number(claim.total_amount || 0),
      copayPaid: Number(claim.copay_amount || 0),
      dateOfService: claim.submitted_at
        ? new Date(claim.submitted_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      priorAuthorizationNumber,
      providerNpi: claim.provider_npi || null,
      appointmentId: claim.appointment_id || null,
      surface: 'provider_portal'
    };

    const { eligibilityReverified, eligibilityWarning } = await this.reverifyEligibilityIfNeeded(claimData);
    const claimResponse = await this.submit837ToStedi(claimData);

    const priorResponse = claim.response_data
      ? (typeof claim.response_data === 'string'
        ? (() => { try { return JSON.parse(claim.response_data); } catch (_) { return {}; } })()
        : claim.response_data)
      : {};

    const updates = {
      status: 'submitted',
      payment_status: 'pending',
      submitted_at: new Date().toISOString(),
      x12_claim_id: claimResponse.claimId || null,
      response_data: JSON.stringify({
        ...priorResponse,
        ...claimResponse,
        stedi_translate_ok: claimResponse.stediTranslateOk,
        healthcare_submitted: claimResponse.healthcareSubmitted,
        prior_authorization_number: priorAuthorizationNumber || null
      })
    };
    if (db.updateInsuranceClaim) db.updateInsuranceClaim(claim.id, updates);

    return {
      success: true,
      claimId: claim.id,
      x12ClaimId: claimResponse.claimId,
      stediTranslateOk: claimResponse.stediTranslateOk,
      healthcareSubmitted: claimResponse.healthcareSubmitted,
      stediFallback: claimResponse.stediFallback,
      manualReview: Boolean(claimResponse.stediFallback),
      priorAuthorizationNumber: priorAuthorizationNumber || null,
      eligibilityReverified,
      eligibilityWarning
    };
  }

  /**
   * Check claim status
   * X12 276/277 transaction
   * 
   * @param {string} claimId - Internal claim ID
   * @returns {Object} Claim status
   */
  static async checkClaimStatus(claimId) {
    try {
      const claim = db.getInsuranceClaim(claimId);
      if (!claim) {
        throw new Error('Claim not found');
      }

      console.log('\n🔍 INSURANCE: Checking Claim Status');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Claim ID:', claimId);
      console.log('Current Status:', claim.status);

      // Build X12 276 claim status inquiry
      const x12StatusRequest = this._buildStatusRequest(claim);

      // Call Stedi API
      const stediClient = this.getStediClient();
      
      try {
        await stediBreaker.execute(
          () => stediClient.post('/x12/translate/276-to-edi', { json: x12StatusRequest }),
          () => { throw new Error('Circuit open - using simulation'); }
        );
        console.log('✅ Stedi API response received');
      } catch (apiError) {
        console.warn('⚠️  Stedi API call failed, using simulation:', apiError.message);
      }

      // Query insurance payer for status
      // For now, simulate response
      const statusResponse = await this._queryClaimStatus(claim);

      // Update claim status in database
      if (statusResponse.status !== claim.status) {
        let mergedResponse = statusResponse;
        try {
          const existing = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
          if (existing && typeof existing === 'object' && (existing.coding || existing.pricing)) {
            mergedResponse = { ...existing, ...statusResponse };
          }
        } catch (_) {}
        const updates = {
          status: statusResponse.status,
          status_checked_at: new Date().toISOString(),
          response_data: JSON.stringify(mergedResponse)
        };
        if (statusResponse.paymentAmount != null) {
          updates.payment_amount = statusResponse.paymentAmount;
        }
        db.updateInsuranceClaim(claimId, updates);

        // Tiba Phase 5: reconciliation when approved/paid
        if (statusResponse.status === 'approved' || statusResponse.status === 'paid') {
          try {
            const ReconciliationService = require('./reconciliation-service');
            const EOBCalculationService = require('./eob-calculation-service');
            const finalPlanPaid = ReconciliationService.extractFinalPlanPaid(statusResponse);
            const updatedClaim = db.getInsuranceClaim(claimId);
            if (finalPlanPaid != null && updatedClaim) {
              let eligibility = null;
              if (updatedClaim.patient_id) {
                const checks = db.getEligibilityChecksByPatient?.(updatedClaim.patient_id) || [];
                eligibility = checks[0] || null;
              }
              let claimDetails = {};
              try {
                claimDetails = updatedClaim.response_data ? (typeof updatedClaim.response_data === 'string' ? JSON.parse(updatedClaim.response_data) : updatedClaim.response_data) : {};
              } catch (_) {}
              const eob = EOBCalculationService.calculateEOBFromClaim(updatedClaim, eligibility, claimDetails);
              const recon = ReconciliationService.computeReconciliation(updatedClaim, finalPlanPaid, eob);
              if (recon.action !== 'none') {
                console.log(`📊 Reconciliation: Δ_plan=$${recon.deltaPlan.toFixed(2)}, action=${recon.action}, withinTolerance=${recon.withinTolerance}`);
                let toStore = {};
                try {
                  toStore = updatedClaim.response_data ? (typeof updatedClaim.response_data === 'string' ? JSON.parse(updatedClaim.response_data) : updatedClaim.response_data) : {};
                } catch (_) {}
                toStore.reconciliation = recon;
                db.updateInsuranceClaim(claimId, { response_data: JSON.stringify(toStore) });
              }
            }
          } catch (reconErr) {
            console.warn('⚠️  Reconciliation skipped:', reconErr.message);
          }
        }

        // Track code acceptance for Tiba φ^historical (Phase 4)
        const newStatus = statusResponse.status;
        if (newStatus === 'approved' || newStatus === 'paid' || newStatus === 'denied' || newStatus === 'rejected') {
          try {
            const CodeAcceptanceService = require('./code-acceptance-service');
            const codes = [];
            if (claim.service_code) {
              claim.service_code.split(',').forEach(s => { const t = s.trim(); if (t && t !== 'N/A') codes.push(t); });
            }
            let claimDetails = {};
            try {
              claimDetails = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
            } catch (_) {}
            const coding = claimDetails.coding || claimDetails;
            if (coding.cpt && Array.isArray(coding.cpt)) {
              coding.cpt.forEach(c => codes.push(c.code || c));
            }
            if (codes.length > 0 && claim.payer_id) {
              CodeAcceptanceService.trackCodeOutcome(claimId, codes, newStatus, claim.payer_id);
            }
            const accepted = newStatus === 'approved' || newStatus === 'paid';
            const providerNpi = claim.provider_npi || null;
            if (providerNpi) {
              CodeAcceptanceService.updateProviderTrustScore(providerNpi, accepted);
            }
          } catch (trackErr) {
            console.warn('⚠️  Code acceptance tracking skipped:', trackErr.message);
          }
        }
      }

      console.log('✅ Status check completed');
      console.log('   Status:', statusResponse.status);
      if (statusResponse.status === 'approved' || statusResponse.status === 'paid') {
        console.log('   Payment Amount: $' + statusResponse.paymentAmount);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        success: true,
        claimId: claimId,
        status: statusResponse.status,
        paymentAmount: statusResponse.paymentAmount || null,
        paymentDate: statusResponse.paymentDate || null,
        message: statusResponse.message || `Claim status: ${statusResponse.status}`
      };

    } catch (error) {
      console.error('❌ Error checking claim status:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Map internal/demo payer aliases to Stedi tradingPartnerServiceId.
   * In test mode, unknown aliases fall back to STEDI_TEST_PAYER_ID.
   */
  static resolveTradingPartnerServiceId(payerId) {
    const raw = String(payerId || '').trim();
    if (!raw) {
      return process.env.STEDI_TEST_PAYER_ID || 'STEDI';
    }
    const upper = raw.toUpperCase();
    const aliasMap = {
      UHC: process.env.STEDI_TEST_PAYER_ID || 'STEDI',
      BCBS: process.env.STEDI_TEST_PAYER_ID || 'STEDI',
      AETNA: process.env.STEDI_TEST_PAYER_ID || '60054',
      STEDI: 'STEDI',
    };
    if (aliasMap[upper]) return aliasMap[upper];
    if (/^\d+$/.test(raw)) return raw;
    if (this.isStediTestMode()) {
      return process.env.STEDI_TEST_PAYER_ID || 'STEDI';
    }
    return raw;
  }

  /** @private */
  static _formatDobForStedi(dob) {
    if (!dob) {
      const testDob = process.env.STEDI_TEST_DOB;
      if (testDob) return String(testDob).replace(/-/g, '').slice(0, 8);
      return null;
    }
    const s = String(dob).replace(/-/g, '');
    return s.length === 8 ? s : null;
  }

  /** @private */
  static _splitPatientName(name) {
    const parts = String(name || 'Patient').trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || 'Patient',
      lastName: parts.length > 1 ? parts.slice(1).join(' ') : 'Member'
    };
  }

  /** @private */
  static _cptToServiceTypeCode(cpt) {
    const code = String(cpt || '').trim();
    if (/^908/.test(code)) return 'MH';
    if (/^99/.test(code)) return '30';
    return '30';
  }

  /**
   * Stedi Healthcare eligibility v3 JSON body (NOT wrapped in { json: ... }).
   * @private
   */
  static _buildHealthcareEligibilityJson(eligibilityData) {
    const testFirst = process.env.STEDI_TEST_SUBSCRIBER_FIRST;
    const testLast = process.env.STEDI_TEST_SUBSCRIBER_LAST;
    const useTestIdentity =
      this.isStediTestMode() &&
      (!eligibilityData.patientName || !eligibilityData.dateOfBirth) &&
      testFirst &&
      testLast;

    const patientName = useTestIdentity
      ? `${testFirst} ${testLast}`
      : eligibilityData.patientName;
    const dateOfBirth = useTestIdentity
      ? process.env.STEDI_TEST_DOB || eligibilityData.dateOfBirth
      : eligibilityData.dateOfBirth;

    const { firstName, lastName } = this._splitPatientName(patientName);
    const tradingPartnerServiceId = this.resolveTradingPartnerServiceId(eligibilityData.payerId);
    const memberId =
      eligibilityData.memberId ||
      process.env.STEDI_TEST_MEMBER_ID ||
      '0000000001';
    const dob = this._formatDobForStedi(dateOfBirth);
    if (!dob) {
      throw new Error('dateOfBirth is required for Stedi eligibility (use FHIR birthDate or STEDI_TEST_DOB)');
    }

    const body = {
      tradingPartnerServiceId,
      provider: {
        organizationName: process.env.STEDI_PROVIDER_ORG_NAME || 'Somo',
        npi: process.env.STEDI_TEST_PROVIDER_NPI || eligibilityData.providerNpi || '1999999984'
      },
      subscriber: {
        memberId,
        firstName,
        lastName,
        dateOfBirth: dob
      },
      encounter: {
        serviceTypeCodes: [this._cptToServiceTypeCode(eligibilityData.serviceCode)]
      }
    };

    if (eligibilityData.dateOfService) {
      body.encounter.dateOfService = String(eligibilityData.dateOfService).replace(/-/g, '');
    }
    return body;
  }

  /** @private */
  static _eligibilityFromParsed271(parsed) {
    return {
      eligible: parsed.eligible,
      copay: parsed.copay ?? 0,
      allowedAmount: parsed.allowedAmount ?? 0,
      insurancePays: parsed.insurancePays ?? 0,
      deductibleTotal: parsed.deductibleTotal,
      deductibleRemaining: parsed.deductibleRemaining,
      coinsurancePercent: parsed.coinsurancePercent,
      oopMax: parsed.oopMax ?? null,
      oopMet: parsed.oopMet ?? 0,
      planSummary: parsed.planSummary,
      priorAuthIndicator: parsed.priorAuthIndicator || null,
      priorAuthNotes: parsed.priorAuthNotes || [],
      aaa_codes: parsed.aaaCodes || [],
      aaa_messages: parsed.aaaMessages || [],
      message: parsed.message || (parsed.eligible ? `Eligible - Copay $${parsed.copay ?? 0}` : 'Not eligible')
    };
  }

  /**
   * POST Healthcare eligibility v3 — request body is the eligibility object directly.
   */
  static async checkEligibilityViaHealthcareV3(eligibilityData) {
    const body = this._buildHealthcareEligibilityJson(eligibilityData);
    const healthClient = this.getHealthcareClient();
    const res = await stediBreaker.execute(
      () => healthClient.post(this.STEDI_ELIGIBILITY_V3_PATH, body),
      () => { throw new Error('Circuit open'); }
    );
    return { ok: res.status >= 200 && res.status < 300, data: res.data, status: res.status };
  }

  /** Avoid FK errors when patient_id is not in fhir_patients. @private */
  static _resolveEligibilityPatientId(patientId) {
    if (!patientId) return null;
    try {
      if (db.getFHIRPatient && db.getFHIRPatient(patientId)) return patientId;
    } catch (_) {}
    return null;
  }

  /**
   * Build X12 270 eligibility inquiry
   * @private
   */
  static _buildEligibilityRequest(eligibilityData) {
    // X12 270 structure - simplified for now
    // Full X12 format would be more complex
    return {
      transactionType: '270', // Eligibility Inquiry
      patient: {
        name: eligibilityData.patientName,
        dateOfBirth: eligibilityData.dateOfBirth,
        memberId: eligibilityData.memberId
      },
      payer: {
        payerId: eligibilityData.payerId
      },
      service: {
        serviceCode: eligibilityData.serviceCode,
        dateOfService: eligibilityData.dateOfService
      }
    };
  }

  /**
   * Build X12 837 claim
   * @private
   */
  static _buildClaimRequest(claimData) {
    return {
      transactionType: '837', // Healthcare Claim
      patient: {
        patientId: claimData.patientId,
        memberId: claimData.memberId,
        name: claimData.patientName,
        dateOfBirth: claimData.dateOfBirth
      },
      provider: {
        providerId: claimData.providerId || 'Somo-Provider-001',
        npi: claimData.npi || claimData.providerNpi || null,
        taxonomyCode: claimData.taxonomyCode || null,
        providerTaxonomyCode: claimData.taxonomyCode || null
      },
      payer: {
        payerId: claimData.payerId
      },
      service: {
        serviceCode: claimData.serviceCode,
        diagnosisCode: claimData.diagnosisCode,
        placeOfServiceCode: claimData.placeOfService || '02',
        placeOfService: claimData.placeOfService || '02',
        procedureModifiers: claimData.modifiers || [],
        modifiers: claimData.modifiers || [],
        dateOfService: claimData.dateOfService,
        totalAmount: claimData.totalAmount,
        copayPaid: claimData.copayPaid,
        amountOwed: claimData.totalAmount - claimData.copayPaid,
        priorAuthorizationNumber: claimData.priorAuthorizationNumber || null
      },
      blockchainProof: claimData.blockchainProof || null
    };
  }

  /**
   * Build X12 276 claim status inquiry
   * @private
   */
  static _buildStatusRequest(claim) {
    return {
      transactionType: '276', // Claim Status Inquiry
      claimId: claim.x12_claim_id || claim.id,
      memberId: claim.member_id,
      payerId: claim.payer_id
    };
  }

  /**
   * Map caller/payer phrasing to mock table keys (AETNA, BCBS, UHC, …).
   * @private
   */
  static _resolveSimulatePayerKey(eligibilityData = {}) {
    const parts = [
      eligibilityData.payerId,
      eligibilityData.payer_id,
      eligibilityData.payerName,
      eligibilityData.payer_name
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    const blob = parts.join(' ');
    if (/aetna/.test(blob)) return 'AETNA';
    if (/delta/.test(blob)) return 'BCBS';
    if (/met\s*life|metlife/.test(blob)) return 'UHC';
    if (/cigna/.test(blob)) return 'AETNA';
    if (/united|uhc/.test(blob)) return 'UHC';
    if (/blue\s*cross|blue\s*shield|bcbs/.test(blob)) return 'BCBS';
    const upper = String(eligibilityData.payerId || eligibilityData.payer_id || '').toUpperCase();
    if (upper && ['BCBS', 'AETNA', 'UHC'].includes(upper)) return upper;
    return 'BCBS';
  }

  /**
   * Deterministic mock eligibility (no Stedi). Used when VOICE_ELIGIBILITY_SIMULATE=1.
   * @private
   */
  static async _mockEligibilityTable(eligibilityData) {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const mockResponses = {
      BCBS: {
        eligible: true,
        copay: 20,
        allowedAmount: 150,
        insurancePays: 130,
        deductibleTotal: 500,
        deductibleRemaining: 200,
        coinsurancePercent: 20,
        oopMax: 5000,
        oopMet: 0,
        planSummary: 'Covers outpatient mental health visits; prior auth not required for first 6 visits.',
        message: 'Eligible - Copay $20'
      },
      AETNA: {
        eligible: true,
        copay: 25,
        allowedAmount: 150,
        insurancePays: 125,
        deductibleTotal: 1000,
        deductibleRemaining: 600,
        coinsurancePercent: 20,
        oopMax: 6000,
        oopMet: 0,
        planSummary: 'Standard PPO: outpatient mental health covered after copay; deductible applies to labs only.',
        message: 'Eligible - Copay $25'
      },
      UHC: {
        eligible: true,
        copay: 30,
        allowedAmount: 150,
        insurancePays: 120,
        deductibleTotal: 750,
        deductibleRemaining: 300,
        coinsurancePercent: 20,
        oopMax: 5500,
        oopMet: 0,
        planSummary: 'Outpatient behavioral health in-network covered; 30$ copay; 20% coinsurance after deductible for some services.',
        message: 'Eligible - Copay $30'
      }
    };

    const payerId = this._resolveSimulatePayerKey(eligibilityData);
    const mock = mockResponses[payerId] || {
      eligible: true,
      copay: 20,
      allowedAmount: 150,
      insurancePays: 130,
      oopMax: 5000,
      oopMet: 0,
      message: 'Eligible - Copay $20 (default)'
    };
    return { ...mock, _simulate: true, eligibility_source: 'simulate' };
  }

  /**
   * Fallback eligibility when Stedi 270/271 fails. Attempts Stedi API when configured.
   * When VOICE_ELIGIBILITY_SIMULATE=1, uses deterministic mock only (Option A — global simulate semantics).
   * @private
   */
  static async _simulateEligibilityCheck(eligibilityData) {
    if (process.env.VOICE_ELIGIBILITY_SIMULATE === '1') {
      return this._mockEligibilityTable(eligibilityData);
    }

    const stediClient = this.getStediClient();
    const hasRealKey = this.STEDI_API_KEY && !this.STEDI_API_KEY.startsWith('test_');
    if (hasRealKey) {
      try {
        const x12Request = this._buildEligibilityRequest(eligibilityData);
        const translateResponse = await stediBreaker.execute(
          () => stediClient.post('/x12/translate/270-to-edi', { json: x12Request }),
          () => { throw new Error('Circuit open'); }
        );
        const stedi271Parser = require('./stedi-271-parser');
        const parsed = stedi271Parser.parse271Response(translateResponse.data || translateResponse);
        if (stedi271Parser.hasMeaningfulData(parsed)) {
          return {
            eligible: parsed.eligible,
            copay: parsed.copay ?? 0,
            allowedAmount: parsed.allowedAmount ?? 0,
            insurancePays: parsed.insurancePays ?? 0,
            deductibleTotal: parsed.deductibleTotal,
            deductibleRemaining: parsed.deductibleRemaining,
            coinsurancePercent: parsed.coinsurancePercent,
            oopMax: parsed.oopMax ?? null,
            oopMet: parsed.oopMet ?? 0,
            planSummary: parsed.planSummary,
            message: parsed.message || (parsed.eligible ? `Eligible - Copay $${parsed.copay ?? 0}` : 'Not eligible')
          };
        }
      } catch (e) {
        console.warn('⚠️  Stedi fallback eligibility failed:', e.message);
      }
    }

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    return this._mockEligibilityTable(eligibilityData);
  }

  /**
   * Apply 835 remittance payload to claim (paid amount + status).
   * @param {object} claim - insurance_claims row
   * @param {object} remittance - normalized 835 fragment
   */
  static applyRemittanceFrom835(claim, remittance) {
    if (!claim?.id || !remittance) return null;
    const nowIso = new Date().toISOString();
    const paid = typeof remittance.paidAmount === 'number' ? remittance.paidAmount : null;
    const status = paid != null && paid > 0 ? 'paid' : 'processing';

    // Let the existing adjudication pipeline update `status` (and code acceptance tracking).
    this.applyClaimAdjudicationOutcome(claim, status);

    // Split summary vs full detail to avoid duplicating huge payloads in response_data.
    const { rawPayload, ...remittanceSummary } = remittance || {};
    const remittanceDetail = {
      received_at: nowIso,
      ...remittanceSummary,
      rawPayload: rawPayload ?? null
    };

    const updates = {
      status,
      status_checked_at: nowIso,
      payment_amount: paid,
      // Dedicated ERA/835 columns for payment posting + ledger reconciliation.
      remittance_835_received_at: nowIso,
      remittance_835_paid_amount: paid,
      remittance_835_adjustment_reason: remittanceSummary.adjustmentReason || null,
      remittance_835_detail: JSON.stringify(remittanceDetail)
    };

    // Keep payment_status aligned with the claim lifecycle.
    if (status === 'paid') {
      updates.payment_status = 'paid';
      updates.paid_at = nowIso;
    }

    let responseData = {};
    try {
      responseData = claim.response_data
        ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data)
        : {};
    } catch (_) {}

    // Store a lightweight summary in response_data; full raw detail is in remittance_835_detail.
    responseData.remittance_835 = { received_at: nowIso, ...remittanceSummary };
    updates.response_data = JSON.stringify(responseData);

    db.updateInsuranceClaim(claim.id, updates);
    try {
      const orchestrator = require('./rcm-journey-orchestrator');
      const clinicId = claim.clinic_id || claim.clinicId;
      if (clinicId) {
        orchestrator.onRemittancePosted({
          clinicId,
          claimId: claim.id,
          amount: paid || 0,
          payload: {
            patient_responsibility: remittanceSummary.patient_responsibility,
            allowed_amount: remittanceSummary.allowed_amount,
            adjustmentReason: remittanceSummary.adjustmentReason,
          },
        });
      }
    } catch (e) {
      console.warn('⚠️  onRemittancePosted bridge skipped:', e.message);
    }
    return { status, paidAmount: paid };
  }

  /**
   * Query claim status via Stedi Healthcare when configured, else simulation.
   * @private
   */
  static async _queryClaimStatus(claim) {
    if (this.canCallStediHealthcare() && claim.x12_claim_id) {
      try {
        const healthClient = this.getHealthcareClient();
        const paths = this.getStediClaimApiPaths();
        const res = await healthClient.get(paths.status(claim.x12_claim_id)).catch(() => null);
        if (res?.data?.status) {
          const statusMap = { SUCCESS: 'approved', accepted: 'approved', rejected: 'denied', pending: 'processing' };
          const paymentAmount = res.data.paymentAmount ?? res.data.paidAmount ?? null;
          return {
            status: statusMap[res.data.status] || res.data.status,
            paymentAmount,
            statusSource: 'stedi_healthcare'
          };
        }
      } catch (e) {
        console.warn('⚠️  Stedi status check failed:', e.message);
      }
    }

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock status progression
    const statuses = ['submitted', 'processing', 'approved', 'paid'];
    const currentIndex = statuses.indexOf(claim.status);
    
    // If claim was just submitted, move to processing
    // If processing for >1 day, move to approved
    const submittedDate = new Date(claim.submitted_at);
    const daysSinceSubmission = (Date.now() - submittedDate.getTime()) / (1000 * 60 * 60 * 24);

    let newStatus = claim.status;
    if (claim.status === 'submitted' && daysSinceSubmission > 0.1) {
      newStatus = 'processing';
    } else if (claim.status === 'processing' && daysSinceSubmission > 1) {
      newStatus = 'approved';
    } else if (claim.status === 'approved' && daysSinceSubmission > 1.5) {
      newStatus = 'paid';
    }

    return {
      status: newStatus,
      paymentAmount: newStatus === 'paid' ? (claim.total_amount - claim.copay_amount) : null,
      paymentDate: newStatus === 'paid' ? new Date().toISOString() : null,
      message: `Claim ${newStatus}`,
      statusSource: 'simulation'
    };
  }

  /**
   * Map appointment type to CPT code.
   * W3-S4.6: Use getCptCodeForVisit for resolved CPT (replaces hardcoded 90834).
   * When specialty/urgency in options, or when appointmentType maps to specialty.
   */
  static mapAppointmentTypeToCPT(appointmentType, options = {}) {
    try {
      const { getCptCodeForVisit, APPOINTMENT_TYPE_TO_SPECIALTY } = require('../utils/cpt-helper');
      const specialty = options.specialty || (appointmentType && APPOINTMENT_TYPE_TO_SPECIALTY[appointmentType]);
      if (specialty) {
        const code = getCptCodeForVisit({
          specialty,
          isNewPatient: options.isNewPatient !== false,
          urgency: options.urgency || 'routine'
        });
        if (code) return code;
      }
      // Fallback for procedural codes (Group Therapy, Medication Review)
      const proceduralCpt = {
        'Crisis Intervention': '90839',
        'Group Therapy': '90853',
        'Medication Review': '90863'
      };
      return proceduralCpt[appointmentType] || getCptCodeForVisit({ specialty: 'PrimaryCare', urgency: 'routine' });
    } catch (_) {
      return '99213';
    }
  }

  /**
   * Map appointment type to ICD-10 code
   */
  static mapAppointmentTypeToICD10(appointmentType) {
    const icd10Mapping = {
      'Mental Health Consultation': 'F41.9', // Unspecified anxiety disorder
      'Crisis Intervention': 'F41.0', // Panic disorder
      'Follow-up Session': 'F41.9', // Unspecified anxiety disorder
      'Initial Assessment': 'Z00.4', // General psychiatric examination
      'Group Therapy': 'F41.9', // Unspecified anxiety disorder
      'Medication Review': 'F41.9' // Unspecified anxiety disorder
    };

    return icd10Mapping[appointmentType] || 'F41.9'; // Default
  }

  /**
   * Fetch list of insurance payers from Stedi
   * GET /payers or /payers/search
   * 
   * @param {Object} options - Search options
   * @param {string} options.search - Search term (payer name)
   * @param {number} options.limit - Maximum number of results
   * @param {string} options.transactionType - Filter by supported transaction type (e.g., '270', '837')
   * @returns {Object} List of payers
   */
  static async fetchPayers(options = {}) {
    try {
      console.log('\n🏥 INSURANCE: Fetching Payer List from Stedi');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const stediClient = this.getStediClient();
      
      // Try different endpoint variations
      let endpoint = '/payers';
      const params = {};

      // If search term provided, use search endpoint
      if (options.search) {
        endpoint = '/payers/search';
        params.q = options.search;
      }

      // Add pagination if limit provided
      if (options.limit) {
        params.limit = options.limit;
      }

      // Filter by transaction type if provided
      if (options.transactionType) {
        params.transactionType = options.transactionType;
      }

      // Build query string
      const queryString = Object.keys(params).length > 0
        ? '?' + new URLSearchParams(params).toString()
        : '';

      console.log(`   Endpoint: ${endpoint}${queryString}`);

      try {
        const response = await stediClient.get(`${endpoint}${queryString}`);
        
        console.log('✅ Successfully fetched payers from Stedi');
        console.log(`   Response status: ${response.status}`);
        
        // Handle different response formats
        const payers = response.data?.payers || response.data?.data || response.data || [];
        
        console.log(`   Total payers found: ${Array.isArray(payers) ? payers.length : 'N/A'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return {
          success: true,
          payers: Array.isArray(payers) ? payers : [],
          count: Array.isArray(payers) ? payers.length : 0,
          data: response.data
        };

      } catch (apiError) {
        // If Stedi API fails, try alternative endpoints or return error
        console.warn('⚠️  Stedi Payers API call failed:', apiError.message);
        
        if (apiError.response) {
          console.warn('   Status:', apiError.response.status);
          console.warn('   Response:', JSON.stringify(apiError.response.data, null, 2));
          
          // Try alternative endpoint format
          if (apiError.response.status === 404) {
            console.log('   Trying alternative endpoint format...');
            try {
              const altResponse = await stediClient.get('/v1/payers' + queryString);
              const payers = altResponse.data?.payers || altResponse.data?.data || altResponse.data || [];
              
              return {
                success: true,
                payers: Array.isArray(payers) ? payers : [],
                count: Array.isArray(payers) ? payers.length : 0,
                data: altResponse.data
              };
            } catch (altError) {
              console.warn('   Alternative endpoint also failed');
            }
          }
        }

        // Return error but don't throw
        return {
          success: false,
          payers: [],
          count: 0,
          error: apiError.message,
          details: apiError.response?.data
        };
      }

    } catch (error) {
      console.error('❌ Error fetching payers:', error.message);
      return {
        success: false,
        payers: [],
        count: 0,
        error: error.message
      };
    }
  }

  /**
   * Search for a specific payer by name or ID
   * 
   * @param {string} searchTerm - Payer name or ID to search for
   * @returns {Object} Search results
   */
  static async searchPayer(searchTerm) {
    return this.fetchPayers({ search: searchTerm, limit: 50 });
  }

  /**
   * Get all payers (paginated)
   * 
   * @param {number} limit - Maximum number of results (default: 100)
   * @returns {Object} List of payers
   */
  static async getAllPayers(limit = 100) {
    return this.fetchPayers({ limit });
  }
}

if (
  process.env.NODE_ENV === 'production' &&
  InsuranceService.getStediClaimSubmissionMode() === 'institutional'
) {
  console.warn(
    '⚠️  STEDI_CLAIM_SUBMISSION_MODE=institutional — telehealth professional claims (837P) require STEDI_CLAIM_SUBMISSION_MODE=professional'
  );
}

module.exports = InsuranceService;
module.exports.classifyEligibilityQuality = classifyEligibilityQuality;

