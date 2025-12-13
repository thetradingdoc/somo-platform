/**
 * Outbound Call API
 * Tenant-scoped outbound call endpoint
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');

/**
 * POST /api/voice/outbound/call
 * Initiate an outbound call
 */
router.post('/call', requireCustomerAuth, async (req, res) => {
  try {
    const { phone_number, customer_id } = req.body;
    const merchantId = req.customer?.merchant_id;

    if (!phone_number) {
      return res.status(400).json({
        error: 'Phone number is required'
      });
    }

    if (!merchantId) {
      return res.status(400).json({
        error: 'Merchant context is required'
      });
    }

    // Validate phone number
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(phone_number)) {
      return res.status(400).json({
        error: 'Invalid phone number format'
      });
    }

    // Get merchant
    const merchant = db.getMerchant(merchantId);
    if (!merchant) {
      return res.status(404).json({
        error: 'Merchant not found'
      });
    }

    // Get Retell agent ID from merchant/clinic
    const clinic = db.getClinicBySlug(merchant.subdomain || '');
    const retellAgentId = clinic?.retell_agent_id || process.env.RETELL_AGENT_ID;

    if (!retellAgentId) {
      return res.status(400).json({
        error: 'Voice agent not configured. Please configure your voice agent settings.'
      });
    }

    // Initiate call
    const RetellService = require('../services/retell-service');
    const retellService = new RetellService();

    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      return res.status(400).json({
        error: 'Twilio phone number not configured. Please configure TWILIO_PHONE_NUMBER.'
      });
    }

    const call = await retellService.createOutboundCall(
      retellAgentId,
      fromNumber,
      phone_number,
      {
        override_agent_id: retellAgentId
      }
    );

    res.json({
      success: true,
      call_id: call.call_id,
      phone_number: phone_number,
      message: 'Call initiated successfully'
    });
  } catch (error) {
    console.error('Outbound call error:', error);
    res.status(500).json({
      error: `Failed to initiate call: ${error.message}`
    });
  }
});

module.exports = router;

