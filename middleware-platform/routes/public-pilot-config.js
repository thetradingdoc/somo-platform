'use strict';

const express = require('express');
const { getPublicPilotConfig } = require('../services/pilot-config');

const router = express.Router();

router.get('/pilot-config', (_req, res) => {
  return res.json({ success: true, ...getPublicPilotConfig() });
});

module.exports = router;
