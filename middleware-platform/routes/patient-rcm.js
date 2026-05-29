'use strict';

const db = require('../database');
const orchestrator = require('../services/rcm-journey-orchestrator');

function registerPatientRcmRoutes(app, deps) {
  const { apiLimiter, requirePatientSession, resolvePatientIdFromSession } = deps;

  function publicPayBase(req) {
    const base =
      process.env.PUBLIC_PAY_BASE_URL ||
      process.env.APP_PUBLIC_URL ||
      `${req.protocol}://${req.get('host')}`;
    return String(base).replace(/\/$/, '');
  }

  function payUrlFromToken(req, token) {
    if (!token) return null;
    return `${publicPayBase(req)}/patients/pay.html?token=${encodeURIComponent(token)}`;
  }

  function mapBillChip({ journey, claim, payment }) {
    const stage = journey ? orchestrator.normalizeStageId(journey.stage) : null;
    if (payment?.status === 'paid' || stage === 'bill') {
      return { chip: 'paid', label: 'Paid' };
    }
    if (stage === 'patient_collection' || payment?.status === 'requested') {
      return { chip: 'patient_due', label: 'Amount due' };
    }
    if (claim?.status === 'denied') {
      return { chip: 'denied', label: 'Denied' };
    }
    if (claim?.status === 'approved' || claim?.status === 'paid') {
      return { chip: 'approved', label: 'Approved' };
    }
    if (stage === 'claim_submission' || claim?.status === 'submitted' || claim?.status === 'pending') {
      return { chip: 'claim_submitted', label: 'Submitted' };
    }
    if (stage === 'remittance_processing' || claim?.status === 'processing') {
      return { chip: 'payer_processing', label: 'Payer processing' };
    }
    if (stage === 'registration' || stage === 'pre_registration') {
      return { chip: 'eligibility_pending', label: 'Waiting' };
    }
    return { chip: 'waiting', label: 'In progress' };
  }

  app.get(
    '/api/patient/rcm/bill-status',
    apiLimiter,
    requirePatientSession,
    (req, res) => {
      try {
        orchestrator.ensureKellyRcmTables();
        const { patientId } = resolvePatientIdFromSession(req.patientSession || {});
        if (!patientId) {
          return res.status(401).json({ success: false, error: 'Patient session required' });
        }

        const fhirId = String(patientId);
        const journeys = db.db
          .prepare(
            `SELECT * FROM rcm_journeys WHERE patient_id = ? ORDER BY updated_at DESC LIMIT 25`
          )
          .all(fhirId);

        const bills = [];
        for (const row of journeys) {
          const journey = orchestrator.enrichJourney(row);
          let claim = null;
          if (journey.claim_id) {
            try {
              claim = db.getInsuranceClaim?.(journey.claim_id) || null;
            } catch (_) {
              claim = null;
            }
          }
          const payment = db.db
            .prepare(
              `SELECT * FROM rcm_payments WHERE journey_id = ? ORDER BY requested_at DESC LIMIT 1`
            )
            .get(journey.id);
          const status = mapBillChip({ journey, claim, payment });
          bills.push({
            journey_id: journey.id,
            clinic_id: journey.clinic_id,
            journey_stage: journey.stage,
            journey_stage_label: journey.stage_contract?.label || journey.stage,
            claim_id: journey.claim_id || null,
            claim_status: claim?.status || null,
            amount_due: journey.amount_due ?? payment?.amount ?? null,
            payment_status: payment?.status || null,
            pay_url:
              payment?.status === 'requested' ? payUrlFromToken(req, payment.pay_token) : null,
            status_chip: status.chip,
            status_label: status.label,
            updated_at: journey.updated_at,
          });
        }

        return res.json({ success: true, patient_id: fhirId, bills });
      } catch (err) {
        console.error('[patient-rcm] bill-status error:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }
  );
}

module.exports = { registerPatientRcmRoutes };
