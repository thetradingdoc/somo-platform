/**
 * Outbound Call API — tenant-scoped outbound with billing gates.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { canInitiateOutboundCall } = require('../services/billing-access');
const { initiateOutboundCall } = require('../services/outbound-call-service');

/**
 * POST /api/voice/outbound/call
 */
router.post('/call', requireCustomerAuth, async (req, res) => {
  try {
    const { phone_number } = req.body;
    const customerId = req.customer.id;
    const merchantId = req.customer?.merchant_id;

    if (!phone_number) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const access = canInitiateOutboundCall(db, customerId);
    if (!access.allowed) {
      return res.status(403).json({
        error: 'Outbound not allowed',
        reason: access.reason,
        message: access.message
      });
    }

    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant context is required' });
    }

    const result = await initiateOutboundCall({
      phone_number,
      merchantId,
      customer_id: customerId,
      call_type: 'operator_outbound'
    });

    res.json({
      success: true,
      ...result,
      message: 'Call initiated successfully'
    });
  } catch (error) {
    console.error('Outbound call error:', error);
    res.status(500).json({ error: `Failed to initiate call: ${error.message}` });
  }
});

module.exports = router;
