const express = require('express');
const router = express.Router();
const db = require('../database');
const FinancialIntegrityService = require('../services/financial-integrity-service');
const InsuranceService = require('../services/insurance-service');
const RcmService = require('../services/rcm-service');
const { resolveClinicIdFromRequest } = require('../lib/resolve-clinic-id');

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

    return res.json({
      success: true,
      clinic_id: clinicId,
      metrics: {
        claims,
        prior_auth: priorAuth,
        exceptions_pending: Number(exceptions?.count || 0)
      }
    });
  } catch (err) {
    console.error('[rcm] metrics/health error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

