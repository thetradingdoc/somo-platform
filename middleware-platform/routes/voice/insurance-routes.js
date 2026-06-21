'use strict';

/**
 * Voice insurance HTTP routes.
 * Route handlers live in voice-appointments.js; spine resolution is in voice-insurance-spine-handler.js.
 * This module documents the insurance domain boundary for reviewers (see CODING_LAYER_REVIEW.md).
 */

function registerVoiceInsuranceRoutes(_app, _ctx) {
  // Insurance endpoints: POST /voice/insurance/collect, check-eligibility, submit-claim, check-claim-status
  // Registered from registerVoiceAppointmentRoutes in routes/voice-appointments.js
}

module.exports = { registerVoiceInsuranceRoutes };
