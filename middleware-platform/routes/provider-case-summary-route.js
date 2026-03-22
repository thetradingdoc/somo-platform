/**
 * Provider-facing API for case summaries and appointment details.
 *
 * Endpoints:
 *   GET /api/provider/appointments        — list appointments for this provider
 *   GET /api/provider/appointments/:id    — full appointment + case summary + triage
 *   PATCH /api/provider/appointments/:id/notes — add post-visit notes
 *
 * Mount in server.js:
 *   app.use('/api/provider', requireProviderAuth, providerCaseSummaryRouter);
 *
 * requireProviderAuth must set req.providerId (from JWT or session).
 */

'use strict';

const express = require('express');
const db = require('../database');

const router = express.Router();

router.get('/appointments', (req, res) => {
  const providerId = req.providerId;
  if (!providerId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hasPractitioner = db.db.prepare("PRAGMA table_info(appointments)").all()
      .some(c => c.name === 'practitioner_id');
    if (!hasPractitioner) {
      return res.status(200).json({ appointments: [] });
    }

    const rows = db.db.prepare(`
      SELECT
        a.id,
        a.patient_name,
        a.patient_email,
        a.appointment_type,
        a.date AS appointment_date,
        a.time AS appointment_time,
        a.visit_mode,
        a.payment_status,
        a.status,
        (SELECT 1 FROM case_summaries cs WHERE cs.appointment_id = a.id LIMIT 1) AS has_case_summary,
        (SELECT cs.created_at FROM case_summaries cs WHERE cs.appointment_id = a.id LIMIT 1) AS summary_ready_at
      FROM appointments a
      WHERE a.practitioner_id = ?
      ORDER BY a.date DESC, a.time DESC
      LIMIT 50
    `).all(providerId);

    const appointments = rows.map(r => ({
      ...r,
      has_case_summary: !!r.has_case_summary
    }));

    return res.status(200).json({ appointments });
  } catch (err) {
    console.error('[ProviderCaseAPI] List appointments error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/appointments/:id', async (req, res) => {
  const providerId = req.providerId;
  const { id: appointmentId } = req.params;

  try {
    const hasPractitioner = db.db.prepare("PRAGMA table_info(appointments)").all()
      .some(c => c.name === 'practitioner_id');
    let appt;
    if (hasPractitioner) {
      appt = db.db.prepare(`
        SELECT * FROM appointments WHERE id = ? AND practitioner_id = ? LIMIT 1
      `).get(appointmentId, providerId);
    } else {
      appt = db.db.prepare(`SELECT * FROM appointments WHERE id = ? LIMIT 1`).get(appointmentId);
      if (appt && providerId) {
        const slot = db.getSlotAssignment ? db.getSlotAssignment(appointmentId) : null;
        if (slot && slot.practitioner_id !== providerId) appt = null;
      }
    }

    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const caseSummaryRow = db.db.prepare(`
      SELECT * FROM case_summaries WHERE appointment_id = ? LIMIT 1
    `).get(appointmentId);

    let caseSummary = null;
    if (caseSummaryRow?.summary_json) {
      try { caseSummary = JSON.parse(caseSummaryRow.summary_json); } catch (_) {}
    }

    const sessionId = caseSummaryRow?.session_id;
    const triageRow = sessionId && db.getTriageSession
      ? db.getTriageSession(sessionId)
      : null;

    let media = [];
    if (sessionId && db.getTriageMediaForSession) {
      media = db.getTriageMediaForSession(sessionId) || [];
    }

    return res.status(200).json({
      appointment: {
        ...appt,
        appointment_date: appt.date,
        appointment_time: appt.time
      },
      case_summary: caseSummary,
      triage_session: triageRow
        ? {
            onset: triageRow.onset,
            provocation: triageRow.provocation,
            quality: triageRow.quality,
            radiation: triageRow.radiation,
            severity: triageRow.severity,
            timing: triageRow.timing,
            associated_sx: triageRow.associated_sx,
            medications: triageRow.medications,
            allergies: triageRow.allergies,
            prior_diagnoses: triageRow.prior_diagnoses,
            prior_workups: triageRow.prior_workups,
            family_history: triageRow.family_history,
            alcohol_use: triageRow.alcohol_use,
            smoking_status: triageRow.smoking_status,
            phq2_score: triageRow.phq2_score,
            gad2_score: triageRow.gad2_score,
            safety_screen: triageRow.safety_screen,
            soap_note: triageRow.soap_note,
            target_specialty: triageRow.target_specialty,
            urgency: triageRow.urgency,
            safety_level: triageRow.safety_level
          }
        : null,
      uploaded_media: media.map(m => ({
        id: m.id,
        file_name: m.file_name,
        file_type: m.mime_type || m.media_type,
        url: m.storage_url || `/api/media/${m.id}`,
        ai_summary: (() => {
          try { return (typeof m.ai_analysis === 'string' ? JSON.parse(m.ai_analysis) : m.ai_analysis)?.summary; } catch (_) { return null; }
        })()
      }))
    });
  } catch (err) {
    console.error('[ProviderCaseAPI] Case detail error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/appointments/:id/notes', express.json(), (req, res) => {
  const providerId = req.providerId;
  const { id: appointmentId } = req.params;
  const { provider_notes, diagnosis_codes, follow_up_plan } = req.body;

  try {
    const hasPractitioner = db.db.prepare("PRAGMA table_info(appointments)").all()
      .some(c => c.name === 'practitioner_id');
    let appt;
    if (hasPractitioner) {
      appt = db.db.prepare(`
        SELECT id FROM appointments WHERE id = ? AND practitioner_id = ? LIMIT 1
      `).get(appointmentId, providerId);
    } else {
      appt = db.db.prepare(`SELECT id FROM appointments WHERE id = ? LIMIT 1`).get(appointmentId);
    }
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const hasCols = db.db.prepare("PRAGMA table_info(appointments)").all();
    const hasProviderNotes = hasCols.some(c => c.name === 'provider_notes');
    const hasDiagnosisCodes = hasCols.some(c => c.name === 'diagnosis_codes');
    const hasFollowUpPlan = hasCols.some(c => c.name === 'follow_up_plan');

    if (!hasProviderNotes && !hasDiagnosisCodes && !hasFollowUpPlan) {
      return res.status(200).json({ success: true, message: 'Columns not yet migrated' });
    }

    const updates = [];
    const values = [];
    if (hasProviderNotes) { updates.push('provider_notes = ?'); values.push(provider_notes || null); }
    if (hasDiagnosisCodes) { updates.push('diagnosis_codes = ?'); values.push(diagnosis_codes ? (typeof diagnosis_codes === 'string' ? diagnosis_codes : JSON.stringify(diagnosis_codes)) : null); }
    if (hasFollowUpPlan) { updates.push('follow_up_plan = ?'); values.push(follow_up_plan || null); }
    if (hasCols.some(c => c.name === 'updated_at')) { updates.push('updated_at = datetime(\'now\')'); }
    values.push(appointmentId);

    db.db.prepare(`
      UPDATE appointments SET ${updates.join(', ')} WHERE id = ?
    `).run(...values);

    try {
      const apptRow = db.getAppointment ? db.getAppointment(appointmentId) : null;
      if (apptRow?.patient_id) {
        db.enqueueEhrSyncJob({
          event_type: 'note_signed',
          patient_id: apptRow.patient_id,
          appointment_id: appointmentId,
          source_system: 'athena',
          tenant_id: apptRow.clinic_id || 'clinic-default',
          idempotency_key: `note_signed:${appointmentId}`,
          payload_json: {
            signed_at: new Date().toISOString(),
            has_provider_notes: !!provider_notes
          }
        });
      }
    } catch (e) {
      console.warn('[ProviderCaseAPI] Could not enqueue note_signed EHR sync job:', e.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[ProviderCaseAPI] Update notes error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { providerCaseSummaryRouter: router };
