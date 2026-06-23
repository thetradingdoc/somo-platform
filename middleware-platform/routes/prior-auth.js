'use strict';

/**
 * Prior auth routes (RCM-PA v1)
 *
 * Mounted under: /api/prior-auth
 */

function registerPriorAuthRoutes(app, deps) {
  const { apiLimiter, express, db } = deps;
  const PriorAuthService = require('../services/platform/prior-auth-service');

  app.post('/api/prior-auth/evaluate', apiLimiter, express.json(), (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const cptCode = String(body.cpt_code || body.cptCode || '').trim();
      if (!cptCode) return res.status(400).json({ success: false, error: 'cpt_code is required' });
      const result = PriorAuthService.evaluateRequirement(db, {
        patientId: body.patient_id || body.patientId || null,
        memberId: body.member_id || body.memberId || null,
        payerId: body.payer_id || body.payerId || null,
        cptCode,
        dateOfService: body.date_of_service || body.dateOfService || null
      });
      return res.json({ success: true, ...result });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/prior-auth/requests', apiLimiter, express.json(), (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const row = PriorAuthService.openCase(db, {
        appointmentId: body.appointment_id || body.appointmentId || null,
        claimId: body.claim_id || body.claimId || null,
        patientId: body.patient_id || body.patientId || null,
        memberId: body.member_id || body.memberId || null,
        payerId: body.payer_id || body.payerId || null,
        cptCode: body.cpt_code || body.cptCode || null,
        icd10Code: body.icd10_code || body.icd10Code || null,
        placeOfService: body.place_of_service || body.placeOfService || null,
        dateOfService: body.date_of_service || body.dateOfService || null,
        status: body.status || 'pending',
        submissionRail: body.submission_rail || 'manual'
      });
      return res.json({ success: true, request: row });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/prior-auth/requests/:id/submit', apiLimiter, express.json(), (req, res) => {
    try {
      const out = PriorAuthService.submitPriorAuth(db, req.params.id);
      const status = out.success ? 200 : (out.code === 'STEDI_278_UNSUPPORTED' ? 409 : 500);
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // Phase-1 manual approval/update endpoints (human in the loop)
  app.post('/api/prior-auth/requests/:id/approve', apiLimiter, express.json(), (req, res) => {
    try {
      const out = PriorAuthService.manualApproveRequest(db, req.params.id, {
        authNumber: req.body?.auth_number || req.body?.authNumber || null,
        expiryDate: req.body?.expiry_date || req.body?.expiryDate || null
      });
      const status = out.success ? 200 : (out.error && out.error.includes('not found') ? 404 : 400);
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/prior-auth/requests/:id/deny', apiLimiter, express.json(), (req, res) => {
    try {
      const out = PriorAuthService.manualDenyRequest(db, req.params.id, {
        denialReason: req.body?.denial_reason || req.body?.denialReason || null
      });
      const status = out.success ? 200 : (out.error && out.error.includes('not found') ? 404 : 400);
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/prior-auth/requests/:id/update', apiLimiter, express.json(), (req, res) => {
    try {
      const out = PriorAuthService.manualUpdateApprovedRequest(db, req.params.id, {
        authNumber: req.body?.auth_number || req.body?.authNumber || null,
        expiryDate: req.body?.expiry_date || req.body?.expiryDate || null
      });
      const status =
        out.success ? 200 : (out.code === 'NOT_APPROVED' ? 409 : (out.error && out.error.includes('not found') ? 404 : 400));
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/prior-auth/requests/:id', apiLimiter, (req, res) => {
    try {
      const out = PriorAuthService.getRequest(db, req.params.id);
      const status = out.success ? 200 : 404;
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/prior-auth/requests', apiLimiter, (req, res) => {
    try {
      const clinicId = String(req.query.clinic_id || req.headers['x-clinic-id'] || '').trim();
      if (!clinicId) {
        return res.status(400).json({ success: false, error: 'clinic_id is required' });
      }
      const status = req.query.status ? String(req.query.status).trim() : null;
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const out = PriorAuthService.listByClinic(db, clinicId, { status, limit });
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // Provider portal history helpers
  app.get('/api/prior-auth/appointments/:appointmentId/requests', apiLimiter, (req, res) => {
    try {
      const appointmentId = req.params.appointmentId;
      const list = (db.getPriorAuthRequestsByAppointment && db.getPriorAuthRequestsByAppointment(appointmentId)) || [];
      const simplified = list.map((r) => ({
        id: r.id,
        appointment_id: r.appointment_id,
        claim_id: r.claim_id || null,
        status: r.status || null,
        auth_number: r.auth_number || null,
        expiry_date: r.expiry_date || null,
        denial_reason: r.denial_reason || null,
        tracking_number: r.tracking_number || null,
        created_at: r.created_at || null,
        updated_at: r.updated_at || null
      }));
      return res.json({ success: true, requests: simplified, count: simplified.length, latest_request_id: simplified[0]?.id || null });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/prior-auth/claims/:claimId/requests', apiLimiter, (req, res) => {
    try {
      const claimId = req.params.claimId;
      const sqlite = db.db;
      const list = sqlite
        ? sqlite
            .prepare(`SELECT * FROM prior_auth_requests WHERE claim_id = ? ORDER BY datetime(created_at) DESC`)
            .all(String(claimId))
        : [];

      const simplified = (list || []).map((r) => ({
        id: r.id,
        appointment_id: r.appointment_id,
        claim_id: r.claim_id || null,
        status: r.status || null,
        auth_number: r.auth_number || null,
        expiry_date: r.expiry_date || null,
        denial_reason: r.denial_reason || null,
        tracking_number: r.tracking_number || null,
        created_at: r.created_at || null,
        updated_at: r.updated_at || null
      }));

      return res.json({ success: true, requests: simplified, count: simplified.length, latest_request_id: simplified[0]?.id || null });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerPriorAuthRoutes };

