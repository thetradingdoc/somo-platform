/**
 * Voice Web Call API
 * Creates signed URLs for in-browser voice calls via ElevenLabs Conversational AI (demo)
 * Previously used Retell Web SDK
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { chatLimiter } = require('../middleware/rate-limiter');

/**
 * POST /api/voice/web-call-token
 * Get signed URL to start an ElevenLabs voice conversation (in-browser)
 */
router.post('/web-call-token', chatLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const merchantId = req.customer?.merchant_id;
    const customerId = req.customer?.id;

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'Merchant context is required'
      });
    }

    const merchant = db.getMerchant(merchantId);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        error: 'Merchant not found'
      });
    }

    const ElevenLabsService = require('../services/elevenlabs-service');
    const elevenLabsService = new ElevenLabsService();

    const result = await elevenLabsService.getSignedUrl();

    res.json({
      success: true,
      signed_url: result.signed_url,
      provider: 'elevenlabs',
      agent_id: result.agent_id,
      message: 'Signed URL valid for short period'
    });
  } catch (error) {
    console.error('Web call token error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create voice call token'
    });
  }
});

module.exports = router;
