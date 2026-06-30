'use strict';

/** Stub — implement Redis pub/sub when HEALTH_SSE_BUS=redis */
module.exports = {
  register() {
    throw new Error('Redis SSE adapter not implemented — use HEALTH_SSE_BUS=memory');
  }
};
