'use strict';

/** @param {string} hypothesisId @param {string} location @param {string} message @param {object} data */
function stediArchLog(hypothesisId, location, message, data = {}) {
  if (process.env.STEDI_ARCH_DEBUG !== '1') return;
  console.debug('[stedi-arch]', { hypothesisId, location, message, ...data });
}

module.exports = { stediArchLog };
