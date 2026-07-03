'use strict';

const { getSyncStatus } = require('./e10-interim-service');
const { getBillingStatus } = require('./voice-billing-stripe');
const { isGoogleCalendarConnected } = require('./onboarding-blockers-service');

function stripeNameplate(billing) {
  if (!billing) return 'ACTION NEEDED';
  const status = String(billing.subscription_status || '').toLowerCase();
  if (status === 'active' || status === 'trialing') return 'CONNECTED';
  if (status === 'past_due' || status === 'incomplete' || status === 'unpaid') return 'ACTION NEEDED';
  return billing.twilio_phone_number ? 'CONNECTED' : 'ACTION NEEDED';
}

function dentrixNameplate(sync) {
  if (!sync) return 'MANUAL SYNC';
  if (sync.pms_enabled && !sync.pms_last_error) return 'CONNECTED';
  if (sync.pms_last_error) return 'ERROR';
  return 'MANUAL SYNC';
}

/**
 * @param {object} db
 * @param {{ customerId?: string, clinicId?: string, email?: string }} ctx
 */
function resolveIntegrationsStatus(db, { customerId, clinicId, email } = {}) {
  const customer = customerId ? db.getCustomer?.(customerId) : null;
  const resolvedEmail = email || customer?.email || null;
  const resolvedClinicId = clinicId || (customer ? require('./tenant-voice-config').resolveClinicForCustomer(db, customer.id)?.clinic_id : null);

  const googleConnected = isGoogleCalendarConnected(db, resolvedEmail);
  const user = resolvedEmail && db.getUserCalendarSettingsByEmail
    ? db.getUserCalendarSettingsByEmail(resolvedEmail)
    : null;
  const needsReconnect = !!(user && user.google_calendar_connected && !user.google_refresh_token);

  const sync = resolvedClinicId ? getSyncStatus(resolvedClinicId) : null;
  const billing = customerId ? getBillingStatus(customerId) : null;

  return {
    google_calendar: {
      connected: googleConnected,
      needs_reconnect: needsReconnect,
      calendar_email: user?.google_calendar_email || resolvedEmail,
      calendar_id: user?.google_calendar_id || 'primary',
      nameplate: googleConnected && !needsReconnect ? 'CONNECTED' : needsReconnect ? 'NEEDS REAUTH' : 'DISCONNECTED'
    },
    dentrix: {
      pms_type: sync?.pms_type || 'somo',
      pms_enabled: !!sync?.pms_enabled,
      pending_writes: Number(sync?.pending_pms_writes || 0) + Number(sync?.pending_sync_queue || 0),
      pms_last_error: sync?.pms_last_error || null,
      nameplate: dentrixNameplate(sync)
    },
    stripe: {
      connected: ['active', 'trialing'].includes(String(billing?.subscription_status || '').toLowerCase()),
      subscription_status: billing?.subscription_status || null,
      action_needed: stripeNameplate(billing) === 'ACTION NEEDED',
      nameplate: stripeNameplate(billing)
    }
  };
}

function listPmsSyncErrors(db, clinicId, { limit = 50 } = {}) {
  if (!db?.db || !clinicId) return [];
  try {
    return db.db
      .prepare(
        `SELECT id, clinic_id, appointment_id, operation, status, error_message, created_at, updated_at
         FROM pms_write_log
         WHERE clinic_id = ? AND status != 'success'
         ORDER BY datetime(created_at) DESC
         LIMIT ?`
      )
      .all(clinicId, Math.min(limit, 100));
  } catch (_) {
    return [];
  }
}

module.exports = {
  resolveIntegrationsStatus,
  listPmsSyncErrors,
  stripeNameplate,
  dentrixNameplate
};
