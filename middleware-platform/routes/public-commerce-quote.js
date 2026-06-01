const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const {
  resolvePrescriptionId,
  withProviderAliases,
  withPrescriptionAliases,
  logAliasUsage
} = require('../utils/naming-aliases');
const { resolveMerchantId, parseCheckoutSessionData, isQuoteExpired } = require('../utils/public-commerce-helpers');

function _buildPriceNote(q) {
  const tax = Number(q?.tax_amount || 0);
  if (q?.tax_included === true && tax === 0) {
    return 'No tax applies to this order.';
  }
  if (q?.tax_included === true && tax > 0) {
    return `Price includes $${tax.toFixed(2)} tax.`;
  }
  if (q?.tax_included === false && tax > 0) {
    return `$${tax.toFixed(2)} tax will be added at checkout.`;
  }
  return 'See checkout for any applicable taxes.';
}

/**
 * Server-trusted commerce quote: stores amount in checkout_sessions (platform commerce_quote).
 * UI/agents use returned quote_id with POST /api/public/checkout/start — never trust client price.
 */
router.post('/quote', (req, res) => {
  try {
    logAliasUsage('public-commerce-quote', req);
    const merchantId = resolveMerchantId(req);
    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'merchant_not_found' });
    }

    const productId = resolvePrescriptionId(req.body || {});
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id_required' });
    }

    const qtyRaw = (req.body || {}).quantity;
    const qty = Number.isFinite(Number(qtyRaw)) ? Math.max(1, Math.floor(Number(qtyRaw))) : 1;
    const kellySessionId = (req.body || {}).kelly_session_id || (req.body || {}).session_id || null;

    const product = db.getProduct(productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'product_not_found' });
    }
    if (product.merchant_id && product.merchant_id !== merchantId) {
      return res.status(403).json({ success: false, error: 'product_merchant_mismatch' });
    }

    const unit = Number(product.price || 0);
    const amountCents = Math.round(unit * 100) * qty;
    const amount = amountCents / 100;

    try {
      db.db
        .prepare(
          `DELETE FROM checkout_sessions 
         WHERE platform = 'commerce_quote' AND status = 'quoted' 
         AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`
        )
        .run();
    } catch (_) {}

    if (kellySessionId) {
      try {
        const rows = db.db
          .prepare(
            `SELECT * FROM checkout_sessions 
           WHERE platform = 'commerce_quote' AND merchant_id = ? AND status = 'quoted'
           ORDER BY created_at DESC
           LIMIT 50`
          )
          .all(merchantId);
        for (const r of rows) {
          if (isQuoteExpired(r)) continue;
          const d = parseCheckoutSessionData(r.session_data);
          if (!d || d.kind !== 'commerce_quote') continue;
          if (d.product_id !== productId || d.merchant_id !== merchantId) continue;
          if (String(d.kelly_session_id || '') !== String(kellySessionId)) continue;

          const nextData = {
            ...d,
            quantity: qty,
            amount_cents: amountCents,
            currency: 'USD',
            kelly_session_id: kellySessionId
          };
          if (d.amount_cents !== amountCents || d.quantity !== qty) {
            db.updateCheckoutSession(r.id, 'quoted', nextData);
          }
          const row = db.getCheckoutSession(r.id);
          const subtotal = amount;
          const taxAmount = 0;
          const taxRate = 0;
          const taxIncluded = false;
          const payload = withPrescriptionAliases(
            {
              success: true,
              quote_id: r.id,
              checkout_session_id: r.id,
              amount,
              subtotal,
              tax_amount: taxAmount,
              tax_rate: taxRate,
              tax_included: taxIncluded,
              price_note: _buildPriceNote({ tax_amount: taxAmount, tax_included: taxIncluded }),
              currency: 'USD',
              product_id: productId,
              quantity: qty,
              expires_at: row?.expires_at || null,
              reused: true
            },
            productId
          );
          return res.json(withProviderAliases(payload, merchantId));
        }
      } catch (reuseErr) {
        console.warn('[public-commerce-quote] reuse lookup failed:', reuseErr.message);
      }
    }

    const id = uuidv4();
    const sessionData = {
      kind: 'commerce_quote',
      product_id: productId,
      merchant_id: merchantId,
      quantity: qty,
      amount_cents: amountCents,
      currency: 'USD',
      kelly_session_id: kellySessionId || null
    };

    db.createCheckoutSession({
      id,
      merchant_id: merchantId,
      platform: 'commerce_quote',
      session_data: sessionData,
      status: 'quoted',
      kelly_session_id: kellySessionId || null
    });

    const row = db.getCheckoutSession(id);
    const subtotal = amount;
    const taxAmount = 0;
    const taxRate = 0;
    const taxIncluded = false;
    const payload = withPrescriptionAliases(
      {
        success: true,
        quote_id: id,
        checkout_session_id: id,
        amount,
        subtotal,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_included: taxIncluded,
        price_note: _buildPriceNote({ tax_amount: taxAmount, tax_included: taxIncluded }),
        currency: 'USD',
        product_id: productId,
        quantity: qty,
        expires_at: row?.expires_at || null
      },
      productId
    );
    return res.json(withProviderAliases(payload, merchantId));
  } catch (e) {
    console.error('public commerce quote error:', e);
    return res.status(500).json({ success: false, error: 'server_error', message: e.message });
  }
});

module.exports = router;
