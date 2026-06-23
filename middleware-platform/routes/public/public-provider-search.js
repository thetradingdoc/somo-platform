'use strict';

const express = require('express');

/** Stub router — provider search not configured in this workspace snapshot. */
const router = express.Router();

router.get('/search', (_req, res) => {
  res.status(503).json({
    success: false,
    error: 'provider_search_unavailable',
    message: 'Public provider search is not configured on this server build.'
  });
});

router.get('/health', (_req, res) => {
  res.json({ success: true, status: 'stub' });
});

module.exports = router;
