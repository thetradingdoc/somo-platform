'use strict';

const { parseMeta } = require('./voice-onboarding-state');
const { resolveTenantVoiceConfig, resolveClinicForCustomer } = require('./tenant-voice-config');
const { getSyncStatus } = require('./e10-interim-service');

function countCustomerCalls(db, customerId) {
  if (!db?.db || !customerId) return 0;
  try {
    const row = db.db
      .prepare(
        `SELECT COUNT(*) AS c FROM voice_call_log
         WHERE customer_id = ?
            OR (clinic_id IS NOT NULL AND clinic_id IN (
              SELECT clinic_id FROM customer_clinics WHERE customer_id = ?
            ))`
      )
      .get(customerId, customerId);
    return Number(row?.c || 0);
  } catch (_) {
    return 0;
  }
}

function isGoogleCalendarConnected(db, email) {
  if (!email || !db?.getUserCalendarSettingsByEmail) return false;
  const user = db.getUserCalendarSettingsByEmail(email);
  return !!(user?.google_calendar_connected && user?.google_refresh_token);
}

/**
 * @param {object} db
 * @param {object} customer
 * @returns {{ blockers: string[], checklist: object[] }}
 */
function resolveOnboardingBlockers(db, customer) {
  if (!customer) {
    return { blockers: [], checklist: [] };
  }

  const meta = parseMeta(customer);
  const clinic = resolveClinicForCustomer(db, customer.id);
  const clinicId = clinic?.clinic_id || null;
  const voiceConfig = resolveTenantVoiceConfig(db, {
    customerId: customer.id,
    merchantId: customer.merchant_id,
    clinicId
  });
  const settings = db.getVoiceAgentSettingsForProvider?.({
    merchantId: customer.merchant_id,
    customerId: customer.id
  });
  const greeting = settings?.greeting || settings?.inbound_greeting || null;
  const transfer = clinic?.transfer_number || voiceConfig.transfer_number || null;
  const transferDigits = String(transfer || '').replace(/\D/g, '');
  const hasCalls = countCustomerCalls(db, customer.id) > 0;
  const googleConnected = isGoogleCalendarConnected(db, customer.email);
  const calendarChoice = meta.calendar_connection || null;
  const calendarOk =
    googleConnected
    || (calendarChoice === 'somo' && meta.pms_selection === 'somo');
  const sync = clinicId ? getSyncStatus(clinicId) : null;
  const pmsManual = sync && !sync.pms_enabled && (sync.office_type === 'dental' || sync.pms_type === 'somo');
  const voiceSetupDone = !!customer.voice_setup_completed_at || !!clinic?.pilot_live_at;
  const shadowStarted = !!clinic?.shadow_week_active;
  const isLive = !!clinic?.pilot_live_at;
  const kellyEnabled = !!(settings?.enabled ?? settings?.enabled === 1);
  const forwardLineDone = hasCalls;

  const blockers = [];

  if (!customer.twilio_phone_number) {
    blockers.push('missing_dedicated_line');
  }
  if (!voiceConfig.config_status?.ready && !voiceSetupDone) {
    for (const m of voiceConfig.config_status?.missing || []) {
      if (m === 'transfer_number') blockers.push('transfer_missing');
      else if (m === 'business_hours') blockers.push('hours_missing');
      else if (m === 'clinic_email') blockers.push('profile_incomplete');
      else blockers.push(`config_${m}`);
    }
  }
  if (!greeting?.trim()) blockers.push('greeting_missing');
  if (transferDigits.length < 10) blockers.push('transfer_missing');
  if (!calendarOk && calendarChoice === 'skip') blockers.push('calendar_skipped');
  if (!hasCalls) blockers.push('test_call_pending');
  if (!forwardLineDone) blockers.push('forward_line_pending');
  if (!shadowStarted && !isLive && voiceSetupDone) blockers.push('shadow_week_pending');
  if (!kellyEnabled && isLive) blockers.push('kelly_not_live');

  const uniqueBlockers = [...new Set(blockers)];

  const checklist = [
    {
      id: 'voice-setup',
      label: 'Complete Kelly voice setup (greeting, hours, transfer #)',
      done: voiceSetupDone,
      href: '/business/voice-setup.html',
      severity: 'blocker'
    },
    {
      id: 'calendar',
      label: 'Connect Google Calendar or confirm Somo scheduling',
      done: calendarOk,
      href: '/business/settings.html#connected',
      severity: pmsManual ? 'info' : 'blocker'
    },
    {
      id: 'forward-line',
      label: 'Forward your main office line to Kelly',
      done: forwardLineDone,
      href: '/business/settings.html#profile',
      severity: 'blocker'
    },
    {
      id: 'test-call',
      label: 'Place a test call to your Kelly line',
      done: hasCalls,
      href: '/business/agent.html',
      severity: 'blocker'
    },
    {
      id: 'shadow-week',
      label: 'Run shadow week (copay logged, not spoken)',
      done: shadowStarted || isLive,
      href: '/business/settings.html#profile',
      severity: 'blocker'
    },
    {
      id: 'pms-manual',
      label: 'PMS manual sync — daily digest until Dentrix connects',
      done: !pmsManual || !!sync?.pms_enabled,
      href: '/business/settings.html#connected',
      severity: 'info'
    },
    {
      id: 'kelly-on',
      label: 'Turn Kelly on for live calls',
      done: kellyEnabled && isLive,
      href: '/business/agent.html',
      severity: 'blocker'
    }
  ];

  return { blockers: uniqueBlockers, checklist };
}

function buildOnboardingResponse(db, customer) {
  const { resolveOnboardingDestination, getOnboardingState } = require('./voice-onboarding-state');
  const destination = resolveOnboardingDestination(customer, db);
  const { blockers, checklist } = resolveOnboardingBlockers(db, customer);
  return {
    onboarding_state: getOnboardingState(customer),
    destination: { ...destination, blockers, checklist },
    voice_setup_completed_at: customer.voice_setup_completed_at || null,
    onboarding_meta: parseMeta(customer)
  };
}

module.exports = {
  resolveOnboardingBlockers,
  buildOnboardingResponse,
  countCustomerCalls,
  isGoogleCalendarConnected
};
