'use strict';

module.exports = async () => {
  try {
    const { stopMaintenanceTimer } = require('./utils/clinic-rate-limiter');
    stopMaintenanceTimer();
  } catch {
    /* clinic-rate-limiter may not be loaded */
  }
  try {
    const voiceRedis = require('./utils/voice-redis-client');
    await voiceRedis.closeClient();
  } catch {
    /* no redis client */
  }
};
