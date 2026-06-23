'use strict';

const InsuranceService = require('../../services/rcm/insurance-service');

function registerPatientInsuranceRoutes(app, deps) {
  const {
    apiLimiter,
    express,
    db,
    requirePatientSession,
    resolvePatientIdFromSession,
    recordPatientPortalEvent,
    PatientPortalService,
    blockWalletWhenDisabled,
    blockChatWhenDisabled,
    withIdempotency,
    botGuard,
    authLimiter,
    otpSendLimiter,
    otpConfirmLimiter,
    requireAdminAuth,
    sendUploadLinkHandler,
    issuePatientDocumentDownloadUrl,
    parseBillingDocumentUpload,
    billingOk,
    billingErr,
    resolveBillingSubscription,
    requirePlusForBillingFeature,
    isPatientWalletEnabled,
    isPatientChatEnabled,
    parseBooleanFlag,
  } = deps;

app.get('/api/patient/insurance', async (req, res) => {
  try {
    const { patientId } = req.query;

    if (!patientId) {
      return res.status(400).json({ success: false, error: 'Patient ID required' });
    }

    const insurance = db.getAllPatientInsurance(patientId) || [];

    return res.json({
      success: true,
      patientId,
      insurance,
      count: insurance.length
    });
  } catch (error) {
    console.error('Error fetching patient insurance:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/patient/insurance', apiLimiter, express.json(), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res.status(401).json({ success: false, error: 'x-session-id required' });
    }

    const { payer_name, payer_id, member_id, plan_name } = req.body || {};
    if (!member_id && !payer_name && !payer_id) {
      return res.status(400).json({ success: false, error: 'At least payer or member_id required' });
    }

    // Resolve patient via profile API
    const profileResult = PatientPortalService.getPatientProfile(sessionId);
    if (!profileResult.success) {
      return res.status(401).json({ success: false, error: 'Invalid session or patient not found' });
    }

    // We need the FHIR patient_id; get from underlying db using email/phone again
    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }
    let patient = null;
    if (sessionValidation.email) {
      patient = db.getFHIRPatientByEmail(sessionValidation.email);
    }
    if (!patient && sessionValidation.phone) {
      patient = db.getFHIRPatientByPhone(sessionValidation.phone);
    }
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found for insurance update' });
    }
    const patientId = patient.resource_id;

    // Resolve payer_id if missing
    let finalPayerId = payer_id || null;
    if (!finalPayerId && payer_name && isPayorCanonicalResolverEnabled()) {
      try {
        const canonical = resolveRuntimePayor({ payer_name });
        if (canonical?.resolved && canonical?.routing?.payer_id) {
          finalPayerId = canonical.routing.payer_id;
        }
      } catch (e) {
        console.warn('⚠️  Canonical payor resolver failed during insurance update:', e.message);
      }
    }
    if (!finalPayerId && payer_name && PayerCacheService && PayerCacheService.searchPayer) {
      try {
        const payerMatch = await PayerCacheService.searchPayer(payer_name);
        const resolution = resolvePayerSearchResult(payerMatch);
        if (resolution.status === 'single') {
          finalPayerId = resolution.payer_id;
        } else if (resolution.status === 'ambiguous') {
          return res.status(409).json({
            success: false,
            error: 'Multiple payer matches found. Please provide payer_id or select a specific payer.',
            ambiguous_payer: true,
            requires_payer_confirmation: true,
            suggestions: resolution.suggestions
          });
        } else if (resolution.status === 'none') {
          return res.status(404).json({
            success: false,
            error: `Payer "${payer_name}" not found. Please provide a valid payer_name or payer_id.`,
            no_payer_match: true,
            suggestions: []
          });
        } else {
          return res.status(502).json({
            success: false,
            error: resolution.error || 'Unable to resolve payer by name'
          });
        }
      } catch (e) {
        console.warn('⚠️  Failed to search payer by name:', e.message);
      }
    }

    // Upsert patient_insurance
    try {
      if (db.upsertPatientInsurance) {
        db.upsertPatientInsurance({
          patient_id: patientId,
          payer_id: finalPayerId,
          payer_name,
          member_id,
          plan_name,
          is_primary: 1
        });
      } else {
        db.db.prepare(`
          INSERT INTO patient_insurance (patient_id, payer_id, payer_name, member_id, plan_name, is_primary)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(patient_id, payer_id, member_id) DO UPDATE SET
            payer_name = excluded.payer_name,
            plan_name = excluded.plan_name,
            is_primary = 1
        `).run(patientId, finalPayerId, payer_name || null, member_id || null, plan_name || null);
      }
    } catch (e) {
      console.error('❌ Failed to upsert patient_insurance:', e.message);
      return res.status(500).json({ success: false, error: 'Failed to update insurance' });
    }

    // Optionally: re-run eligibility if we have payer + member
    if (finalPayerId && member_id) {
      try {
        // Ensure we pass subscriber identity details to Stedi to avoid AAA 71 (DOB mismatch).
        // `patient` is a FHIR patient row where the canonical fields live under `patient.resource_data`.
        const fhirPatient = patient?.resource_data || {};

        const fhirName = Array.isArray(fhirPatient.name) && fhirPatient.name[0] ? fhirPatient.name[0] : null;
        const patientName = fhirName
          ? `${(fhirName.given || []).join(' ')} ${fhirName.family || ''}`.trim()
          : null;

        const rawDob = fhirPatient.birthDate || fhirPatient.birth_date || null;
        const dateOfBirth = rawDob
          ? (() => {
              const s = String(rawDob).trim();
              if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
              const iso = new Date(s).toISOString().split('T')[0];
              return iso;
            })()
          : null;

        await InsuranceService.checkEligibility({
          patientId,
          memberId: member_id,
          payerId: finalPayerId,
          patientName,
          dateOfBirth,
          surface: 'patient_portal',
          dateOfService: new Date().toISOString().split('T')[0]
        });
      } catch (e) {
        console.warn('⚠️  Eligibility re-check failed during insurance update:', e.message);
      }
    }

    // Mark insurance_verified on fhir_patients
    try {
      db.db.prepare(`
        UPDATE fhir_patients
        SET insurance_verified = 1,
            insurance_verified_at = datetime('now')
        WHERE resource_id = ?
      `).run(patientId);
    } catch (_) {}

    return res.json({ success: true, patient_id: patientId });
  } catch (error) {
    console.error('❌ Error updating patient insurance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
}

module.exports = { registerPatientInsuranceRoutes };
