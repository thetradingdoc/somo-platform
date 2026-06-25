'use strict';

const KellyToolExecutor = require('../kelly-tool-executor');
const { resolvePatientPlan } = require('./navigation-payor-service');
const { checkPlanBenefits } = require('./navigation-benefits-service');
const { findCareNearMe, specialtyKeyForSpecialty } = require('./navigation-provider-service');
const { resolveEmployerMember } = require('./navigation-employer-service');
const { emitNavigationEvent, emitToolEvent } = require('./navigation-session-state');
const { resolveNavClinicId } = require('../../scripts/lib/navigation-demo-config.cjs');
const db = require('../../database');

const NAVIGATION_TOOLS = new Set([
  'resolve_patient_plan',
  'check_plan_benefits',
  'find_care_near_me',
  'resolve_employer_member',
  'get_available_slots',
  'schedule_appointment',
  'collect_insurance',
  'create_appointment_checkout'
]);

async function executeNavigationTool(toolName, args, ctx = {}) {
  const name = String(toolName || '').trim();
  const callId = ctx.callId || ctx.sessionId;
  emitToolEvent(ctx.db, callId, 'invoked', name, { args });

  let result;
  switch (name) {
    case 'resolve_patient_plan':
      result = resolvePatientPlan(args);
      if (result.success) {
        emitNavigationEvent(ctx.db, callId, 'plan_resolved', result);
      }
      break;
    case 'check_plan_benefits':
      result = checkPlanBenefits(args);
      if (result.success) {
        emitNavigationEvent(ctx.db, callId, 'benefits_returned', {
          payor_entity_id: result.payor_entity_id,
          zip: result.zip,
          benefit_count: result.benefits?.length || 0
        });
      }
      break;
    case 'find_care_near_me':
      result = await findCareNearMe(args);
      if (result.success) {
        emitNavigationEvent(ctx.db, callId, 'providers_offered', {
          specialty: result.specialty,
          provider_count: result.providers?.length || 0,
          in_network_only: !!args.in_network_only
        });
      }
      break;
    case 'resolve_employer_member':
      result = resolveEmployerMember(args);
      if (result.success) {
        emitNavigationEvent(ctx.db, callId, 'employer_member_resolved', {
          employer_id: result.employer_id,
          payor_entity_id: result.payor_entity_id
        });
      }
      break;
    default:
      result = await KellyToolExecutor.execute(name, args, {
        sessionId: callId,
        callId,
        clinic_id: args.clinic_id || ctx.clinicId || resolveNavClinicId(db),
        customer_id: ctx.customerId,
        merchant_id: ctx.merchantId
      });
      if (name === 'schedule_appointment' && result?.success) {
        emitNavigationEvent(ctx.db, callId, 'appointment_booked', {
          appointment_id: result.appointment_id || result.id || null
        });
      }
      if (name === 'create_appointment_checkout' && result?.success) {
        emitNavigationEvent(ctx.db, callId, 'checkout_created', {
          checkout_id: result.checkout_id || result.id || null
        });
      }
      break;
  }

  emitToolEvent(ctx.db, callId, 'completed', name, { success: !!result?.success, args, result });
  return result;
}

function isNavigationTool(name) {
  return NAVIGATION_TOOLS.has(String(name || '').trim());
}

module.exports = { executeNavigationTool, isNavigationTool, NAVIGATION_TOOLS };
