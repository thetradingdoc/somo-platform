'use strict';

class PmsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PmsError';
    this.code = code;
    this.details = details;
  }
}

const PMS_ERROR = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NOT_ENABLED: 'NOT_ENABLED',
  TIMEOUT: 'TIMEOUT',
  LOOKUP_FAILED: 'LOOKUP_FAILED',
  SCHEDULE_FAILED: 'SCHEDULE_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  AMBIGUOUS_MATCH: 'AMBIGUOUS_MATCH',
  IDEMPOTENT_DUPLICATE: 'IDEMPOTENT_DUPLICATE',
  UNSUPPORTED: 'UNSUPPORTED'
};

module.exports = { PmsError, PMS_ERROR };
