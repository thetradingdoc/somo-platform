/**
 * Lightweight sink for checkout-chat composer (no LLM): metrics + future persistence.
 */
const express = require('express');
const router = express.Router();
const db = require('../database');

router.post('/message', express.json(), (req, res) => {
  try {
    const { product_id, message } = req.body || {};
    const text = message != null ? String(message).trim() : '';
    if (!text || text.length > 8000) {
      return res.status(400).json({ success: false, error: 'invalid_message' });
    }
    try {
      db.incrementOpsCounter && db.incrementOpsCounter('checkout_chat_message');
    } catch (_) {}
    return res.json({
      success: true,
      received: true,
      product_id: product_id || null,
      length: text.length
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
