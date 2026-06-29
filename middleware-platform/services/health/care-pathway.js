'use strict';

/**
 * Rule-based care pathway urgency (education only, no booking).
 */
function recommendPathway({ metadata = {}, safetyFlags = [] } = {}) {
  const negations = metadata.negations || {};
  const opqrst = metadata.opqrst || {};
  const reasons = [];

  const hasEmergencyFlag = (safetyFlags || []).some((f) =>
    /emergency|chest|breath|stroke|bleed|suicid/i.test(String(f.rule_id || f.match_snippet || ''))
  );
  if (hasEmergencyFlag) {
    return {
      urgency: 'emergency',
      summary: 'Your symptoms may need emergency care. Call local emergency services or go to the nearest ER.',
      reasons: ['Safety screening flagged urgent symptoms']
    };
  }

  const severity = String(opqrst.S || opqrst.severity || '').toLowerCase();
  if (/\b(severe|unbearable|9\/10|10\/10)\b/.test(severity)) {
    reasons.push('Patient reported severe symptoms');
    return {
      urgency: 'urgent_care',
      summary: 'Based on severity, consider urgent in-person evaluation within 24 hours.',
      reasons
    };
  }

  if (negations.fever_absent && negations.trauma_absent) {
    reasons.push('No fever or injury reported');
  }

  const region = String(opqrst.R || opqrst.region || '').toLowerCase();
  if (/rash|skin|itch/.test(region) && negations.fever_absent) {
    reasons.push('Localized skin concern without fever');
    return {
      urgency: 'routine_visit',
      summary: 'A routine visit with a clinician can help if symptoms persist or worsen.',
      reasons
    };
  }

  return {
    urgency: 'self_care',
    summary: 'Monitor symptoms, use general self-care, and seek care if things worsen.',
    reasons: reasons.length ? reasons : ['No urgent red flags from intake so far']
  };
}

module.exports = {
  recommendPathway
};
