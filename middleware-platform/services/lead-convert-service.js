'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../database');
const { createInvite, sendInviteEmail, generateInviteCode, assertInviteEmailAvailable } = require('./provider-invite-service');
const { provisionSaasTenant } = require('./saas-tenant-provision');
const { transitionState } = require('./voice-onboarding-state');
const facade = require('./admin-lead-facade');

function getLead(leadId) {
  return db.getLead?.(leadId) || db.db?.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
}

/**
 * One-step admin convert: provision tenant immediately + audit invite row.
 */
async function convertLeadToCustomer(leadId, options = {}) {
  const lead = getLead(leadId);
  if (!lead) {
    const err = new Error('lead_not_found');
    err.code = 'lead_not_found';
    throw err;
  }

  if (lead.pipeline_stage === 'won' || lead.status === 'converted') {
    const err = new Error('lead_already_converted');
    err.code = 'lead_already_converted';
    throw err;
  }

  const email = (options.email || lead.clinic_email || lead.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('lead_missing_email');
    err.code = 'lead_missing_email';
    throw err;
  }

  assertInviteEmailAvailable(email);

  const practiceName = options.practice_name || lead.clinic_name || lead.title || 'Dental Practice';
  const officeType = options.office_type || 'dental';
  const tempPassword = crypto.randomBytes(12).toString('base64url').slice(0, 16);
  const bcrypt = require('bcryptjs');
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const customerId = `cust_${uuidv4()}`;

  db.createCustomer({
    id: customerId,
    name: options.contact_name || practiceName,
    email,
    company_name: practiceName,
    customer_type: 'saas',
    plan_tier: 'practice',
    status: 'active',
    email_verified: 1,
    email_verified_at: new Date().toISOString()
  });

  const provisioned = provisionSaasTenant(db, {
    customerId,
    clinicName: practiceName,
    email,
    createUser: true,
    passwordHash,
    userName: options.contact_name || practiceName,
    useCase: officeType === 'dental' ? 'dental' : 'healthcare_clinic',
    medicalSpecialty: officeType === 'dental' ? 'dental' : null
  });

  db.db?.prepare(`UPDATE customers SET password_hash = ? WHERE id = ?`).run(passwordHash, customerId);

  if (provisioned.clinicId && officeType) {
    db.db
      ?.prepare(`UPDATE clinics SET office_type = ?, updated_at = datetime('now') WHERE clinic_id = ?`)
      .run(officeType, provisioned.clinicId);
  }

  transitionState(db, customerId, 'voice_setup_incomplete', {
    wizard_step: 1,
    source: 'admin_convert_lead',
    lead_id: lead.id
  }, { serverSide: true });

  const inviteId = `inv_${uuidv4()}`;
  const code = generateInviteCode();
  const expires = new Date(Date.now() + 14 * 86400000).toISOString();
  db.db
    ?.prepare(
      `INSERT INTO provider_invites (
        id, code, email, practice_name, office_type, use_case, lead_id,
        customer_id, clinic_id, status, expires_at, accepted_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, datetime('now'), ?)`
    )
    .run(
      inviteId,
      code,
      email,
      practiceName,
      officeType,
      'dental',
      lead.id,
      customerId,
      provisioned.clinicId,
      expires,
      options.created_by || 'admin_convert'
    );

  db.updateLead?.(lead.id, {
    pipeline_stage: facade.denormalizeStage?.('won') || 'won',
    status: 'converted'
  });

  db.createLeadActivity?.({
    lead_id: lead.id,
    activity_type: 'update',
    activity_subject: 'Converted to customer (one-step)',
    activity_description: `Tenant provisioned for ${email}. Customer ${customerId}.`,
    metadata: { customer_id: customerId, clinic_id: provisioned.clinicId, invite_id: inviteId }
  });

  const base = String(process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:4000').replace(
    /\/$/,
    ''
  );
  const portalUrl = `${base}/login?redirect=${encodeURIComponent('/business/voice-setup.html?step=1')}`;

  if (options.send_email !== false) {
    try {
      const EmailService = require('./email-service');
      if (typeof EmailService.sendEmail === 'function') {
        await EmailService.sendEmail({
          to: email,
          subject: `Your Somo front desk is ready — ${practiceName}`,
          text: `Your practice account has been created.\n\nSign in: ${portalUrl}\n\nTemporary password: ${tempPassword}\n\nChange your password after first login.`
        });
      }
    } catch (_) {}
  }

  return {
    customerId,
    clinicId: provisioned.clinicId,
    merchantId: provisioned.merchantId,
    portal_url: portalUrl,
    email_sent: options.send_email !== false
  };
}

module.exports = { convertLeadToCustomer, getLead };
