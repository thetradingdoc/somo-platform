'use strict';

const { Subrail } = require('../conversation-mode-types');
const { handleBookingSubrail } = require('./booking-subrail');
const { handleCancellationSubrail } = require('./cancellation-subrail');
const { handleCopayLinkSubrail } = require('./copay-link-subrail');
const { handleSelfPaySubrail } = require('./self-pay-subrail');
const { handleOpqrstSubrail } = require('./opqrst-subrail');
const { handleRecordsQaSubrail } = require('./records-qa-subrail');
const { handleHandoffSubrail } = require('./handoff-subrail');

const HANDLERS = {
  [Subrail.BOOKING]: handleBookingSubrail,
  [Subrail.CANCELLATION]: handleCancellationSubrail,
  [Subrail.COPAY_LINK]: handleCopayLinkSubrail,
  [Subrail.SELF_PAY]: handleSelfPaySubrail,
  [Subrail.OPQRST]: handleOpqrstSubrail,
  [Subrail.RECORDS_QA]: handleRecordsQaSubrail,
  [Subrail.HANDOFF]: handleHandoffSubrail
};

async function handleSubrailTurn(subrail, ctx = {}) {
  const handler = HANDLERS[subrail];
  if (!handler) return null;
  return handler(ctx);
}

module.exports = { handleSubrailTurn, HANDLERS };
