'use strict';

const { KELLY_LANE } = require('../state-schema');
const {
  isFrontDeskTenant,
  nextFrontDeskField,
  frontDeskIntakeComplete,
  extractFieldFromMessage,
  storeFrontDeskFields,
  promptForField,
  recordFieldFailure,
  resetFieldFailures,
  shouldTransferOnIntakeFailure
} = require('../../front-desk-intake');
const { attemptEscalation } = require('../../escalation-service');
const { loadTenantPolicyFromProfile } = require('../../conversation-mode/tenant-policy');
const { TriagePolicy } = require('../../conversation-mode/tenant-policy');

async function runDeterministicFrontDeskIntake(state, ctx) {
  const db = ctx.db || require('../../../database');
  const triagePolicy = (() => {
    try {
      return loadTenantPolicyFromProfile(db, ctx.clinicId || state.clinic_id, ctx.customerId).triage_policy;
    } catch (_) {
      return null;
    }
  })();

  const frontDesk =
    triagePolicy === TriagePolicy.DISABLED ||
    isFrontDeskTenant({ ...ctx, triage_policy: triagePolicy, db });

  if (!frontDesk) return null;

  const sessionId = ctx.sessionId || state.session_id;
  if (!sessionId) return null;

  if (frontDeskIntakeComplete(sessionId)) {
    state.flags.basic_intake_complete = true;
    state.flags.front_desk_intake_complete = true;
    return null;
  }

  const locale = state.locale || ctx.locale || 'en';
  const nextField = nextFrontDeskField(sessionId);
  const msg = String(ctx.message || '').trim();

  if (msg && nextField) {
    const extracted = extractFieldFromMessage(nextField, msg);
    if (extracted) {
      storeFrontDeskFields(sessionId, { [nextField]: extracted });
      resetFieldFailures(sessionId, nextField);
    } else if (msg.length > 2) {
      recordFieldFailure(sessionId, nextField);
      if (shouldTransferOnIntakeFailure(sessionId, nextField, 2)) {
        const escalated = attemptEscalation(db, {
          sessionId,
          clinicId: ctx.clinicId || state.clinic_id,
          customerId: ctx.customerId,
          locale,
          reason: 'intake_field_unresolvable'
        });
        return {
          reply: escalated.reply || promptForField(nextField, locale),
          endCall: !!escalated.end_call,
          transfer_number: escalated.transfer_number || null,
          warm_transfer: !!escalated.transfer_number
        };
      }
    }
  }

  if (frontDeskIntakeComplete(sessionId)) {
    state.flags.basic_intake_complete = true;
    state.flags.front_desk_intake_complete = true;
    state.active_lane = state.active_lane || KELLY_LANE.BASIC_INTAKE;
    try {
      const { primaryIntent } = require('../../conversation-mode/intent-detector');
      const { UserIntent } = require('../../conversation-mode/conversation-mode-types');
      if (primaryIntent(msg).intent === UserIntent.PAY_COPAY) {
        return null;
      }
    } catch (_) {}
    return {
      reply:
        locale === 'es'
          ? 'Gracias — tengo sus datos. ¿En qué más puedo ayudarle hoy?'
          : locale === 'zh'
            ? '谢谢，我已记录您的信息。今天还有什么可以帮您的？'
            : locale === 'ru'
              ? 'Спасибо — данные записаны. Чем ещё могу помочь сегодня?'
              : 'Thanks — I have your details on file. How else can I help you today?',
      endCall: false
    };
  }

  const stillMissing = nextFrontDeskField(sessionId);
  if (!stillMissing) return null;

  if (
    state.active_lane === KELLY_LANE.BOOKING ||
    state.active_subrail === 'booking' ||
    /book|schedule|appointment|cita|预约|запис/i.test(msg)
  ) {
    return {
      reply: promptForField(stillMissing, locale),
      endCall: false
    };
  }

  if (state.active_lane === KELLY_LANE.BASIC_INTAKE || !state.active_lane || state.active_lane === KELLY_LANE.ROUTER) {
    state.active_lane = KELLY_LANE.BASIC_INTAKE;
    const stepMap = {
      full_name: 'identity',
      phone: 'contact',
      date_of_birth: 'dob',
      patient_status: 'status',
      reason_for_visit: 'reason'
    };
    state.step = stepMap[stillMissing] || 'identity';
    return {
      reply: promptForField(stillMissing, locale),
      endCall: false
    };
  }

  return null;
}

module.exports = { runDeterministicFrontDeskIntake };
