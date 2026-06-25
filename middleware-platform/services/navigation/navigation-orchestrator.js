'use strict';

const { executeNavigationTool } = require('./navigation-tool-executor');
const { getState, mergeState } = require('./navigation-session-state');
const {
  extractZip,
  extractPlanHint,
  extractCareNeed,
  extractMemberId,
  extractEmployerCode,
  wantsContactInfo
} = require('./navigation-intent-parser');
const { recommendCare, formatContactOffer } = require('./navigation-provider-service');
const { resolveNavClinicId } = require('../../scripts/lib/navigation-demo-config.cjs');
const { attemptEscalation } = require('../escalation-service');

async function processNavigationTurn({ callId, connection, userSaid, db }) {
  const state = getState(connection);
  const text = String(userSaid || '').trim();
  const ctx = {
    db,
    callId,
    sessionId: callId,
    clinicId: connection.clinic_id || resolveNavClinicId(db),
    customerId: connection.customer_id,
    merchantId: connection.merchant_id
  };

  if (state.flow_stage === 'recommendation_offered' && wantsContactInfo(text)) {
    const provider = state.selected_provider;
    if (provider) {
      mergeState(connection, { flow_stage: 'contact_shared' });
      return formatContactOffer(provider);
    }
  }

  const employerCode = extractEmployerCode(text);
  const memberId = extractMemberId(text);
  if (employerCode && memberId) {
    const emp = await executeNavigationTool(
      'resolve_employer_member',
      { employer_code: employerCode, member_id: memberId },
      ctx
    );
    if (emp.success) {
      mergeState(connection, {
        payor_entity_id: emp.payor_entity_id,
        payer_id: emp.payer_id,
        plan_display_name: emp.plan_display_name,
        member_id: emp.member_id,
        employer_id: emp.employer_id,
        flow_stage: 'plan_resolved'
      });
      if (!state.zip) {
        return `Thanks — I verified your employer plan as ${emp.plan_display_name}. What ZIP code are you looking for care in?`;
      }
    }
  }

  const careNeed = extractCareNeed(text);
  if (careNeed) {
    mergeState(connection, {
      care_need_label: careNeed.label,
      last_specialty: careNeed.specialty,
      flow_stage: state.flow_stage === 'greeting' ? 'need_captured' : state.flow_stage || 'need_captured'
    });
  }

  const specialty = state.last_specialty || careNeed?.specialty || null;
  const careLabel = state.care_need_label || careNeed?.label || null;

  const planHint = extractPlanHint(text);
  if (planHint && !state.payor_entity_id) {
    const plan = await executeNavigationTool('resolve_patient_plan', { plan_name: planHint, state_hint: 'NY' }, ctx);
    if (plan.success) {
      mergeState(connection, {
        payor_entity_id: plan.payor_entity_id,
        payer_id: plan.payer_id,
        plan_display_name: plan.plan_display_name,
        flow_stage: 'plan_resolved'
      });
      if (!specialty) {
        return `Got it — ${plan.plan_display_name}. What kind of care do you need?`;
      }
      if (!state.zip && !zip) {
        return `Got it — ${plan.plan_display_name}. What ZIP code or neighborhood are you in?`;
      }
    } else {
      return plan.message || 'I could not match that plan. Try Metro Health Plus.';
    }
  }

  const zip = extractZip(text);
  if (zip) {
    mergeState(connection, { zip, region: 'NYC', flow_stage: state.flow_stage || 'location_set' });
  }

  const effectiveZip = zip || state.zip;
  const effectivePlan = state.payor_entity_id;

  if (specialty && effectivePlan && effectiveZip && state.flow_stage !== 'contact_shared') {
    const rec = await recommendCare({
      clinic_id: ctx.clinicId,
      specialty,
      care_label: careLabel,
      zip: effectiveZip,
      payor_entity_id: state.payor_entity_id,
      payer_id: state.payer_id,
      plan_display_name: state.plan_display_name,
      in_network_only: process.env.NAVIGATION_IN_NETWORK_ONLY === '1'
    });
    if (rec.success) {
      mergeState(connection, {
        selected_provider: rec.provider,
        last_specialty: specialty,
        flow_stage: 'recommendation_offered'
      });
      return `${rec.narrative} Want their phone number and hours?`;
    }
    return rec.message || 'I could not find a provider for that need right now.';
  }

  if (/transfer|human|representative|agent/i.test(text)) {
    try {
      const esc = attemptEscalation(db, {
        sessionId: callId,
        callId,
        reason: 'navigation_handoff',
        routing_world: 'navigation',
        customer_id: connection.customer_id
      });
      return esc.reply || 'Let me connect you with our team.';
    } catch (_) {}
  }

  if (state.plan_display_name && /what.*plan|which plan|my plan/i.test(text)) {
    return `You are on ${state.plan_display_name}${state.zip ? ` near ZIP ${state.zip}` : ''}.`;
  }

  if (!specialty && !careLabel) {
    return 'Tell me what you need — for example a dentist, braces, or help with anxiety.';
  }
  if (!state.payor_entity_id) {
    return 'What health plan are you on?';
  }
  if (!effectiveZip) {
    return 'What ZIP code or neighborhood are you in?';
  }

  return 'I can help you find the right in-network care. What do you need help with today?';
}

module.exports = { processNavigationTurn };
