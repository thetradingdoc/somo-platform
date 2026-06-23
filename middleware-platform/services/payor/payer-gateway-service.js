const InsuranceService = require('../rcm/insurance-service');
const UHCFHIRService = require('../platform/uhc-fhir-service');
const db = require('../../database');

class PayerGatewayService {
  /**
   * Resolve which backend to use for a payer: 'stedi' or 'uhc_fhir' or 'stedi+uhc_fhir'.
   * Simple heuristic based on payer_id and local config.
   */
  static resolveBackend(payerId) {
    const id = (payerId || '').toUpperCase();
    if (!id) return 'stedi';

    // Example: route UHC to FHIR when credentials present
    const hasUhcCreds = !!(process.env.UHC_CLIENT_ID && process.env.UHC_CLIENT_SECRET);
    if (id === 'UHC' && hasUhcCreds) return 'stedi+uhc_fhir';
    return 'stedi';
  }

  /**
   * Eligibility wrapper. Always returns a normalized structure, regardless of backend.
   */
  static async checkEligibility(payload) {
    const backend = this.resolveBackend(payload.payerId);
    let primary;
    try {
      primary = await InsuranceService.checkEligibility(payload);
      if (primary?.stediFallback) {
        try {
          const Metrics = require('../shared/metrics');
          Metrics.increment('stedi_eligibility_fallback_rate');
        } catch (_) {}
      }
    } catch (e) {
      try {
        const Metrics = require('../shared/metrics');
        Metrics.increment('stedi_eligibility_error_rate');
      } catch (_) {}
      throw e;
    }

    if (backend === 'stedi') {
      return { backend, primary, fhir: null };
    }

    // Best-effort UHC FHIR enrichment
    let fhirData = null;
    try {
      const patientId = payload.fhirPatientId || payload.patientId || null;
      if (patientId) {
        const coverage = await UHCFHIRService.pullCoverageData(patientId, { useSandbox: process.env.UHC_USE_SANDBOX !== '0' });
        fhirData = coverage;
      }
    } catch (e) {
      fhirData = { success: false, error: e.message };
    }

    return { backend, primary, fhir: fhirData };
  }

  /**
   * Claim submission wrapper. Uses Stedi today; can later route to FHIR Claim.
   */
  static async submitClaim(payload) {
    const backend = this.resolveBackend(payload.payerId);
    const primary = await InsuranceService.submitClaim(payload);
    if (primary?.stediFallback) {
      try {
        const Metrics = require('../shared/metrics');
        Metrics.increment('stedi_claim_fallback_rate');
      } catch (_) {}
    }
    return { backend, primary };
  }

  /** Provider portal: submit existing claim row via Stedi 837. */
  static async submitExistingClaim(claimId) {
    const claim = db.getInsuranceClaim(claimId);
    const backend = claim ? this.resolveBackend(claim.payer_id) : 'stedi';
    const primary = await InsuranceService.submitExistingClaim(claimId);
    if (primary?.stediFallback) {
      try {
        const Metrics = require('../shared/metrics');
        Metrics.increment('stedi_claim_fallback_rate');
      } catch (_) {}
    }
    return { backend, primary };
  }

  /**
   * Claim status wrapper. Uses Stedi/insurance-service, optionally enriches with FHIR EOB.
   */
  static async checkClaimStatus(claimId, options = {}) {
    const claim = db.getInsuranceClaim(claimId);
    if (!claim) {
      throw new Error('Claim not found');
    }
    const backend = this.resolveBackend(claim.payer_id);
    const primary = await InsuranceService.checkClaimStatus(claimId);

    let fhir = null;
    if (backend !== 'stedi' && claim.patient_id) {
      try {
        const eobs = await UHCFHIRService.pullClaimsData(claim.patient_id, { useSandbox: process.env.UHC_USE_SANDBOX !== '0' });
        fhir = eobs;
      } catch (e) {
        fhir = { success: false, error: e.message };
      }
    }

    return { backend, primary, fhir };
  }

  /**
   * Prior auth submission wrapper.
   *
   * Phase 1 behavior: explicitly unsupported via Stedi (no X12 278).
   * This keeps a stable interface for Phase 2 rails (UHC FHIR write / partner).
   */
  static async submitPriorAuth() {
    return {
      backend: 'stedi',
      success: false,
      code: 'STEDI_278_UNSUPPORTED',
      manualReview: true,
      error: 'Stedi does not currently support X12 278 prior authorization submission.'
    };
  }
}

module.exports = PayerGatewayService;

