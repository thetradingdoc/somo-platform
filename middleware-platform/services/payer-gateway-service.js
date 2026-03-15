const InsuranceService = require('./insurance-service');
const UHCFHIRService = require('./uhc-fhir-service');
const db = require('../database');

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
    const primary = await InsuranceService.checkEligibility(payload);

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
}

module.exports = PayerGatewayService;

