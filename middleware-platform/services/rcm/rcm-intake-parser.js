'use strict';

/**
 * Extract structured intake fields from Retell call-end payload (transcript, analysis, tool args).
 */
function parseIntakeFromCallPayload(payload = {}) {
  const text = [
    payload.transcript_summary,
    payload.transcript,
    payload.call_analysis?.custom_analysis_data?.summary,
    payload.call_analysis?.call_summary,
    JSON.stringify(payload.call_analysis || {}),
  ]
    .filter(Boolean)
    .join('\n');

  const intake = {
    patient_name: null,
    date_of_birth: null,
    visit_reason: null,
    member_id: null,
    payer_name: null,
    phone: null,
    duration_seconds: payload.duration_seconds ?? null,
    function_calls_count: payload.function_calls_count ?? null,
    raw_excerpt: text ? text.slice(0, 2000) : null,
  };

  const nameMatch = text.match(/(?:name is|i'm|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  if (nameMatch) intake.patient_name = nameMatch[1].trim();

  const dobMatch = text.match(/(?:born|dob|date of birth)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (dobMatch) intake.date_of_birth = dobMatch[1];

  const reasonMatch = text.match(/(?:reason|calling about|issue is|pain in|problem with)[:\s]*(.{3,120})/i);
  if (reasonMatch) intake.visit_reason = reasonMatch[1].trim().replace(/\.\s*$/, '');

  const memberMatch = text.match(/(?:member\s*id|member\s*#|id\s*number)[:\s]*([A-Z0-9\-]{5,20})/i);
  if (memberMatch) intake.member_id = memberMatch[1];

  const payerMatch = text.match(/(?:insurance|payer|plan is|coverage with)\s+([A-Za-z][A-Za-z0-9\s&]{2,40})/i);
  if (payerMatch) intake.payer_name = payerMatch[1].trim();

  const phoneMatch = text.match(/(\+?1?[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4})/);
  if (phoneMatch) intake.phone = phoneMatch[1];

  if (payload.patient_name) intake.patient_name = payload.patient_name;
  if (payload.visit_reason) intake.visit_reason = payload.visit_reason;
  if (payload.member_id) intake.member_id = payload.member_id;
  if (payload.payer_name) intake.payer_name = payload.payer_name;

  return intake;
}

module.exports = { parseIntakeFromCallPayload };
