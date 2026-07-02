'use strict';

const express = require('express');
const db = require('../database');
const {
  createInvite,
  validateInvite,
  sendInviteEmail,
  acceptInvite
} = require('../services/provider-invite-service');
const { pilotRateLimit } = require('../middleware/pilot-rate-limit');
const { requireAdminOrCapability } = require('../middleware/admin-auth');
const { getSessionCookieOptions } = require('./lib/signup-shared');
const facade = require('../services/admin-lead-facade');

const publicRouter = express.Router();

publicRouter.get('/:code', pilotRateLimit('invite_lookup'), (req, res) => {
  try {
    const validation = validateInvite(req.params.code);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    const inv = validation.invite;
    return res.json({
      success: true,
      invite: {
        code: inv.code,
        email: inv.email,
        practice_name: inv.practice_name,
        office_type: inv.office_type,
        expires_at: inv.expires_at
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

publicRouter.post('/:code/accept', pilotRateLimit('invite_accept'), async (req, res) => {
  try {
    const result = await acceptInvite(req.params.code, {
      password: req.body?.password,
      name: req.body?.name,
      baaAcknowledged: req.body?.baa_acknowledged === true || req.body?.baaAcknowledged === true,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    if (result.sessionId) {
      res.cookie('customer_session', result.sessionId, getSessionCookieOptions(req));
    }
    return res.json({
      success: true,
      customerId: result.customerId,
      clinicId: result.clinicId,
      merchantId: result.merchantId,
      redirect: '/business/voice-setup.html?step=1'
    });
  } catch (e) {
    const status = e.code === 'invite_expired' || e.code === 'invite_not_found' ? 400 : 422;
    return res.status(status).json({ success: false, error: e.message, code: e.code });
  }
});

const adminRouter = express.Router();
adminRouter.use(requireAdminOrCapability('platform.leads'));

adminRouter.get('/', (req, res) => {
  try {
    if (!db.db) return res.status(503).json({ success: false, error: 'db unavailable' });
    const rows = db.db
      .prepare(
        `SELECT id, code, email, practice_name, status, expires_at, accepted_at, clinic_id, lead_id, created_at FROM provider_invites ORDER BY created_at DESC LIMIT 100`
      )
      .all();
    return res.json({ success: true, invites: rows });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

adminRouter.post('/', pilotRateLimit('invite_create'), async (req, res) => {
  try {
    const invite = createInvite({
      email: req.body?.email,
      practiceName: req.body?.practice_name || req.body?.practiceName,
      officeType: req.body?.office_type || 'dental',
      useCase: req.body?.use_case || 'dental',
      leadId: req.body?.lead_id || null,
      createdBy: req.body?.created_by || 'admin'
    });
    if (req.body?.send_email !== false) {
      await sendInviteEmail(invite, process.env.BASE_URL);
    }
    return res.json({ success: true, invite });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

adminRouter.post('/from-lead/:leadId', pilotRateLimit('invite_create'), async (req, res) => {
  try {
    const lead =
      db.getLead?.(req.params.leadId) ||
      db.db?.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
    if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });
    const email = req.body?.email || lead.clinic_email;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'lead_missing_email',
        message: 'Lead has no email — add one before sending invite.'
      });
    }
    const invite = createInvite({
      email,
      practiceName: req.body?.practice_name || lead.clinic_name || lead.title,
      officeType: req.body?.office_type || 'dental',
      useCase: 'dental',
      leadId: lead.id,
      createdBy: 'pipeline'
    });
    if (req.body?.send_email !== false) {
      await sendInviteEmail(invite, process.env.BASE_URL);
    }
    const convert = req.body?.convert !== false;
    if (convert) {
      db.updateLead(lead.id, { pipeline_stage: facade.denormalizeStage('won') });
      db.createLeadActivity({
        lead_id: lead.id,
        activity_type: 'update',
        activity_subject: 'Pilot invite sent',
        activity_description: `Invite sent to ${email}. Customer account created when invite is accepted.`,
        metadata: { invite_id: invite.id, invite_code: invite.code }
      });
    }
    const base = String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return res.json({
      success: true,
      invite,
      lead_id: lead.id,
      invite_url: `${base}/invite.html?code=${encodeURIComponent(invite.code)}`,
      converted: convert
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = { publicRouter, adminRouter };
