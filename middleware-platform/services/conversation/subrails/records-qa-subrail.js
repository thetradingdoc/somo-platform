'use strict';

async function handleRecordsQaSubrail(ctx = {}) {
  const msg = String(ctx.message || '').toLowerCase();
  const { Handoff } = require('../handoff-types');

  if (/upload|send records|fax|mail/.test(msg)) {
    return {
      reply:
        'For official record requests, our team will process that and follow up with you. I have noted your request.',
      active_subrail: 'records_qa',
      disposition: 'records_requested',
      state_updates: { records_deferred: true },
      handoff: Handoff.KELLY_REQUIRED
    };
  }

  return {
    reply:
      'Let me look up your records. What specific information from your last visit would you like to know?',
    active_subrail: 'records_qa',
    handoff: Handoff.KELLY_REQUIRED,
    kelly_lane_hint: 'records'
  };
}

module.exports = { handleRecordsQaSubrail };
