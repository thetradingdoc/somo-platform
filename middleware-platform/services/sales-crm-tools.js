'use strict';

/**
 * Sales CRM tools — shared by Retell function_call handlers and KellyToolExecutor (script-only rails).
 */

function appendNotes(existing, fragment) {
  const base = String(existing || '').trim();
  const add = String(fragment || '').trim();
  if (!add) return base || null;
  if (!base) return add;
  if (base.includes(add)) return base;
  return `${base}\n${add}`;
}

function collectContactInfo(db, { leadId, args = {} }) {
  if (!leadId || !db?.updateLead) {
    return { success: false, error: 'LEAD_ID_REQUIRED', message: 'Lead id required to collect contact info' };
  }
  const email = String(args.contact_email || '').trim();
  const phone = String(args.contact_phone || '').trim();
  if (!email && !phone && !args.notes) {
    return { success: false, error: 'EMPTY_CONTACT', message: 'No contact fields provided' };
  }

  const updates = {};
  if (email) updates.clinic_email = email;
  if (phone) updates.clinic_phone = phone;
  if (args.interest_level) {
    updates.lead_score =
      args.interest_level === 'high' ? 90 : args.interest_level === 'medium' ? 60 : args.interest_level === 'low' ? 30 : 10;
    updates.priority =
      args.interest_level === 'high' ? 1 : args.interest_level === 'medium' ? 5 : 10;
  }
  if (args.notes) {
    const currentLead = db.db?.prepare?.('SELECT notes FROM leads WHERE id = ?')?.get?.(leadId);
    updates.notes = appendNotes(currentLead?.notes, args.notes);
  }
  if (args.clinic_name) {
    updates.clinic_name = String(args.clinic_name).trim();
  }
  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'NO_UPDATES', message: 'Nothing to update' };
  }
  db.updateLead(leadId, updates);
  return {
    success: true,
    message: 'Contact information collected successfully',
    lead_id: leadId,
    contact_name: args.contact_name || null,
    contact_email: email || null,
    contact_phone: phone || null,
    interest_level: args.interest_level || null
  };
}

function scheduleDemo(db, { leadId, args = {} }) {
  if (!leadId || !db?.db) {
    return { success: false, error: 'LEAD_ID_REQUIRED', message: 'Lead id required to schedule demo' };
  }
  const preferredDate = String(args.preferred_date || args.demo_date || '').trim();
  const preferredTime = String(args.preferred_time || args.demo_time || 'TBD').trim();
  if (!preferredDate) {
    return { success: false, error: 'DATE_REQUIRED', message: 'preferred_date required' };
  }

  const currentLead = db.db.prepare('SELECT notes FROM leads WHERE id = ?').get(leadId);
  const noteLine = `Demo scheduled: ${preferredDate} at ${preferredTime}${args.contact_name ? ` (${args.contact_name})` : ''}`;
  const newNotes = appendNotes(currentLead?.notes, noteLine);

  db.db
    .prepare(
      `UPDATE leads
       SET pipeline_stage = 'demo_scheduled',
           status = 'demo_scheduled',
           notes = ?,
           follow_up_date = ?,
           next_action = 'Demo scheduled',
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(newNotes, preferredDate, leadId);

  return {
    success: true,
    message: `Demo scheduled successfully for ${preferredDate} at ${preferredTime}`,
    lead_id: leadId,
    demo_date: preferredDate,
    demo_time: preferredTime,
    contact_email: args.contact_email || null
  };
}

function upsertPlatformQualLead(db, { phone, callerPhone, fields = {} }) {
  const { ensureInboundPlatformLead, findLeadByPhone } = require('./platform-caller-lookup');
  const normalizedPhone = phone || callerPhone;
  if (!normalizedPhone) return null;

  let lead = findLeadByPhone(db, normalizedPhone);
  if (!lead) {
    lead = ensureInboundPlatformLead(db, {
      phone: normalizedPhone,
      clinic_name: fields.clinic_name || 'Inbound platform caller',
      notes: fields.notes || 'Created during inbound platform sales call'
    });
  } else if (fields && Object.keys(fields).length && db.updateLead) {
    const updates = {};
    if (fields.specialty) updates.specialty = fields.specialty;
    if (fields.notes) {
      updates.notes = appendNotes(lead.notes, fields.notes);
    }
    if (Object.keys(updates).length) {
      db.updateLead(lead.id, updates);
      lead = db.getLead?.(lead.id) || lead;
    }
  }
  return lead;
}

function ensureLeadCallRow(db, { leadId, callId, direction = 'inbound' }) {
  if (!leadId || !callId || !db?.createLeadCall) return null;
  try {
    const existing = db.db?.prepare?.('SELECT id FROM lead_calls WHERE call_id = ? LIMIT 1')?.get?.(callId);
    if (existing?.id) return existing;
  } catch (_) {}
  const id = `lc_${require('crypto').randomBytes(10).toString('hex')}`;
  return db.createLeadCall({
    id,
    lead_id: leadId,
    call_id: callId,
    direction,
    call_status: 'in_progress',
    started_at: new Date().toISOString()
  });
}

module.exports = {
  appendNotes,
  collectContactInfo,
  scheduleDemo,
  upsertPlatformQualLead,
  ensureLeadCallRow
};
