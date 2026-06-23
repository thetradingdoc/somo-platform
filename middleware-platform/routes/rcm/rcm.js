const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../../database');
const FinancialIntegrityService = require('../../services/platform/financial-integrity-service');
const InsuranceService = require('../../services/rcm/insurance-service');
const RcmService = require('../../services/rcm/rcm-service');
const orchestrator = require('../../services/rcm/rcm-journey-orchestrator');
const settlement = require('../../services/rcm/rcm-payment-settlement');
const paymentRequestService = require('../../services/rcm/rcm-payment-request-service');
const { RCM_STAGE_CONTRACT } = require('../../services/rcm/rcm-stage-contract');
const { resolveClinicIdFromRequest } = require('../../lib/resolve-clinic-id');

function safeJsonParse(value) {
  if (value == null) return null;
  try {
    if (typeof value === 'string') return JSON.parse(value);
    return value;
  } catch (_) {
    return null;
  }
}

function requireClinicScope(req) {
  const clinicId = resolveClinicIdFromRequest(req, req.body?.args || {});
  return clinicId ? String(clinicId).trim() : null;
}

function publicPayBase(req) {
  return paymentRequestService.publicPayBaseFromEnv(req);
}

function payUrlFromToken(req, token) {
  return paymentRequestService.payUrlFromToken(publicPayBase(req), token);
}

function stageLabel(stageId) {
  const contract = orchestrator.stageContractMap().get(orchestrator.normalizeStageId(stageId));
  return contract?.label || stageId || 'Unknown';
}

function resolvePatientDisplayName(patientId) {
  if (!patientId) return null;
  try {
    const row = db.getFHIRPatient?.(String(patientId));
    if (!row?.resource_data) return String(patientId);
    const data = typeof row.resource_data === 'string' ? JSON.parse(row.resource_data) : row.resource_data;
    const n = data?.name?.[0];
    if (!n) return String(patientId);
    return n.text || [].concat(n.given || []).join(' ') + (n.family ? ` ${n.family}` : '');
  } catch (_) {
    return String(patientId);
  }
}

function normalizeRailTime(value) {
  if (!value) return 'Today';
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return String(value);
}

/**
 * GET /api/rcm/unified-ledger/:empi_id
 *
 * Step 0: Unified, EMPI-based financial view.
 * - Joins EMPI links, appointments, and invoices (where possible)
 * - Placeholder for FHIR EOBs and safe-harbor calculations
 */
router.get('/unified-ledger/:empi_id', (req, res) => {
  try {
    const empiId = req.params.empi_id;
    if (!empiId) {
      return res.status(400).json({ success: false, error: 'Missing empi_id' });
    }

    const billingMonth = (req.query.billing_month || '').toString().trim() || new Date().toISOString().slice(0, 7); // YYYY-MM

    // 1. Resolve EMPI links
    const links = db.getEmpiLinks(empiId) || [];
    const fhirPatientIds = links
      .filter(l => l.source_system === 'fhir_patient')
      .map(l => l.source_id);

    // 2. Appointments (linked via fhir_patients.resource_id -> appointments.patient_id)
    const appointments = fhirPatientIds.length > 0 ? db.getAppointmentsByPatientIds(fhirPatientIds) : [];

    // 3. Monthly invoices (for now, returned empty; mapping EMPI→customer is a later step)
    const invoices = [];

    // 4. Placeholder: FHIR EOBs; to be wired when EOB storage is in place
    const explanationOfBenefits = [];

    // 5. Safe Harbor (2026 premium protection) – Step 1: real calculation from RCM premium tables
    const premiumTotals = db.getRcmPremiumTotalsForMonth(empiId, billingMonth) || { billed_amount: 0, paid_amount: 0, currency: 'USD' };
    const premiumBilled = parseFloat(premiumTotals.billed_amount || 0);
    const premiumPaid = parseFloat(premiumTotals.paid_amount || 0);
    const safeHarborBase = {
      billed: premiumBilled,
      paid: premiumPaid,
      currency: premiumTotals.currency || 'USD',
      billing_month: billingMonth
    };
    let safeHarborState = {
      status: 'unknown',
      color: 'grey',
      ratio: null,
      amount_to_safe: null,
      ...safeHarborBase
    };
    if (premiumBilled > 0) {
      const ratio = premiumPaid / premiumBilled;
      if (ratio >= 0.95) {
        safeHarborState = { status: 'protected', color: 'green', ratio, amount_to_safe: 0, ...safeHarborBase };
      } else if (ratio >= 0.9) {
        const target = premiumBilled * 0.95;
        safeHarborState = {
          status: 'warning',
          color: 'yellow',
          ratio,
          amount_to_safe: Math.max(0, target - premiumPaid),
          ...safeHarborBase
        };
      } else {
        safeHarborState = { status: 'unprotected', color: 'red', ratio, amount_to_safe: null, ...safeHarborBase };
      }
    }

    return res.json({
      success: true,
      empi_id: empiId,
      links,
      appointments,
      invoices,
      explanation_of_benefit: explanationOfBenefits,
      safe_harbor: safeHarborState
    });
  } catch (err) {
    console.error('[rcm] unified-ledger error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rcm/drafted-fix/apply
 *
 * Applies a provider-approved AI drafted fix for a specific `ai_decisions_rcm` record.
 * Optionally re-submits the associated insurance claim (if the fix requires it).
 */
router.post('/drafted-fix/apply', async (req, res) => {
  try {
    const decisionId = req.body?.decision_id || req.body?.decisionId || req.body?.id || null;
    const actor = req.body?.reviewed_by || req.body?.reviewedBy || req.body?.actor || null;
    const resubmitRequested = Boolean(
      req.body?.resubmit ??
        req.body?.trigger_resubmission ??
        req.body?.triggerResubmission ??
        req.body?.resubmit_requested ??
        false
    );

    if (!decisionId) {
      return res.status(400).json({ success: false, error: 'decision_id is required' });
    }

    const sqlite = db.db;
    if (!sqlite) return res.status(500).json({ success: false, error: 'SQLite not available' });

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const decision = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    if (!decision) return res.status(404).json({ success: false, error: 'AI decision not found' });
    if (String(decision.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const outputSnapshot = safeJsonParse(decision.output_snapshot) || {};
    const inputRef = safeJsonParse(decision.input_ref) || {};

    const claimId =
      outputSnapshot.claim_id ||
      outputSnapshot.claimId ||
      inputRef.claim_id ||
      inputRef.claimId ||
      inputRef.claim ||
      inputRef.insurance_claim_id ||
      null;

    if (!claimId) {
      return res.status(400).json({ success: false, error: 'Could not resolve associated claim_id' });
    }

    // Proposed updates (if present) live inside output_snapshot.
    const proposedUpdates =
      outputSnapshot.claim_updates ||
      outputSnapshot.claimUpdates ||
      outputSnapshot.claim_patch ||
      outputSnapshot.patch ||
      outputSnapshot.updates ||
      outputSnapshot.drafted_fix ||
      outputSnapshot.draftedFix ||
      null;

    // Normalize updates to fields supported by db.updateInsuranceClaim.
    const claim = db.getClaimById?.(claimId) || null;
    const nowIso = new Date().toISOString();
    const allowedUpdates = {};

    if (proposedUpdates && typeof proposedUpdates === 'object') {
      if (proposedUpdates.status !== undefined) allowedUpdates.status = proposedUpdates.status;

      if (proposedUpdates.response_data !== undefined) {
        allowedUpdates.response_data =
          typeof proposedUpdates.response_data === 'string'
            ? proposedUpdates.response_data
            : JSON.stringify(proposedUpdates.response_data);
      }

      if (proposedUpdates.payment_status !== undefined) allowedUpdates.payment_status = proposedUpdates.payment_status;
      if (proposedUpdates.payment_amount !== undefined) allowedUpdates.payment_amount = proposedUpdates.payment_amount;
      if (proposedUpdates.insurance_amount !== undefined) allowedUpdates.insurance_amount = proposedUpdates.insurance_amount;
      if (proposedUpdates.provider_npi !== undefined) allowedUpdates.provider_npi = proposedUpdates.provider_npi;
      if (proposedUpdates.approved_at !== undefined) allowedUpdates.approved_at = proposedUpdates.approved_at;
      if (proposedUpdates.paid_at !== undefined) allowedUpdates.paid_at = proposedUpdates.paid_at;
      if (proposedUpdates.remittance_835_received_at !== undefined) allowedUpdates.remittance_835_received_at = proposedUpdates.remittance_835_received_at;
      if (proposedUpdates.remittance_835_paid_amount !== undefined) allowedUpdates.remittance_835_paid_amount = proposedUpdates.remittance_835_paid_amount;
      if (proposedUpdates.remittance_835_adjustment_reason !== undefined) allowedUpdates.remittance_835_adjustment_reason = proposedUpdates.remittance_835_adjustment_reason;
      if (proposedUpdates.remittance_835_detail !== undefined)
        allowedUpdates.remittance_835_detail = proposedUpdates.remittance_835_detail;
    }

    // Attach audit trail onto claim.response_data (even if proposedUpdates omitted).
    let mergedResponseData = {};
    try {
      mergedResponseData = claim?.response_data
        ? typeof claim.response_data === 'string'
          ? JSON.parse(claim.response_data)
          : claim.response_data
        : {};
    } catch (_) {}

    mergedResponseData.ai_applied_fix = {
      decision_id: decisionId,
      applied_at: nowIso,
      reviewed_by: actor,
      proposed_updates: proposedUpdates || null,
      resubmission_requested: resubmitRequested
    };

    // Ensure resubmission puts the claim back into a submit-able state.
    if (resubmitRequested) {
      allowedUpdates.status = allowedUpdates.status || 'draft';
      allowedUpdates.payment_status = allowedUpdates.payment_status || 'pending';
      // Admin resubmit route also marks response_data with resubmittedAt; replicate minimally.
      mergedResponseData.resubmittedAt = mergedResponseData.resubmittedAt || nowIso;
    }

    allowedUpdates.response_data = JSON.stringify(mergedResponseData);

    if (Object.keys(allowedUpdates).length === 0) {
      return res.json({
        success: true,
        applied: false,
        message: 'No proposed claim updates were found in output_snapshot, but the decision was approved.'
      });
    }

    db.updateInsuranceClaim(claimId, allowedUpdates);

    // Mark decision as approved/applied for HITL tracking.
    sqlite
      .prepare(
        `UPDATE ai_decisions_rcm
         SET human_review_status = 'approved',
             reviewed_by = COALESCE(?, reviewed_by),
             reviewed_at = COALESCE(?, reviewed_at)
         WHERE id = ?`
      )
      .run(actor, nowIso, decisionId);

    let resubmitResult = null;
    if (resubmitRequested) {
      resubmitResult = await InsuranceService.submitExistingClaim(claimId);
    }

    return res.json({
      success: true,
      decision_id: decisionId,
      claim_id: claimId,
      applied_updates: allowedUpdates,
      resubmit: resubmitResult
    });
  } catch (e) {
    console.error('[rcm] drafted-fix/apply error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/rcm/exceptions
 *
 * Provider Exception Inbox feed:
 * - requires_human_review = true
 * - agent_type in (claims_specialist, reconciliation)
 * - sorted by revenue impact (output_snapshot.revenue_impact) desc then created_at desc
 */
router.get('/exceptions', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const merchantId = (req.query.merchant_id || '').toString().trim() || null;
    const clinicId = requireClinicScope(req);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    }

    const all = db.listRcmAiDecisions({ merchant_id: merchantId, clinic_id: clinicId, limit: 200 }) || [];
    const filtered = all.filter((d) => {
      const humanStatus = (d?.human_review_status || 'pending').toString().toLowerCase();
      return (
        d &&
        d.requires_human_review === 1 &&
        (d.agent_type === 'claims_specialist' || d.agent_type === 'reconciliation') &&
        humanStatus === 'pending'
      );
    });

    const withImpact = filtered.map((d) => {
      const out = d.output_snapshot || {};
      const revenueImpact =
        typeof out.revenue_impact === 'number'
          ? out.revenue_impact
          : (out.denied_amount ?? out.claim_amount ?? 0);
      return {
        ...d,
        revenue_impact: parseFloat(revenueImpact || 0)
      };
    });

    withImpact.sort((a, b) => {
      const diff = (b.revenue_impact || 0) - (a.revenue_impact || 0);
      if (diff !== 0) return diff;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    return res.json({
      success: true,
      total: withImpact.length,
      items: withImpact.slice(0, limit)
    });
  } catch (err) {
    console.error('[rcm] exceptions error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rcm/exceptions/:decisionId/assign
 *
 * Assign a pending RCM exception to a human reviewer (HITL queue).
 */
router.post('/exceptions/:decisionId/assign', (req, res) => {
  try {
    const decisionId = req.params.decisionId;
    const assignedTo = req.body?.assigned_to || req.body?.assignedTo || req.body?.assignee || null;
    if (!decisionId) return res.status(400).json({ success: false, error: 'decisionId is required' });
    if (!assignedTo) return res.status(400).json({ success: false, error: 'assigned_to is required' });

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const sqlite = db.db;
    if (!sqlite) return res.status(500).json({ success: false, error: 'SQLite not available' });

    const decision = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    if (!decision) return res.status(404).json({ success: false, error: 'AI decision not found' });
    if (String(decision.clinic_id || '').trim() !== String(clinicId)) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    sqlite
      .prepare(
        `UPDATE ai_decisions_rcm
         SET assigned_to = ?,
             assigned_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(String(assignedTo), String(decisionId));

    const updated = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    return res.json({ success: true, decision: updated });
  } catch (err) {
    console.error('[rcm] exceptions/assign error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rcm/exceptions/:decisionId/resolve
 *
 * Finalize a pending RCM exception with a human decision (approved/rejected).
 */
router.post('/exceptions/:decisionId/resolve', (req, res) => {
  try {
    const decisionId = req.params.decisionId;
    const statusRaw = req.body?.status || req.body?.human_review_status || req.body?.humanReviewStatus || null;
    const reviewedBy = req.body?.reviewed_by || req.body?.reviewedBy || req.body?.actor || null;
    const resolutionReason = req.body?.resolution_reason || req.body?.resolutionReason || null;
    const resolutionNotes = req.body?.resolution_notes || req.body?.resolutionNotes || null;

    if (!decisionId) return res.status(400).json({ success: false, error: 'decisionId is required' });
    const status = statusRaw ? String(statusRaw).toLowerCase().trim() : '';
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'status must be approved|rejected' });
    }

    const sqlite = db.db;
    if (!sqlite) return res.status(500).json({ success: false, error: 'SQLite not available' });

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const decision = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    if (!decision) return res.status(404).json({ success: false, error: 'AI decision not found' });
    if (String(decision.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    sqlite
      .prepare(
        `UPDATE ai_decisions_rcm
         SET human_review_status = ?,
             reviewed_by = COALESCE(?, reviewed_by),
             reviewed_at = CURRENT_TIMESTAMP,
             assigned_to = NULL,
             resolution_reason = ?,
             resolution_notes = ?
         WHERE id = ?`
      )
      .run(status, reviewedBy, resolutionReason, resolutionNotes, String(decisionId));

    const updated = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    return res.json({ success: true, decision: updated });
  } catch (err) {
    console.error('[rcm] exceptions/resolve error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rcm/decisions/:decisionId/eob
 *
 * Returns full audit context (ai_decisions_rcm + associated insurance_claims),
 * and computes a FHIR ExplanationOfBenefit when remittance detail is available.
 */
router.get('/decisions/:decisionId/eob', async (req, res) => {
  try {
    const decisionId = req.params.decisionId;
    const sqlite = db.db;
    if (!sqlite) return res.status(500).json({ success: false, error: 'SQLite not available' });
    if (!decisionId) return res.status(400).json({ success: false, error: 'decisionId is required' });

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const decision = sqlite.prepare(`SELECT * FROM ai_decisions_rcm WHERE id = ? LIMIT 1`).get(String(decisionId));
    if (!decision) return res.status(404).json({ success: false, error: 'AI decision not found' });
    if (String(decision.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const inputRef = safeJsonParse(decision.input_ref) || {};
    const outputSnapshot = safeJsonParse(decision.output_snapshot) || {};

    const claimId =
      outputSnapshot.claim_id ||
      outputSnapshot.claimId ||
      inputRef.claim_id ||
      inputRef.claimId ||
      inputRef.claim ||
      inputRef.insurance_claim_id ||
      null;

    const claim = claimId && db.getClaimById ? db.getClaimById(claimId) : null;
    if (!claim) {
      return res.status(404).json({ success: false, error: 'Associated claim not found', claimId });
    }

    let claimResponseData = {};
    try {
      claimResponseData = claim.response_data ? (typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data) : {};
    } catch (_) {}

    const remittanceDetail = safeJsonParse(claim.remittance_835_detail) || null;
    const remittanceSummary = remittanceDetail || claimResponseData?.remittance_835 || null;

    const empiId = decision.empi_id || decision.empiId || claimResponseData?.empi_id || 'UNKNOWN';
    let computedEob = null;
    if (remittanceSummary && typeof remittanceSummary === 'object') {
      const edi835 = {
        ...remittanceSummary,
        claimId: remittanceSummary.claimId || remittanceSummary.claim_id || claimId
      };
      computedEob = await RcmService.mapEdiToFhirEOB(edi835, empiId);
    }

    return res.json({
      success: true,
      decision: {
        ...decision,
        input_ref: inputRef,
        output_snapshot: outputSnapshot
      },
      claim: {
        ...claim,
        response_data: claimResponseData
      },
      remittance_detail: remittanceDetail,
      computed_eob: computedEob
    });
  } catch (err) {
    console.error('[rcm] decisions/eob error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rcm/reconciliation/run
 * Run deterministic reconciliation (provider report vs internal ledger vs processor state).
 */
router.post('/reconciliation/run', (req, res) => {
  try {
    const { window_start, window_end, owner } = req.body || {};
    const result = FinancialIntegrityService.runDeterministicReconciliation({
      windowStart: window_start,
      windowEnd: window_end,
      owner
    });
    return res.json({
      success: true,
      run: result.run,
      mismatch_count: result.exceptions.length,
      exceptions: result.exceptions
    });
  } catch (err) {
    console.error('[rcm] reconciliation/run error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rcm/reconciliation/exceptions
 * Operational exception queue with owner/SLA fields.
 */
router.get('/reconciliation/exceptions', (req, res) => {
  try {
    const status = (req.query.status || 'open').toString().trim();
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500);
    const items = FinancialIntegrityService.listExceptionQueue({ status, limit });
    return res.json({
      success: true,
      status,
      total: items.length,
      items
    });
  } catch (err) {
    console.error('[rcm] reconciliation/exceptions error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rcm/financial-close?date=YYYY-MM-DD
 * Read or generate daily financial close report.
 */
router.get('/financial-close', (req, res) => {
  try {
    const date = (req.query.date || '').toString().trim();
    const closeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    let report = db.getFinancialCloseReport(closeDate);
    if (!report || req.query.refresh === '1') {
      report = FinancialIntegrityService.generateDailyFinancialCloseReport(closeDate);
    }
    return res.json({
      success: true,
      report
    });
  } catch (err) {
    console.error('[rcm] financial-close error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/rcm/copays/record
 * Records a copay payment tied to appointment/claim/invoice context.
 */
router.post('/copays/record', async (req, res) => {
  try {
    const body = req.body || {};
    const amount = parseFloat(body.amount);
    const currency = body.currency || 'USD';
    const paymentMethod = body.payment_method || body.paymentMethod || null;
    const referenceNumber = body.reference_number || body.referenceNumber || null;
    const notes = body.notes || null;

    const appointmentId = body.appointment_id || body.appointmentId || null;
    const claimId = body.claim_id || body.claimId || null;
    const invoiceId = body.invoice_id || body.invoiceId || null;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'amount is required and must be > 0' });
    }

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    let invoice = invoiceId ? db.getInvoice(invoiceId) : null;
    let claim = claimId ? db.getInsuranceClaim(claimId) : null;
    let appointment = appointmentId ? await db.getAppointment(appointmentId).catch(() => null) : null;

    // Resolve missing relationships using whatever identifier the caller provided.
    if (!invoice) {
      if (claimId && db.getInvoicesByClaim) {
        const invoices = db.getInvoicesByClaim(claimId) || [];
        invoice = invoices[0] || null;
      }
      if (!invoice && appointmentId && db.getClaimsByAppointment) {
        const claims = db.getClaimsByAppointment(appointmentId) || [];
        claim = claims[0] || claim;
        if (claim) {
          const invoices = db.getInvoicesByClaim(claim.id) || [];
          invoice = invoices[0] || null;
        }
      }
    }

    if (!invoice) {
      return res.status(400).json({
        success: false,
        error: 'Could not resolve invoice_id from invoice_id/claim_id/appointment_id'
      });
    }

    // Prefer invoice/claim links when available.
    if (!claim && invoice.claim_id) claim = db.getInsuranceClaim(invoice.claim_id) || null;
    if (!appointment && claim && claim.appointment_id) appointment = await db.getAppointment(claim.appointment_id).catch(() => null);

    if (!appointment || String(appointment.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const patientId = invoice.patient_id || claim?.patient_id || appointment?.patient_id || null;
    const resolvedInvoiceId = invoice.id;
    const resolvedClaimId = claim?.id || invoice.claim_id || claimId || null;
    const resolvedAppointmentId = appointment?.id || claim?.appointment_id || appointmentId || null;

    // Validate balance against invoice payments.
    const totalPaid = db.getInvoicePaymentsTotal(resolvedInvoiceId);
    const balance = invoice.amount - totalPaid;
    if (amount > balance + 0.00001) {
      return res.status(400).json({
        success: false,
        error: `Payment amount (${amount}) exceeds invoice balance (${balance.toFixed(2)})`
      });
    }

    const nowIso = new Date().toISOString();

    // 1) Record as an invoice payment so invoice totals reconcile.
    db.addInvoicePayment({
      invoice_id: resolvedInvoiceId,
      payment_date: nowIso.split('T')[0],
      amount,
      payment_method: paymentMethod,
      reference_number: referenceNumber,
      notes
    });

    // 2) Record as a copay payment for audit + linkage to claim/appointment.
    const copayPayment = db.createCopayPayment({
      appointment_id: resolvedAppointmentId,
      claim_id: resolvedClaimId,
      invoice_id: resolvedInvoiceId,
      patient_id: patientId,
      amount,
      currency,
      payment_method: paymentMethod,
      reference_number: referenceNumber,
      notes,
      received_at: nowIso
    });

    const updatedTotalPaid = db.getInvoicePaymentsTotal(resolvedInvoiceId);
    const updatedBalance = invoice.amount - updatedTotalPaid;

    return res.json({
      success: true,
      copay_payment_id: copayPayment.id,
      invoice_id: resolvedInvoiceId,
      claim_id: resolvedClaimId,
      appointment_id: resolvedAppointmentId,
      amount,
      totals: {
        total_paid: updatedTotalPaid,
        balance: updatedBalance
      }
    });
  } catch (err) {
    console.error('[rcm] copays/record error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/copays/by-claim/:claimId', async (req, res) => {
  try {
    const claimId = req.params.claimId;
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const claim = db.getClaimById?.(claimId) || null;
    if (!claim || !claim.appointment_id) return res.status(403).json({ success: false, error: 'Forbidden (missing appointment scope)' });
    const appointment = await db.getAppointment(claim.appointment_id).catch(() => null);
    if (!appointment || String(appointment.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const payments = (db.getCopayPaymentsByClaim && db.getCopayPaymentsByClaim(claimId)) || [];
    return res.json({ success: true, payments, count: payments.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/copays/by-appointment/:appointmentId', async (req, res) => {
  try {
    const appointmentId = req.params.appointmentId;
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const appointment = await db.getAppointment(appointmentId).catch(() => null);
    if (!appointment || String(appointment.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const payments = (db.getCopayPaymentsByAppointment && db.getCopayPaymentsByAppointment(appointmentId)) || [];
    return res.json({ success: true, payments, count: payments.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/copays/by-invoice/:invoiceId', async (req, res) => {
  try {
    const invoiceId = req.params.invoiceId;
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const invoice = db.getInvoice?.(invoiceId) || null;
    const claim = invoice?.claim_id ? db.getClaimById?.(invoice.claim_id) : null;
    if (!claim || !claim.appointment_id) return res.status(403).json({ success: false, error: 'Forbidden (missing appointment scope)' });
    const appointment = await db.getAppointment(claim.appointment_id).catch(() => null);
    if (!appointment || String(appointment.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const payments = (db.getCopayPaymentsByInvoice && db.getCopayPaymentsByInvoice(invoiceId)) || [];
    return res.json({ success: true, payments, count: payments.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rcm/ledger/:claimId
 * Consolidated ledger view for a single claim:
 * - claim + remittance (ERA/835)
 * - computed EOB (when possible)
 * - invoices + invoice payments
 * - copay payments
 * - prior auth request history (best-effort)
 */
router.get('/ledger/:claimId', async (req, res) => {
  try {
    const claimId = req.params.claimId;
    if (!claimId) return res.status(400).json({ success: false, error: 'claimId is required' });

    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const claim = db.getClaimById?.(claimId) || null;
    if (!claim) return res.status(404).json({ success: false, error: 'Claim not found' });

    if (!claim.appointment_id) {
      return res.status(403).json({ success: false, error: 'Forbidden (missing appointment scope)' });
    }

    const appointment = await db.getAppointment(claim.appointment_id).catch(() => null);
    if (!appointment || String(appointment.clinic_id || '').trim() !== String(clinicId).trim()) {
      return res.status(403).json({ success: false, error: 'Forbidden (clinic scope mismatch)' });
    }

    const claimResponseData = (() => {
      try {
        if (!claim.response_data) return {};
        return typeof claim.response_data === 'string' ? JSON.parse(claim.response_data) : claim.response_data;
      } catch (_) {
        return {};
      }
    })();

    const remittanceDetail = safeJsonParse(claim.remittance_835_detail) || null;
    const remittanceSummary = remittanceDetail || claimResponseData?.remittance_835 || null;

    // Compute EOB from stored 835 summary.
    let computedEob = null;
    if (remittanceSummary && typeof remittanceSummary === 'object') {
      const empiId = claim.patient_id || 'UNKNOWN';
      const edi835 = {
        ...remittanceSummary,
        claimId: remittanceSummary.claimId || remittanceSummary.claim_id || claimId
      };
      computedEob = await RcmService.mapEdiToFhirEOB(edi835, empiId);
    }

    // Invoices + associated payments
    const invoices = db.getInvoicesByClaim?.(claimId) || [];
    const invoicesWithPayments = invoices.map((inv) => {
      const invoicePayments = db.getInvoicePayments?.(inv.id) || [];
      const copayPayments = db.getCopayPaymentsByInvoice?.(inv.id) || [];
      const totalInvoicePaid = db.getInvoicePaymentsTotal?.(inv.id) || 0;
      return {
        ...inv,
        invoice_payments: invoicePayments,
        copay_payments: copayPayments,
        totals: {
          total_invoice_paid: totalInvoicePaid,
          invoice_balance: inv.amount - totalInvoicePaid
        }
      };
    });

    // Copays directly by claim
    const copayPaymentsByClaim = db.getCopayPaymentsByClaim?.(claimId) || [];

    // Prior auth history (best-effort; no dedicated DB helper yet)
    let priorAuthRequests = [];
    try {
      const sqlite = db.db;
      if (sqlite) {
        priorAuthRequests = sqlite
          .prepare(`SELECT * FROM prior_auth_requests WHERE claim_id = ? ORDER BY datetime(created_at) DESC`)
          .all(String(claimId));
      }
    } catch (_) {}

    return res.json({
      success: true,
      claim,
      remittance_detail: remittanceDetail,
      remittance_summary: remittanceSummary,
      computed_eob: computedEob,
      invoices: invoicesWithPayments,
      copays: copayPaymentsByClaim,
      prior_auth_requests: priorAuthRequests
    });
  } catch (err) {
    console.error('[rcm] ledger error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rcm/metrics/health
 *
 * Basic operational health signals scoped to a clinic/tenant.
 */
router.get('/metrics/health', (req, res) => {
  try {
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });

    const sqlite = db.db;
    if (!sqlite) return res.status(500).json({ success: false, error: 'SQLite not available' });

    const claimCounts = sqlite
      .prepare(
        `SELECT c.status, COUNT(*) as count
         FROM insurance_claims c
         JOIN appointments a ON c.appointment_id = a.id
         WHERE a.clinic_id = ?
         GROUP BY c.status`
      )
      .all(String(clinicId));

    const claims = {
      total: 0,
      submitted: 0,
      approved: 0,
      paid: 0,
      remittance_received: 0,
      last_era_received_at: null
    };

    for (const row of claimCounts || []) {
      claims.total += Number(row.count || 0);
      const status = String(row.status || '').toLowerCase();
      if (status === 'submitted') claims.submitted = Number(row.count || 0);
      if (status === 'approved') claims.approved = Number(row.count || 0);
      if (status === 'paid') claims.paid = Number(row.count || 0);
    }

    const eraRow = sqlite
      .prepare(
        `SELECT
           SUM(CASE WHEN c.remittance_835_received_at IS NOT NULL THEN 1 ELSE 0 END) as remittance_received,
           MAX(c.remittance_835_received_at) as last_era_received_at
         FROM insurance_claims c
         JOIN appointments a ON c.appointment_id = a.id
         WHERE a.clinic_id = ?`
      )
      .get(String(clinicId));

    claims.remittance_received = Number(eraRow?.remittance_received || 0);
    claims.last_era_received_at = eraRow?.last_era_received_at || null;

    const priorAuthRows = sqlite
      .prepare(
        `SELECT pr.status, COUNT(*) as count
         FROM prior_auth_requests pr
         JOIN appointments a ON pr.appointment_id = a.id
         WHERE a.clinic_id = ?
         GROUP BY pr.status`
      )
      .all(String(clinicId));

    const priorAuth = { pending: 0, approved: 0, denied: 0, more_info_needed: 0 };
    for (const row of priorAuthRows || []) {
      const status = String(row.status || '').toLowerCase();
      if (status === 'pending') priorAuth.pending = Number(row.count || 0);
      if (status === 'approved') priorAuth.approved = Number(row.count || 0);
      if (status === 'denied') priorAuth.denied = Number(row.count || 0);
      if (status === 'more_info_needed') priorAuth.more_info_needed = Number(row.count || 0);
    }

    const exceptions = sqlite
      .prepare(
        `SELECT COUNT(*) as count
         FROM ai_decisions_rcm
         WHERE clinic_id = ?
           AND requires_human_review = 1
           AND human_review_status = 'pending'
           AND agent_type IN ('claims_specialist','reconciliation')`
      )
      .get(String(clinicId));

    const exceptionsPending = Number(exceptions?.count || 0);

    let collectionOpen = 0;
    let billOpen = 0;
    let paymentsPending = 0;
    try {
      ensureKellyRcmTables();
      const collRow = sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM rcm_journeys WHERE clinic_id = ? AND status = 'open' AND stage = 'patient_collection'`
        )
        .get(String(clinicId));
      collectionOpen = Number(collRow?.c || 0);
      const billRow = sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM rcm_journeys WHERE clinic_id = ? AND status = 'open' AND stage = 'bill'`
        )
        .get(String(clinicId));
      billOpen = Number(billRow?.c || 0);
      const payRow = sqlite
        .prepare(
          `SELECT COUNT(*) AS c FROM rcm_payments
           WHERE clinic_id = ? AND LOWER(status) IN ('requested','sent','pending')
             AND datetime(COALESCE(requested_at, created_at)) >= datetime('now', '-30 days')`
        )
        .get(String(clinicId));
      paymentsPending = Number(payRow?.c || 0);
    } catch (_) { /* rcm tables optional in test */ }

    const pipelineBadge = collectionOpen + billOpen;
    const claimsBadge = claims.submitted;
    const workBadge = priorAuth.pending + exceptionsPending;
    const sidebarBadge = Math.min(
      99,
      pipelineBadge + claimsBadge + paymentsPending + workBadge
    );

    return res.json({
      success: true,
      clinic_id: clinicId,
      metrics: {
        claims,
        prior_auth: priorAuth,
        exceptions_pending: exceptionsPending,
        revenue_badges: {
          sidebar: sidebarBadge,
          tabs: {
            pipeline: pipelineBadge,
            claims: claimsBadge,
            payments: paymentsPending,
            work: workBadge,
          },
        },
      },
    });
  } catch (err) {
    console.error('[rcm] metrics/health error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

let __kellyRcmTablesReady = false;
function ensureKellyRcmTables() {
  if (__kellyRcmTablesReady) return;
  const sqlite = db.db;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rcm_journeys (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      patient_id TEXT,
      source TEXT DEFAULT 'voice',
      stage TEXT DEFAULT 'intake',
      status TEXT DEFAULT 'open',
      amount_due REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_journeys_clinic_created ON rcm_journeys(clinic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rcm_journeys_stage ON rcm_journeys(stage);

    CREATE TABLE IF NOT EXISTS rcm_journey_events (
      id TEXT PRIMARY KEY,
      journey_id TEXT NOT NULL,
      clinic_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      stage_from TEXT,
      stage_to TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_events_journey ON rcm_journey_events(journey_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rcm_ledger_entries (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      direction TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      category TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_ledger_clinic_created ON rcm_ledger_entries(clinic_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rcm_payments (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      patient_id TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'requested',
      method TEXT DEFAULT 'manual',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_payments_clinic_status ON rcm_payments(clinic_id, status);

    CREATE TABLE IF NOT EXISTS rcm_remittances (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      journey_id TEXT,
      payer_name TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'posted',
      posted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rcm_remit_clinic_posted ON rcm_remittances(clinic_id, posted_at DESC);
  `);
  orchestrator.ensureKellyRcmTables();
  __kellyRcmTablesReady = true;
}

router.get('/journeys/stage-contract', (_req, res) => {
  return res.json({ success: true, stages: RCM_STAGE_CONTRACT });
});

router.post('/journeys/start', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const skipGates = Boolean(req.body?.skip_gates || process.env.RCM_E2E_SKIP_GATES === '1');
    const result = orchestrator.startJourney({
      clinicId,
      patientId: req.body?.patient_id || null,
      appointmentId: req.body?.appointment_id || null,
      claimId: req.body?.claim_id || null,
      callId: req.body?.call_id || null,
      source: req.body?.source || 'provider',
      stage: req.body?.stage || 'pre_registration',
      payload: req.body?.payload || {},
      intakeJson: req.body?.intake || req.body?.intake_json || null,
      skipGates,
    });
    return res.json({
      success: true,
      journey_id: result.journey?.id || result.journey_id,
      journey: result.journey,
      created: result.created,
    });
  } catch (err) {
    console.error('[rcm] journeys/start error:', err);
    return res.status(err.code ? 409 : 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.post('/journeys/:journeyId/confirm-intake', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const journeyId = String(req.params.journeyId || '').trim();
    if (!clinicId || !journeyId) {
      return res.status(400).json({ success: false, error: 'clinic_id and journeyId are required' });
    }
    const result = orchestrator.confirmIntake({
      clinicId,
      journeyId,
      intake: req.body?.intake || req.body || {},
      patientId: req.body?.patient_id || null,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[rcm] confirm-intake error:', err);
    return res.status(err.code ? 409 : 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.post('/journeys/:journeyId/events', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const journeyId = String(req.params.journeyId || '').trim();
    if (!clinicId || !journeyId) {
      return res.status(400).json({ success: false, error: 'clinic_id and journeyId are required' });
    }
    const stageTo = req.body?.stage_to;
    if (!stageTo) return res.status(400).json({ success: false, error: 'stage_to is required' });
    const skipGates = Boolean(
      req.body?.skip_gates || req.body?.options?.skip_gates || process.env.RCM_E2E_SKIP_GATES === '1'
    );
    const result = orchestrator.advanceStage({
      journeyId,
      clinicId,
      stageTo,
      stageFrom: req.body?.stage_from || null,
      eventType: req.body?.event_type || 'stage_transition',
      payload: req.body?.payload || req.body || {},
      options: {
        skipGates,
        allowNoPatient: req.body?.allow_no_patient,
        allowNoAppointment: req.body?.allow_no_appointment,
        allowNoClaim: req.body?.allow_no_claim,
        allowNoEligibility: req.body?.allow_no_eligibility,
        dedupeKey: req.body?.dedupe_key,
      },
    });
    const journey = orchestrator.enrichJourney(orchestrator.getJourney(clinicId, journeyId));
    return res.json({ success: true, ...result, journey });
  } catch (err) {
    console.error('[rcm] journeys/:id/events error:', err);
    return res.status(err.code ? 409 : 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.patch('/journeys/:journeyId', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const journeyId = String(req.params.journeyId || '').trim();
    if (!clinicId || !journeyId) {
      return res.status(400).json({ success: false, error: 'clinic_id and journeyId are required' });
    }
    const updates = {};
    if (req.body?.status != null) updates.status = req.body.status;
    if (req.body?.amount_due != null) updates.amount_due = req.body.amount_due;
    if (req.body?.patient_id != null) updates.patient_id = req.body.patient_id;
    if (req.body?.claim_id != null) updates.claim_id = req.body.claim_id;
    if (req.body?.appointment_id != null) updates.appointment_id = req.body.appointment_id;
    const journey = orchestrator.patchJourney(clinicId, journeyId, updates);
    return res.json({ success: true, journey });
  } catch (err) {
    console.error('[rcm] journeys patch error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/journeys', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const journeys = orchestrator.listJourneys(clinicId, {
      limit: req.query.limit,
      patientId: req.query.patient_id,
      appointmentId: req.query.appointment_id,
      status: req.query.status,
      callId: req.query.call_id,
    });
    return res.json({ success: true, journeys });
  } catch (err) {
    console.error('[rcm] journeys error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/patient-context', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) {
      return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    }
    const rawIds = String(req.query.patient_ids || req.query.patient_id || '').trim();
    const patientIds = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (!patientIds.length) {
      return res.status(400).json({ success: false, error: 'patient_ids is required' });
    }

    const context = {};
    for (const patientId of patientIds) {
      const journeyRow = orchestrator.findOpenJourneyForPatient(clinicId, patientId);
      const journey = journeyRow ? orchestrator.enrichJourney(journeyRow) : null;

      let pa_flag = false;
      let pa_label = null;
      try {
        const paReq = db.db
          .prepare(
            `SELECT id, status, cpt_code FROM prior_auth_requests
             WHERE patient_id = ? AND status IN ('pending', 'submitted', 'open')
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(String(patientId));
        if (paReq) {
          pa_flag = true;
          pa_label = paReq.cpt_code ? `PA required — ${paReq.cpt_code}` : 'PA required';
        }
      } catch (_) {}

      if (!pa_flag) {
        try {
          const appt = db.db
            .prepare(
              `SELECT specialty, appointment_type, requires_prior_auth FROM appointments
               WHERE patient_id = ? AND clinic_id = ?
                 AND datetime(appointment_date) >= datetime('now', '-1 day')
                 AND datetime(appointment_date) <= datetime('now', '+14 days')
               ORDER BY appointment_date ASC LIMIT 1`
            )
            .get(String(patientId), String(clinicId));
          if (appt && (appt.requires_prior_auth === 1 || appt.requires_prior_auth === true)) {
            pa_flag = true;
            pa_label = `PA required — ${appt.specialty || appt.appointment_type || 'visit'}`;
          }
        } catch (_) {}
      }

      context[patientId] = { journey, pa_flag, pa_label };
    }

    return res.json({ success: true, context, clinic_id: clinicId });
  } catch (err) {
    console.error('[rcm] patient-context error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/journeys/:journeyId/timeline', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const journeyId = String(req.params.journeyId || '').trim();
    if (!clinicId || !journeyId) {
      return res.status(400).json({ success: false, error: 'clinic_id and journeyId are required' });
    }
    const journey = orchestrator.enrichJourney(orchestrator.getJourney(clinicId, journeyId));
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found' });
    const events = db.db
      .prepare(
        `SELECT * FROM rcm_journey_events WHERE clinic_id = ? AND journey_id = ? ORDER BY created_at DESC`
      )
      .all(clinicId, journeyId);
    return res.json({
      success: true,
      journey_id: journeyId,
      journey,
      events: events.map((e) => ({ ...e, payload: safeJsonParse(e.payload_json) || null })),
    });
  } catch (err) {
    console.error('[rcm] journeys/:id/timeline error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/collection-queue', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const openRows = db.db
      .prepare(
        `SELECT * FROM rcm_journeys
         WHERE clinic_id = ? AND status = 'open'
           AND stage IN ('patient_collection', 'bill')
         ORDER BY updated_at DESC LIMIT 50`
      )
      .all(clinicId);
    const open = openRows.map((r) => {
      const j = orchestrator.enrichJourney(r);
      const stage = String(j.stage || '').toLowerCase();
      return {
        ...j,
        patient_name: resolvePatientDisplayName(j.patient_id),
        stage_label: j.stage_label || stageLabel(j.stage),
        resend_eligible: stage === 'patient_collection' || Number(j.amount_due || 0) > 0,
      };
    });
    const paidRecent = db.db
      .prepare(
        `SELECT * FROM rcm_payments WHERE clinic_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 20`
      )
      .all(clinicId)
      .map((p) => ({
        ...p,
        patient_name: resolvePatientDisplayName(p.patient_id),
        pay_url: payUrlFromToken(req, p.pay_token),
        stage_label: 'Bill',
      }));
    return res.json({ success: true, collection_queue: open, paid_recent: paidRecent });
  } catch (err) {
    console.error('[rcm] collection-queue error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/collection-queue/:journeyId/resend', async (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const journeyId = String(req.params.journeyId || '').trim();
    if (!clinicId || !journeyId) {
      return res.status(400).json({ success: false, error: 'clinic_id and journeyId are required' });
    }

    const journey = orchestrator.enrichJourney(orchestrator.getJourney(clinicId, journeyId));
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found' });

    const patientId = journey.patient_id || req.body?.patient_id || null;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'patient_id is required on journey' });
    }

    const amount =
      req.body?.amount != null
        ? Number(req.body.amount)
        : journey.amount_due != null
          ? Number(journey.amount_due)
          : null;

    const dedupeDay = new Date().toISOString().slice(0, 10);
    try {
      const dup = db.db
        .prepare(
          `SELECT id FROM rcm_journey_events
           WHERE journey_id = ? AND event_type = 'collection_outreach'
             AND dedupe_key = ? LIMIT 1`
        )
        .get(journeyId, `collection_outreach:${journeyId}:${dedupeDay}`);
      if (dup && !req.body?.force) {
        return res.status(409).json({
          success: false,
          error: 'Collection outreach already sent today for this journey',
          code: 'duplicate_outreach',
        });
      }
    } catch (_) {}

    const result = paymentRequestService.createRcmPaymentRequest({
      clinicId,
      amount,
      journeyId,
      patientId,
      method: 'kelly_collection_resend',
      req,
    });
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }

    let patientEmail = req.body?.patient_email || null;
    let patientPhone = req.body?.patient_phone || null;
    if (!patientEmail || !patientPhone) {
      try {
        const fhir = db.getFHIRPatient(patientId);
        if (fhir) {
          patientEmail = patientEmail || fhir.email || null;
          patientPhone = patientPhone || fhir.phone || null;
        }
      } catch (_) {}
    }

    const delivery = req.body?.delivery || 'both';
    await paymentRequestService.notifyPatientPaymentLink({
      payUrl: result.pay_url,
      amount: result.amount,
      patientEmail,
      patientPhone,
      delivery,
      clinicId,
    });

    orchestrator.recordAgentAction({
      journeyId,
      clinicId,
      stageTo: 'follow_up_phone',
      actionType: 'collection_outreach',
      payload: {
        payment_id: result.payment_id,
        pay_token: result.pay_token,
        amount: result.amount,
        patient_id: patientId,
        actor: 'provider_resend',
      },
    });

    db.insertKellyCallEvent?.({
      session_id: null,
      event_type: 'collection_outreach',
      clinic_id: clinicId,
      payload_json: {
        clinic_id: clinicId,
        patient_id: patientId,
        journey_id: journeyId,
        payment_id: result.payment_id,
        amount: result.amount,
        patient_name: resolvePatientDisplayName(patientId),
      },
    });

    return res.json({
      success: true,
      payment_id: result.payment_id,
      pay_url: result.pay_url,
      amount: result.amount,
      journey_id: journeyId,
    });
  } catch (err) {
    console.error('[rcm] collection resend error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/payments/request', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const result = paymentRequestService.createRcmPaymentRequest({
      clinicId,
      amount: req.body?.amount,
      journeyId: req.body?.journey_id || null,
      patientId: req.body?.patient_id || null,
      method: req.body?.method || 'manual',
      req,
    });
    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    return res.json({
      success: true,
      payment_id: result.payment_id,
      pay_token: result.pay_token,
      pay_url: result.pay_url,
    });
  } catch (err) {
    console.error('[rcm] payments/request error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/payments/:paymentId/mark-paid', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    const paymentId = String(req.params.paymentId || '').trim();
    if (!clinicId || !paymentId) {
      return res.status(400).json({ success: false, error: 'clinic_id and paymentId are required' });
    }
    const row = db.db
      .prepare(`SELECT * FROM rcm_payments WHERE id = ? AND clinic_id = ?`)
      .get(paymentId, clinicId);
    if (!row) return res.status(404).json({ success: false, error: 'Payment not found' });
    const result = settlement.markPaidProvider(row, {
      method: req.body?.method || 'manual',
      note: req.body?.note || 'Provider marked paid',
    });
    return res.json(result);
  } catch (err) {
    console.error('[rcm] payments/mark-paid error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/voice-checkouts', (req, res) => {
  try {
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const cols = db.db.prepare('PRAGMA table_info(voice_checkouts)').all().map((c) => c.name);
    if (!cols.includes('clinic_id')) {
      return res.json({ success: true, checkouts: [] });
    }
    const rows = db.db
      .prepare(
        `SELECT id, appointment_id, customer_email, customer_phone, amount, payment_method, status, created_at, completed_at
         FROM voice_checkouts
         WHERE clinic_id = ? AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY created_at DESC LIMIT 100`
      )
      .all(clinicId);
    return res.json({ success: true, checkouts: rows });
  } catch (err) {
    console.error('[rcm] voice-checkouts error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/payments', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const rows = db.db
      .prepare(`SELECT * FROM rcm_payments WHERE clinic_id = ? ORDER BY requested_at DESC LIMIT 100`)
      .all(clinicId);
    const payments = rows.map((p) => {
      const journey = p.journey_id
        ? orchestrator.getJourney(clinicId, p.journey_id)
        : null;
      return {
        ...p,
        patient_name: resolvePatientDisplayName(p.patient_id),
        pay_url: payUrlFromToken(req, p.pay_token),
        journey_stage: journey?.stage || null,
        stage_label: journey ? stageLabel(journey.stage) : null,
      };
    });
    return res.json({ success: true, payments });
  } catch (err) {
    console.error('[rcm] payments error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/remittance', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const amount = Number(req.body?.amount || 0);
    if (!(amount > 0)) return res.status(400).json({ success: false, error: 'amount must be > 0' });
    const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const claimId = req.body?.claim_id || null;
    db.db
      .prepare(
        `INSERT INTO rcm_remittances (id, clinic_id, journey_id, payer_name, amount, detail_json) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        clinicId,
        req.body?.journey_id || null,
        req.body?.payer_name || 'Unknown payer',
        amount,
        JSON.stringify(req.body || {})
      );
    db.db
      .prepare(
        `INSERT INTO rcm_ledger_entries (id, clinic_id, journey_id, direction, amount, category, note) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `led_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        clinicId,
        req.body?.journey_id || null,
        'incoming',
        amount,
        'remittance',
        'Payor remittance posted'
      );
    if (claimId) {
      orchestrator.onRemittancePosted({
        clinicId,
        claimId,
        amount,
        payload: {
          patient_responsibility: req.body?.patient_responsibility,
          allowed_amount: req.body?.allowed_amount,
          manual: true,
        },
      });
    } else if (req.body?.journey_id) {
      try {
        orchestrator.advanceStage({
          journeyId: req.body.journey_id,
          clinicId,
          stageTo: 'remittance_processing',
          eventType: 'remittance_posted',
          payload: { amount, manual: true },
          options: { skipGates: true },
        });
      } catch (_) {
        /* ignore */
      }
    }
    return res.json({ success: true, remittance_id: id });
  } catch (err) {
    console.error('[rcm] remittance error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/payments/summary', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const totals = db.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'requested' THEN amount END), 0) AS requested_total,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid_total,
        COUNT(*) AS payment_count
      FROM rcm_payments
      WHERE clinic_id = ?
    `).get(clinicId);
    const remit = db.db.prepare(`SELECT COALESCE(SUM(amount),0) AS remittance_total FROM rcm_remittances WHERE clinic_id = ?`).get(clinicId);
    return res.json({ success: true, summary: { ...totals, remittance_total: Number(remit?.remittance_total || 0) } });
  } catch (err) {
    console.error('[rcm] payments/summary error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/metrics/ar-days', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const openCount = db.db.prepare(`SELECT COUNT(*) AS c FROM rcm_journeys WHERE clinic_id = ? AND status = 'open'`).get(clinicId);
    const paidTotal = db.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM rcm_payments WHERE clinic_id = ? AND status = 'paid'`).get(clinicId);
    const remittanceTotal = db.db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM rcm_remittances WHERE clinic_id = ?`).get(clinicId);
    const denominator = Number(paidTotal?.total || 0) + Number(remittanceTotal?.total || 0);
    const arDays = denominator > 0 ? Math.max(1, Math.round((Number(openCount?.c || 0) * 30) / denominator * 1000) / 10) : Number(openCount?.c || 0) * 30;
    return res.json({ success: true, clinic_id: clinicId, ar_days: arDays, open_journeys: Number(openCount?.c || 0) });
  } catch (err) {
    console.error('[rcm] metrics/ar-days error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/remittances', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const rows = db.db
      .prepare(
        `SELECT id, clinic_id, journey_id, payer_name, amount, posted_at
         FROM rcm_remittances WHERE clinic_id = ? ORDER BY COALESCE(posted_at, id) DESC LIMIT ?`
      )
      .all(clinicId, limit);
    return res.json({ success: true, clinic_id: clinicId, remittances: rows });
  } catch (err) {
    console.error('[rcm] remittances list error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/command-center', (req, res) => {
  try {
    ensureKellyRcmTables();
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const stages = db.db
      .prepare(`SELECT stage, COUNT(*) AS count FROM rcm_journeys WHERE clinic_id = ? GROUP BY stage`)
      .all(clinicId)
      .map((row) => ({
        ...row,
        stage_label: stageLabel(row.stage),
      }));
    const summary = db.db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM rcm_journeys WHERE clinic_id = ?) AS journeys_total,
        (SELECT COUNT(*) FROM rcm_journeys WHERE clinic_id = ? AND status = 'open') AS journeys_open,
        (SELECT COALESCE(SUM(amount), 0) FROM rcm_payments WHERE clinic_id = ?) AS patient_payments_total,
        (SELECT COALESCE(SUM(amount), 0) FROM rcm_remittances WHERE clinic_id = ?) AS remittance_total
    `
      )
      .get(clinicId, clinicId, clinicId, clinicId);
    const collection = db.db
      .prepare(
        `SELECT COUNT(*) AS c FROM rcm_journeys WHERE clinic_id = ? AND status = 'open' AND stage = 'patient_collection'`
      )
      .get(clinicId);
    return res.json({
      success: true,
      clinic_id: clinicId,
      summary: { ...summary, collection_open: Number(collection?.c || 0) },
      stages,
    });
  } catch (err) {
    console.error('[rcm] command-center error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/recent-calls', (req, res) => {
  try {
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const limit = Math.min(parseInt(req.query.limit || '5', 10) || 5, 20);
    const rows = db.db.prepare(`
      SELECT id, patient_name, date, time, status, appointment_type, notes, created_at
      FROM appointments
      WHERE clinic_id = ?
      ORDER BY COALESCE(created_at, date || ' ' || time) DESC
      LIMIT ?
    `).all(clinicId, limit);
    const items = rows.map((row) => {
      const status = String(row.status || 'scheduled').toLowerCase();
      const badge =
        status === 'scheduled' ? { badge: 'New Booking', badgeType: 'green' }
          : status === 'rescheduled' ? { badge: 'Rescheduled', badgeType: 'orange' }
            : status === 'confirmed' ? { badge: 'Confirmed', badgeType: 'blue' }
              : null;
      return {
        id: String(row.id),
        patient: row.patient_name || 'Patient',
        time: normalizeRailTime(row.time || row.created_at),
        timeRaw: row.created_at || row.time,
        summary: row.appointment_type || 'Appointment call',
        status,
        ...badge,
        cta: { label: 'Open schedule', href: 'calendar.html' }
      };
    });
    return res.json({ success: true, clinic_id: clinicId, items });
  } catch (err) {
    console.error('[rcm] recent-calls error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/recent-messages', (req, res) => {
  try {
    const clinicId = requireClinicScope(req);
    if (!clinicId) return res.status(400).json({ success: false, error: 'clinic_id is required for tenant scoping' });
    const limit = Math.min(parseInt(req.query.limit || '5', 10) || 5, 20);
    const rows = db.db.prepare(`
      SELECT id, explanation, output_snapshot, created_at
      FROM ai_decisions_rcm
      WHERE clinic_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(clinicId, limit);
    const items = rows.map((row) => {
      const output = safeJsonParse(row.output_snapshot) || {};
      return {
        id: String(row.id),
        patient: output.patient_name || 'Patient',
        time: normalizeRailTime(row.created_at),
        timeRaw: row.created_at,
        summary: row.explanation || output.summary || 'RCM follow-up generated',
        status: 'new',
        badge: 'New message',
        badgeType: 'green',
        unread: 1,
        cta: { label: 'Open claims', href: 'billing.html?section=claims' }
      };
    });
    return res.json({ success: true, clinic_id: clinicId, items });
  } catch (err) {
    console.error('[rcm] recent-messages error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/ui-telemetry', (req, res) => {
  try {
    const clinicId = requireClinicScope(req);
    const payload = {
      clinic_id: clinicId || null,
      page: String(req.body?.page || 'unknown'),
      panel: String(req.body?.panel || 'unknown'),
      status: String(req.body?.status || 'unknown'),
      detail: String(req.body?.detail || ''),
      at: new Date().toISOString()
    };
    console.info('[rcm][ui-telemetry]', payload);
    return res.json({ success: true });
  } catch (err) {
    console.error('[rcm] ui-telemetry error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

