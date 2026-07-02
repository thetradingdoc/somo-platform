'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

function generateInviteCode() {
  return crypto.randomBytes(16).toString('hex');
}

function createInvite({ email, practiceName, officeType, useCase, leadId, createdBy, ttlDays = 14 } = {}) {
  if (!email) throw new Error('email required');
  if (!db.db) throw new Error('Database unavailable');
  const id = `inv_${uuidv4()}`;
  const code = generateInviteCode();
  const expires = new Date(Date.now() + ttlDays * 86400000).toISOString();
  db.db
    .prepare(
      `
      INSERT INTO provider_invites (
        id, code, email, practice_name, office_type, use_case, lead_id, status, expires_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `
    )
    .run(
      id,
      code,
      String(email).trim().toLowerCase(),
      practiceName || null,
      officeType || 'dental',
      useCase || 'dental',
      leadId || null,
      expires,
      createdBy || null
    );
  return getInviteByCode(code);
}

function getInviteByCode(code) {
  if (!code || !db.db) return null;
  return db.db.prepare(`SELECT * FROM provider_invites WHERE code = ? LIMIT 1`).get(String(code).trim());
}

function validateInvite(code) {
  const row = getInviteByCode(code);
  if (!row) return { valid: false, error: 'invite_not_found' };
  if (row.status !== 'pending') return { valid: false, error: 'invite_already_used', invite: row };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { valid: false, error: 'invite_expired', invite: row };
  }
  return { valid: true, invite: row };
}

async function sendInviteEmail(invite, baseUrl) {
  const EmailService = require('./email-service');
  const url = `${String(baseUrl || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '')}/invite.html?code=${encodeURIComponent(invite.code)}`;
  if (typeof EmailService.sendProviderInvite === 'function') {
    return EmailService.sendProviderInvite({ to: invite.email, practiceName: invite.practice_name, inviteUrl: url });
  }
  if (typeof EmailService.sendEmail === 'function') {
    return EmailService.sendEmail({
      to: invite.email,
      subject: `Set up Kelly for ${invite.practice_name || 'your practice'}`,
      text: `You've been invited to Somo. Set up your AI front desk: ${url}\n\nThis link expires ${invite.expires_at}.`
    });
  }
  console.log(JSON.stringify({ component: 'provider_invite', to: invite.email, url }));
  return { logged: true };
}

function convertLeadFromInvite(invite, customerId) {
  if (!invite?.lead_id || !db.db) return;
  try {
    const lead = db.getLead?.(invite.lead_id);
    if (!lead) return;
    db.updateLead(invite.lead_id, { pipeline_stage: 'won' });
    db.createLeadActivity({
      lead_id: invite.lead_id,
      activity_type: 'update',
      activity_subject: 'Converted to customer',
      activity_description: `Pilot invite accepted — customer ${customerId}`,
      metadata: { customer_id: customerId, invite_id: invite.id }
    });
  } catch (err) {
    console.warn('[provider_invite] lead convert skipped:', err.message);
  }
}

function finalizeInviteCustomer(customerId, { ip, userAgent } = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found after provision');

  db.updateCustomer(customerId, {
    email_verified: 1,
    email_verified_at: new Date().toISOString(),
    status: 'active'
  });
  if (!db.hasAcceptedTerms(customerId, '1.0')) {
    db.acceptTerms(customerId, '1.0', ip || 'invite', userAgent || 'provider-invite');
  }

  const { transitionState } = require('./voice-onboarding-state');
  transitionState(db, customerId, 'voice_setup_incomplete', { wizard_step: 1, source: 'pilot_invite' });

  const sessionId = db.createCustomerSession(customerId, ip || null, userAgent || null);
  return { customer: db.getCustomer(customerId), sessionId };
}

async function acceptInvite(code, { password, name, baaAcknowledged, ip, userAgent } = {}) {
  const validation = validateInvite(code);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.code = validation.error;
    throw err;
  }
  if (!password || String(password).length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  if (!baaAcknowledged) {
    throw new Error('BAA acknowledgment required');
  }
  const invite = validation.invite;
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(String(password), 10);
  const customerId = `cust_${uuidv4()}`;
  db.createCustomer({
    id: customerId,
    name: name || invite.practice_name || 'Practice Admin',
    email: invite.email,
    company_name: invite.practice_name || 'Dental Practice',
    customer_type: 'saas',
    plan_tier: 'practice',
    email_verified: 1,
    email_verified_at: new Date().toISOString()
  });
  const { provisionSaasTenant } = require('./saas-tenant-provision');
  const provisioned = provisionSaasTenant(db, {
    customerId,
    clinicName: invite.practice_name || 'Dental Practice',
    email: invite.email,
    createUser: true,
    passwordHash,
    userName: name || invite.practice_name,
    useCase: invite.use_case || 'dental',
    medicalSpecialty: invite.use_case === 'dental' ? 'dental' : null
  });
  if (provisioned.clinicId && invite.office_type) {
    db.db
      .prepare(`UPDATE clinics SET office_type = ?, updated_at = datetime('now') WHERE clinic_id = ?`)
      .run(invite.office_type, provisioned.clinicId);
  }
  db.db
    .prepare(
      `
      UPDATE provider_invites
      SET status = 'accepted', accepted_at = datetime('now'), customer_id = ?, clinic_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `
    )
    .run(customerId, provisioned.clinicId, invite.id);

  convertLeadFromInvite(invite, customerId);
  const { sessionId } = finalizeInviteCustomer(customerId, { ip, userAgent });

  return {
    customerId,
    clinicId: provisioned.clinicId,
    merchantId: provisioned.merchantId,
    sessionId
  };
}

module.exports = {
  createInvite,
  getInviteByCode,
  validateInvite,
  sendInviteEmail,
  acceptInvite,
  convertLeadFromInvite,
  finalizeInviteCustomer,
  generateInviteCode
};
