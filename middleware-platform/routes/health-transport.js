'use strict';

const express = require('express');
const router = express.Router();
const { handleAgentEvent, handleSse } = require('../services/health/transport/agent-events-handler');

router.get('/sse/:roomId', handleSse);
router.post('/agent-events', express.json(), handleAgentEvent);

/** @deprecated Use /api/health-session/sse — legacy redirect */
router.get('/sse-legacy/:roomId', (req, res) => {
  res.setHeader('X-Somo-Deprecated', 'use /api/health-session/sse');
  res.redirect(307, `/api/health-session/sse/${encodeURIComponent(req.params.roomId)}?${new URLSearchParams(req.query).toString()}`);
});

module.exports = router;
