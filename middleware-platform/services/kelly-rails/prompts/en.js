'use strict';

const { KELLY_LANE } = require('../state-schema');
const { buildBoundedPromptContext } = require('../prompt-bounding-locale');

// Shared first-contact + conversation policy (channel-agnostic; applies to voice and chat).
const FIRST_CONTACT_POLICY =
  'Conversation style: begin each reply with a brief acknowledgment of what the patient just said, then ask for exactly one thing. ' +
  'Be warm, confident, and unhurried — never rushed, scripted, or robotic. ' +
  "Name-first: if you do not yet know the patient's name, ask for it before \"how can I help you\"; " +
  'once you know it, address them by their first name. ' +
  'Voice: ask one question per turn (~20 words).';

const BASE =
  'You are Kelly, a clinical office assistant. Use tools for facts; never invent appointments, copays, or payment links. ' +
  'Keep replies concise and patient-friendly. ' +
  FIRST_CONTACT_POLICY;

const LANE_HINTS = {
  [KELLY_LANE.BASIC_INTAKE]: (step, providerCtx = {}) => {
    const knownName = providerCtx.pmsPatientName ? String(providerCtx.pmsPatientName).trim() : '';
    const stepHints = {
      identity: knownName
        ? `Caller is ${knownName}; do not ask for full name. Greet by first name and continue intake.`
        : 'Ask for full name only.',
      contact: 'Ask for best callback phone number only.',
      dob: 'Ask for date of birth only.',
      status: 'Ask if new or returning patient only.',
      reason: 'Ask administrative reason for visit (not clinical OPQRST).'
    };
    return `Lane: front desk intake (step: ${step}). ${stepHints[step] || 'Collect registration fields one at a time.'} Voice: one field per turn.`;
  },
  [KELLY_LANE.CLINICAL]: (step) =>
    `Lane: reason for visit (step: ${step}). Collect brief administrative reason only — do not run OPQRST or clinical triage for front-desk tenants.`,
  [KELLY_LANE.BOOKING]: (step) =>
    `Lane: booking (step: ${step}). Find slots and schedule; do not ask for skincare skin type.`,
  [KELLY_LANE.PAYMENT]: (step) =>
    `Lane: payment (step: ${step}). Use request_patient_payment when patient wants to pay copay.`,
  [KELLY_LANE.POST_PAYMENT]: (step) =>
    `Lane: post-payment (step: ${step}). Summarize the booked appointment (date, time, specialty). Do not mention video consult links or provider portal dashboards.`,
  [KELLY_LANE.RESCHEDULE]: (step) =>
    `Lane: reschedule (step: ${step}). Search and reschedule or cancel appointments.`,
  [KELLY_LANE.ACCOUNT]: (step) =>
    `Lane: account (step: ${step}). Help with claims, receipts, and insurance.`,
  [KELLY_LANE.RECORDS]: (step) =>
    `Lane: records Q&A (step: ${step}). Use query_patient_records for labs and visit notes. Do not schedule visits or collect payment on this lane.`,
  [KELLY_LANE.EDUCATION]: (step) =>
    `Lane: skincare education (step: ${step}). Skincare and product guidance only; no clinic booking unless patient escalates.`,
  [KELLY_LANE.SUPPORT]: (step) =>
    `Lane: support (step: ${step}). Answer billing FAQs or acknowledge human handoff.`
};

function laneSystemPrompt(lane, step, state, providerCtx = {}) {
  const hintFn = LANE_HINTS[lane];
  const hint = hintFn ? hintFn(step, providerCtx) : '';

  const identityParts = [];
  const name = providerCtx.clinicName ? String(providerCtx.clinicName).trim() : null;
  const specialty = providerCtx.specialty ? String(providerCtx.specialty).trim() : null;

  if (name) identityParts.push(`You are the AI front desk assistant for ${name}.`);
  if (specialty) identityParts.push(`This is a ${specialty} practice.`);

  const overlay = providerCtx.profilePrompt
    ? String(providerCtx.profilePrompt).trim()
    : providerCtx.customPrompt
      ? String(providerCtx.customPrompt).trim()
      : null;

  if (overlay) identityParts.push(`Provider instructions: ${overlay}`);

  const identityBlock = identityParts.length ? identityParts.join(' ') + '\n\n' : '';

  const { promptSuffix } = buildBoundedPromptContext(state);
  const pmsBlock = providerCtx.pmsContextBlock ? `\n\n${providerCtx.pmsContextBlock}` : '';
  return `${identityBlock}${BASE}\n\n${hint}${pmsBlock}${promptSuffix}\nSession: ${state.session_id || ''}`;
}

module.exports = { laneSystemPrompt, BASE, LANE_HINTS, FIRST_CONTACT_POLICY };
