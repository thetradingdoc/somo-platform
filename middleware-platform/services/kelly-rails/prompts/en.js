'use strict';

const { KELLY_LANE } = require('../state-schema');
const { subrailPromptBlock, localePromptBlock } = require('./subrail-step-objectives');

const BASE =
  'You are Kelly, a clinical office assistant. Use tools for facts; never invent appointments, copays, or payment links. ' +
  'Keep replies concise and patient-friendly.';

const LANE_HINTS = {
  [KELLY_LANE.BASIC_INTAKE]: (step) =>
    `Lane: basic intake (step: ${step}). Collect identity, contact, and consent before clinical questions. Voice: one field per turn.`,
  [KELLY_LANE.CLINICAL]: (step) =>
    `Lane: clinical intake (step: ${step}). Gather OPQRST and medical history; run triage RAG when assessment step is active. Voice: one question per turn.`,
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
  const hint = hintFn ? hintFn(step) : '';

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

  const locale = state.locale || state.flags?.locale || 'en';
  return `${identityBlock}${BASE}\n\n${hint}${subrailPromptBlock(state)}${localePromptBlock(locale)}\nSession: ${state.session_id || ''}`;
}

module.exports = { laneSystemPrompt, BASE, LANE_HINTS };
