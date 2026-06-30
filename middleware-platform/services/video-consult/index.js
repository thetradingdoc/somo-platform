'use strict';

/** Video consult provider domain barrel (Phase 4). */
module.exports = {
  service: require('../video-consult-service'),
  graph: require('../video-consult-graph'),
  sse: require('../video-consult-sse'),
  assistant: require('../video-consult-assistant-service')
};
