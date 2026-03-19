/**
 * Telemedicine Phase 7 — Case report: internal transcript endpoint + callback.
 * Task 53: GET /internal/communications/:encounterId/text (Bearer CASE_REPORT_SERVICE_TOKEN).
 * Task 55: POST /api/case-report/callback (validate token, update row, create DiagnosticReport, notify, audit).
 * Task 56: On status 'failed': update error_message, alert clinic admin, audit_log.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');
const FHIRService = require('../services/fhir-service');
const EmailService = require('../services/email-service');
let stripe = null;
try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch (_) {}

/**
 * GET /api/patient/:patientId/case-report
 * Aggregate longitudinal view for a single patient.
 * Protected by admin auth to ensure only staff can view longitudinal data.
 */
router.get('/api/patient/:patientId/case-report', async (req, res) => {
  try {
    // Basic RBAC: ensure caller has a valid admin session (provider/staff).
    // In server.js, caseReportRoutes should be mounted behind requireAdminAuth for UI calls.
    const { patientId } = req.params;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'patientId is required' });
    }

    const patientRow = db.getFHIRPatient ? db.getFHIRPatient(patientId) : null;
    if (!patientRow) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    const patientResource = patientRow.resource_data;
    const encounters = db.getFHIRPatientEncounters
      ? db.getFHIRPatientEncounters(patientId)
      : [];
    const appointments = db.getAppointmentsByPatientIds
      ? db.getAppointmentsByPatientIds([patientId])
      : [];
    const claims = db.getClaimsByPatient ? db.getClaimsByPatient(patientId) : [];
    const eligibility = db.getEligibilityChecksByPatient
      ? db.getEligibilityChecksByPatient(patientId)
      : [];
    const documents = db.getPatientDocuments ? db.getPatientDocuments(patientId) : [];

    // Coding decisions may be linked via call_id or patient_id in state_data; for now, return recent rows
    let codingDecisions = [];
    try {
      codingDecisions = db.db.prepare(`
        SELECT * FROM coding_decisions
        WHERE patient_id = ? OR patient_id IS NULL
        ORDER BY created_at DESC
        LIMIT 200
      `).all(patientId);
    } catch (_) {
      codingDecisions = [];
    }

    // Financials: invoices & payments
    let invoices = [];
    try {
      invoices = db.db.prepare(`
        SELECT * FROM invoices
        WHERE patient_id = ?
        ORDER BY created_at DESC
      `).all(patientId);
    } catch (_) {
      invoices = [];
    }

    // For each invoice, attach payments
    const invoicePaymentsById = {};
    if (invoices.length && db.getInvoicePayments) {
      invoices.forEach(inv => {
        invoicePaymentsById[inv.id] = db.getInvoicePayments(inv.id) || [];
      });
    }

    // Circle wallet transactions & card transactions, if available
    let walletTx = [];
    let cardTx = [];
    try {
      if (db.getWalletTransactionsByPatientId) {
        walletTx = db.getWalletTransactionsByPatientId(patientId) || [];
      }
    } catch (_) {}
    try {
      if (db.getCardTransactionsByPatientId) {
        cardTx = db.getCardTransactionsByPatientId(patientId) || [];
      }
    } catch (_) {}

    const result = {
      success: true,
      patient: {
        id: patientId,
        resource: patientResource
      },
      encounters,
      appointments,
      claims,
      eligibility,
      coding_decisions: codingDecisions,
      financials: {
        invoices: invoices.map(inv => ({
          ...inv,
          payments: invoicePaymentsById[inv.id] || []
        })),
        wallet_transactions: walletTx,
        card_transactions: cardTx
      },
      documents
    };

    return res.json(result);
  } catch (err) {
    console.error('[case-report] error building case-report:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to build case report' });
  }
});
let SMSService;
try {
  SMSService = require('../services/sms-service');
} catch (_) {
  SMSService = null;
}

const CASE_REPORT_SERVICE_TOKEN = process.env.CASE_REPORT_SERVICE_TOKEN || '';

function validateCaseReportToken(req) {
  const token = req.headers['x-callback-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return token && CASE_REPORT_SERVICE_TOKEN && token === CASE_REPORT_SERVICE_TOKEN;
}

/**
 * Task 53: GET /internal/communications/:encounterId/text
 * Auth: Bearer CASE_REPORT_SERVICE_TOKEN. Returns { text: "Doctor: ... \nPatient: ..." }. Audit logged.
 */
router.get('/internal/communications/:encounterId/text', (req, res) => {
  if (!validateCaseReportToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { encounterId } = req.params;
  try {
    const text = FHIRService.getTranscriptText(encounterId);
    if (db.auditLog) {
      db.auditLog('system', 'case-report-service', 'transcript_access', 'Communication', encounterId, req.ip, req.get('User-Agent') || '', 'success');
    }
    return res.json({ text: text || '' });
  } catch (err) {
    if (db.auditLog) {
      db.auditLog('system', 'case-report-service', 'transcript_access', 'Communication', encounterId, req.ip, req.get('User-Agent') || '', 'error');
    }
    return res.status(500).json({ error: 'Failed to get transcript' });
  }
});

/**
 * Task 55 & 56: POST /api/case-report/callback
 * Body: { job_id, status: 'completed'|'failed', report_markdown?, reasoning_chain?, error_message? }
 * Auth: X-Callback-Token or Authorization Bearer CASE_REPORT_SERVICE_TOKEN.
 */
router.post('/api/case-report/callback', express.json(), async (req, res) => {
  if (!validateCaseReportToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { job_id, status, report_markdown, reasoning_chain, error_message } = req.body || {};
  if (!job_id || !status) {
    return res.status(400).json({ error: 'job_id and status required' });
  }
  const row = db.getCaseReportByJobId && db.getCaseReportByJobId(job_id);
  if (!row) {
    return res.status(404).json({ error: 'Case report job not found' });
  }
  const ip = req.ip || '';
  const ua = req.get('User-Agent') || '';

  if (status === 'failed') {
    db.updateCaseReportByJobId(job_id, { status: 'failed', error_message: error_message || 'Unknown error' });
    if (db.auditLog) {
      db.auditLog('system', 'case-report-service', 'case_report_failed', 'DiagnosticReport', job_id, ip, ua, error_message || 'failed');
    }
    let clinicEmail = null;
    try {
      const patientId = row.patient_id;
      if (patientId && db.getAppointmentsByPatientIds) {
        const appts = db.getAppointmentsByPatientIds([patientId], { limit: 1 });
        const clinicId = appts[0]?.clinic_id;
        if (clinicId && db.getClinicById) {
          const clinic = await Promise.resolve(db.getClinicById(clinicId));
          clinicEmail = clinic?.email || clinic?.admin_email;
        }
      }
    } catch (_) {}
    if (clinicEmail) {
      EmailService.sendEmail({
        to: clinicEmail,
        subject: 'Case report failed',
        text: `A case report job failed (job_id: ${job_id}). No patient data included. Please check the dashboard.`,
        html: `<p>A case report job failed (job_id: ${job_id}). No patient data included. Please check the dashboard.</p>`
      }).catch(e => console.warn('[case-report] failure email failed:', e.message));
    }
    return res.json({ success: true, updated: true });
  }

  if (status === 'completed') {
    db.updateCaseReportByJobId(job_id, {
      status: 'completed',
      case_report_text: report_markdown || '',
      reasoning_chain: reasoning_chain
    });

    // Phase 4.3: Trigger Stripe capture for sync_video pre-auth at case report generation
    const appointmentId = row.appointment_id || null;
    if (appointmentId && stripe) {
      try {
        const appointment = await db.getAppointment(appointmentId);
        if (appointment && appointment.visit_mode === 'sync_video' && appointment.stripe_payment_intent_id) {
          await stripe.paymentIntents.capture(appointment.stripe_payment_intent_id);
          console.log(`[case-report] Captured pre-auth for appointment ${appointmentId} (PI: ${appointment.stripe_payment_intent_id})`);
        }
      } catch (capErr) {
        console.warn('[case-report] Stripe capture failed:', capErr.message);
      }
    }

    const patientId = row.patient_id;
    const encounterId = row.encounter_id;
    try {
      const reportResource = FHIRService.createDiagnosticReportFromCaseReport({
        patient_id: patientId,
        encounter_id: encounterId,
        case_report_text: report_markdown || '',
        job_id
      });
      if (reportResource && db.updateCaseReportByJobId) {
        db.updateCaseReportByJobId(job_id, {
          resource_id: reportResource.id,
          resource_data: JSON.stringify(reportResource)
        });
      }
    } catch (e) {
      console.warn('[case-report] createDiagnosticReport failed:', e.message);
    }
    if (db.auditLog) {
      db.auditLog('system', 'case-report-service', 'case_report_completed', 'DiagnosticReport', job_id, ip, ua, 'success');
    }
    const baseUrl = process.env.API_BASE_URL || process.env.BASE_URL || '';
    const portalLink = baseUrl ? `${baseUrl.replace(/\/$/, '')}/dashboard` : '';
    let clinicEmail = null;
    let clinicPhone = null;
    let appointmentDateStr = null;
    try {
      if (row.patient_id && db.getAppointmentsByPatientIds) {
        const appts = db.getAppointmentsByPatientIds([row.patient_id], { limit: 1 });
        const apt = appts[0];
        if (apt) {
          appointmentDateStr = (apt.start_time || apt.date)
            ? new Date(apt.start_time || apt.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
            : null;
          const clinicId = apt.clinic_id;
          if (clinicId && db.getClinicById) {
            const clinic = await Promise.resolve(db.getClinicById(clinicId));
            clinicEmail = clinic?.email || clinic?.admin_email;
            clinicPhone = clinic?.phone_number || clinic?.phone;
          }
        }
      }
    } catch (_) {}
    if (clinicEmail) {
      const dateOnly = appointmentDateStr || 'your recent consult';
      EmailService.sendEmail({
        to: clinicEmail,
        subject: 'Case report ready',
        text: `Case report ready for ${dateOnly}. View: ${portalLink}`,
        html: `<p>Case report ready for ${dateOnly}. <a href="${portalLink}">View in dashboard</a>.</p>`
      }).catch(e => console.warn('[case-report] notification email failed:', e.message));
    }
    if (SMSService && clinicPhone && portalLink) {
      const dateOnly = appointmentDateStr || 'your recent consult';
      const smsText = `Case report ready for ${dateOnly} consult. View: ${portalLink}`;
      SMSService.sendSMS(clinicPhone, smsText).catch(e => console.warn('[case-report] notification SMS failed:', e.message));
    }
    return res.json({ success: true, updated: true });
  }

  return res.status(400).json({ error: 'Invalid status' });
});

module.exports = router;
