'use strict';

const EXACT_ALLOWED_METRICS = new Set([
  'voice.interruption',
  'voice.stt_fatal',
  'voice.timeline'
]);

const PREFIX_ALLOWED = [
  'scan.'
];

function isAllowedLandingVoiceMetricName(metricName) {
  const name = String(metricName || '').trim();
  if (!name) return false;
  if (EXACT_ALLOWED_METRICS.has(name)) return true;
  if (PREFIX_ALLOWED.some((prefix) => name.startsWith(prefix))) {
    return /^[a-z0-9_.-]+$/i.test(name);
  }
  return false;
}

module.exports = {
  isAllowedLandingVoiceMetricName
};

