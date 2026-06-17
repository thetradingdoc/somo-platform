/**
 * Outbound Call API — tenant-scoped outbound with billing gates.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireCustomerAuth } = require('../middleware/customer-auth');
const { canInitiateOutboundCall } = require('../services/billing-access');
const { initiateOutboundCall } = require('../services/outbound-call-service');
const {
  resolveVoiceMerchantId,
  resolveOutboundCallTypeForCustomer
} = require('../services/operator-tenant-bootstrap');

/**
 * POST /api/voice/outbound/call
 */
router.post('/call', requireCustomerAuth, async (req, res) => {
  try {
    const { phone_number } = req.body;
    const customer = req.customer;
    const customerId = customer.id;
    const merchantId = resolveVoiceMerchantId(db, customer);

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
      call_type: resolveOutboundCallTypeForCustomer(customer)
    });

    res.json({
      success: true,
      ...result,
      message: 'Call initiated successfully'
    });
  } catch (error) {
    console.error('Outbound call error:', error);
    const status = error.code === 'outbound_disabled' ? 403 : 500;
    res.status(status).json({ error: `Failed to initiate call: ${error.message}` });
  }
});

module.exports = router;
