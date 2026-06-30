'use strict';

module.exports = {
  stediApiKey: () => String(process.env.STEDI_API_KEY || '').trim(),
  healthFinanceEnabled: () => process.env.HEALTH_SESSION_FINANCE_ENABLED === '1'
};
