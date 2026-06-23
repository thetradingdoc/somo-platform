/**
 * Proof of Care Service
 * Verifies that care was delivered before enabling settlement release.
 * Used by escrow flow: USDC held in "pending" until Proof of Care verified.
 *
 * Impact-Weighted Extension: When Octopi AI scan data present, verifies:
 * - data_integrity_hash (salted SHA-256 of scan)
 * - High AI confidence score
 * - Specialist sign-off (M-of-N for Tier 2)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../../database');
const RULES_PATH = path.resolve(__dirname, '../../Knowledge/rules/proof-of-care-rules.json');

const MIN_AI_CONFIDENCE = parseFloat(process.env.OCTOPI_MIN_AI_CONFIDENCE || '0.9');

let rulesConfig = null;

function loadRules() {
  if (rulesConfig) return rulesConfig;
  try {
    if (fs.existsSync(RULES_PATH)) {
      rulesConfig = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
      return rulesConfig;
    }
  } catch (error) {
    console.warn('⚠️  Failed to load proof-of-care rules:', error.message);
  }
  rulesConfig = { rules: [], minWeightToVerify: 0.8, requireAnyRule: true };
  return rulesConfig;
}

/**
 * Verify Proof of Care for a claim.
 *
 * @param {Object} claim - Claim from database
 * @param {Object} options - { dbOverride } for testing
 * @returns {Promise<Object>} { verified, totalWeight, evidence, reason }
 */
async function verifyProofOfCare(claim, options = {}) {
  const config = loadRules();
  const evidence = [];
  let totalWeight = 0;
  const dbInstance = options.dbOverride || db;

  if (!claim || !claim.id) {
    return { verified: false, totalWeight: 0, evidence: [], reason: 'No claim provided' };
  }

  // 1. Appointment completed
  if (claim.appointment_id) {
    let appointment = null;
    try {
      appointment = dbInstance.getAppointment
        ? await dbInstance.getAppointment(claim.appointment_id)
        : dbInstance.prepare?.('SELECT * FROM appointments WHERE id = ?')?.get?.(claim.appointment_id);
    } catch (_) {}
    if (appointment) {
      const rule = config.rules?.find(r => r.id === 'appointment_completed');
      const validStatus = rule?.requiredStatus || ['completed'];
      if (validStatus.includes(appointment.status)) {
        totalWeight += rule?.weight ?? 1.0;
        evidence.push({ rule: 'appointment_completed', status: appointment.status });
      }
    }
  }

  // 2. FHIR encounter finished (voice call completed)
  if (claim.patient_id && dbInstance.prepare) {
    try {
      const encRow = dbInstance.prepare(
        `SELECT * FROM fhir_encounters WHERE patient_id = ? AND status IN ('finished','completed') AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`
      ).get(claim.patient_id);
      if (encRow) {
        const rule = config.rules?.find(r => r.id === 'encounter_finished');
        totalWeight += rule?.weight ?? 1.0;
        evidence.push({ rule: 'encounter_finished', encounterId: encRow.resource_id });
      }
    } catch (_) {}
  }

  // 3. EHR encounter synced (has ehr_encounters record)
  if (claim.appointment_id && dbInstance.getEHREncountersByAppointment) {
    try {
      const ehrEncs = dbInstance.getEHREncountersByAppointment(claim.appointment_id) || [];
      if (ehrEncs.length > 0) {
        const rule = config.rules?.find(r => r.id === 'ehr_encounter_synced');
        totalWeight += rule?.weight ?? 1.0;
        evidence.push({ rule: 'ehr_encounter_synced', count: ehrEncs.length });
      }
    } catch (_) {}
  }

  // 4. PDF coding uploaded (claim created from PDF)
  let claimDetails = {};
  if (claim.response_data) {
    try {
      claimDetails = typeof claim.response_data === 'string'
        ? JSON.parse(claim.response_data)
        : claim.response_data;
    } catch (_) {}
  }
  if (claimDetails.createdFrom === 'pdf-coding') {
    const rule = config.rules?.find(r => r.id === 'pdf_coding_uploaded');
    totalWeight += rule?.weight ?? 1.0;
    evidence.push({ rule: 'pdf_coding_uploaded' });
  }

  // 5. Claim has ICD-10/CPT coding
  const hasIcd10 = (claimDetails.coding?.icd10?.length || 0) > 0 || (claim.diagnosis_code && claim.diagnosis_code !== 'N/A');
  const hasCpt = (claimDetails.coding?.cpt?.length || 0) > 0 || (claim.service_code && claim.service_code !== 'N/A');
  if (hasIcd10 || hasCpt) {
    const rule = config.rules?.find(r => r.id === 'claim_has_coding');
    totalWeight += (rule?.weight ?? 0.8);
    evidence.push({ rule: 'claim_has_coding', hasIcd10, hasCpt });
  }

  // 6. Octopi AI verification (when data_integrity_hash present)
  const octopiHash = claim.data_integrity_hash || claimDetails.octopi_scan_hash || options?.octopiHash;
  const aiConfidence = claimDetails.ai_confidence_score ?? claim.ai_confidence_score ?? options?.aiConfidence;
  const specialistSignedOff = claimDetails.specialist_signed_off ?? claim.specialist_signed_off ?? options?.specialistSignedOff;
  const specialistSignatureCount = claimDetails.specialist_signature_count ?? claim.specialist_signature_count ?? options?.specialistSignatureCount ?? (specialistSignedOff ? 1 : 0);

  if (octopiHash) {
    evidence.push({ rule: 'octopi_hash_present', dataIntegrityHash: octopiHash });
    if (typeof aiConfidence === 'number' && aiConfidence >= MIN_AI_CONFIDENCE) {
      totalWeight += 0.5;
      evidence.push({ rule: 'ai_high_confidence', score: aiConfidence });
    }
    if (specialistSignedOff === true) {
      totalWeight += 0.3;
      evidence.push({ rule: 'specialist_signed_off' });
    }
    // M-of-N: Tier 2 (rare/cancer) requires 2+ specialist signatures
    const impactTier = claim.impact_tier ?? claimDetails.impact_tier ?? 1;
    const requiredSignatures = impactTier === 2 ? 2 : 1;
    const sigCount = typeof specialistSignatureCount === 'number' ? specialistSignatureCount : (specialistSignedOff ? 1 : 0);
    if (sigCount >= requiredSignatures) {
      totalWeight += 0.2;
      evidence.push({ rule: 'm_of_n_specialists', count: sigCount, required: requiredSignatures, impactTier });
    }
  }

  const minWeight = config.minWeightToVerify ?? 0.8;
  const verified = totalWeight >= minWeight;

  return {
    verified,
    totalWeight,
    evidence,
    reason: verified
      ? `Proof of Care verified (weight ${totalWeight.toFixed(1)} >= ${minWeight})`
      : `Insufficient Proof of Care (weight ${totalWeight.toFixed(1)} < ${minWeight})`
  };
}

/**
 * Check if settlement can proceed (Proof of Care + Settlement Rules).
 * Used by escrow integration to decide auto-release.
 */
async function canReleaseSettlement(claim, settlementEvaluation, options = {}) {
  const strictPoc = process.env.PROOF_OF_CARE_REQUIRED === '1' || process.env.PROOF_OF_CARE_REQUIRED === 'true';
  const poc = await verifyProofOfCare(claim, options);

  const settlementOk = settlementEvaluation?.action === 'auto_approve';
  const pocOk = !strictPoc || poc.verified;

  return {
    canRelease: settlementOk && pocOk,
    proofOfCare: poc,
    settlementEvaluation,
    blockedBy: !settlementOk ? 'settlement_rules' : !pocOk ? 'proof_of_care' : null
  };
}

/**
 * Generate salted SHA-256 data_integrity_hash for Octopi scan.
 * Salt prevents reverse lookup of PHI from hash (GDPR/HIPAA safe).
 * @param {string} scanIdOrPayload - Scan ID or serialized scan metadata
 * @param {string} salt - Secret salt (never store raw PHI)
 * @returns {string} Hex-encoded hash (0x-prefix for Solidity bytes32)
 */
function generateDataIntegrityHash(scanIdOrPayload, salt = '') {
  const s = typeof salt === 'string' && salt ? salt : crypto.randomBytes(16).toString('hex');
  const payload = `${scanIdOrPayload}:${s}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return '0x' + hash;
}

module.exports = {
  verifyProofOfCare,
  canReleaseSettlement,
  loadRules,
  generateDataIntegrityHash,
  MIN_AI_CONFIDENCE
};
