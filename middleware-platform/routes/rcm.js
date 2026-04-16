const express = require('express');
const router = express.Router();
const db = require('../database');
const FinancialIntegrityService = require('../services/financial-integrity-service');

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
    const clinicId = (req.query.clinic_id || '').toString().trim() || null;

    const all = db.listRcmAiDecisions({ merchant_id: merchantId, clinic_id: clinicId, limit: 200 }) || [];
    const filtered = all.filter((d) =>
      d &&
      d.requires_human_review === 1 &&
      (d.agent_type === 'claims_specialist' || d.agent_type === 'reconciliation')
    );

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

module.exports = router;

