'use strict';

const express = require('express');
const router = express.Router();

/**
 * Operator wallboard stub (P2-026) — live calls + money actions feed.
 * Replace with SSE/WebSocket snapshot once call-timeline + RCM audit ledger are wired.
 */
router.get('/snapshot', (_req, res) => {
  return res.json({
    success: true,
    stub: true,
    live_calls: [],
    money_actions: [],
    updated_at: new Date().toISOString(),
    message: 'Wallboard feed not yet implemented — see services/rcm-payment-audit-ledger.js'
  });
});

module.exports = router;
