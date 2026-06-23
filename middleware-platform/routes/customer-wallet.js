const express = require('express');
const router = express.Router();
const db = require('../database');
const CircleService = require('../services/platform/circle-service');
const { requireCustomerAuth, requireMerchant } = require('../middleware/customer-auth');
const dailyLimit = 2000; // simple daily cap
const maxPerTxn = 1000;

function validateAmount(amount) {
  const n = Number(amount);
  return !isNaN(n) && n > 0 && n <= maxPerTxn;
}

function enforceLimit(amount) {
  // Placeholder: not tracking per-day sums; minimal cap per txn only.
  return amount <= maxPerTxn;
}

/**
 * GET /api/customer/wallet
 * Returns (and auto-creates) a wallet for the authenticated customer scoped to their merchant.
 */
router.get('/', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const merchantId = req.merchant_id || req.customer.merchant_id || null;

    if (!merchantId) {
      return res.status(400).json({
        success: false,
        error: 'merchant_not_set',
        message: 'Customer is not associated with a merchant.'
      });
    }

    if (!CircleService || !CircleService.isAvailable || !CircleService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'circle_unavailable',
        message: 'Wallet service is not configured.'
      });
    }

    // Ensure wallet exists
    const walletResult = await CircleService.getOrCreateCustomerWallet(customerId, {
      createIfNotExists: true,
      merchantId
    });

    if (!walletResult.success) {
      return res.status(500).json({
        success: false,
        error: 'wallet_create_failed',
        message: walletResult.error || 'Failed to create or fetch wallet'
      });
    }

    // Minimal ledger for now
    const transactions = await db.getWalletTransactions(customerId, merchantId, 50);
    const balance = await db.getWalletBalance(customerId, merchantId);

    return res.json({
      success: true,
      wallet: {
        walletId: walletResult.walletId || walletResult.account?.circle_wallet_id,
        merchant_id: merchantId,
        customer_id: customerId
      },
      balance,
      transactions
    });
  } catch (error) {
    console.error('Customer wallet error:', error);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: error.message
    });
  }
});

// Get transactions
router.get('/transactions', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const customerId = req.customer.id;
    const merchantId = req.merchant_id || req.customer.merchant_id || null;
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_set' });
    const transactions = await db.getWalletTransactions(customerId, merchantId, 100);
    const balance = await db.getWalletBalance(customerId, merchantId);
    return res.json({ success: true, transactions, balance });
  } catch (error) {
    console.error('Wallet tx error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

// Fund wallet (credit) - placeholder (no Circle onramp)
router.post('/fund', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!validateAmount(amount) || !enforceLimit(amount)) {
      return res.status(400).json({ success: false, error: 'invalid_amount', message: 'Amount must be >0 and <= 1000' });
    }
    const customerId = req.customer.id;
    const merchantId = req.merchant_id || req.customer.merchant_id || null;
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_set' });
    await db.createWalletTransaction({
      customer_id: customerId,
      merchant_id: merchantId,
      type: 'credit',
      amount: Number(amount),
      currency: 'USDC',
      metadata: { source: 'manual_fund' }
    });
    const balance = await db.getWalletBalance(customerId, merchantId);
    return res.json({ success: true, balance });
  } catch (error) {
    console.error('Fund wallet error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

// Pay with wallet (debit)
router.post('/pay', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!validateAmount(amount)) {
      return res.status(400).json({ success: false, error: 'invalid_amount', message: 'Amount must be >0 and <= 1000' });
    }
    const customerId = req.customer.id;
    const merchantId = req.merchant_id || req.customer.merchant_id || null;
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_set' });
    const balance = await db.getWalletBalance(customerId, merchantId);
    if (balance < amount) {
      return res.status(400).json({ success: false, error: 'insufficient_funds', message: 'Not enough wallet balance' });
    }
    await db.createWalletTransaction({
      customer_id: customerId,
      merchant_id: merchantId,
      type: 'debit',
      amount: Number(amount),
      currency: 'USDC',
      metadata: { source: 'wallet_pay' }
    });
    const newBalance = await db.getWalletBalance(customerId, merchantId);
    return res.json({ success: true, balance: newBalance });
  } catch (error) {
    console.error('Pay wallet error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

// Refund to wallet (credit)
router.post('/refund', requireCustomerAuth, requireMerchant, async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!validateAmount(amount)) {
      return res.status(400).json({ success: false, error: 'invalid_amount', message: 'Amount must be >0 and <= 1000' });
    }
    const customerId = req.customer.id;
    const merchantId = req.merchant_id || req.customer.merchant_id || null;
    if (!merchantId) return res.status(400).json({ success: false, error: 'merchant_not_set' });

    await db.createWalletTransaction({
      customer_id: customerId,
      merchant_id: merchantId,
      type: 'refund',
      amount: Number(amount),
      currency: 'USDC',
      metadata: { source: 'wallet_refund' }
    });
    const balance = await db.getWalletBalance(customerId, merchantId);
    return res.json({ success: true, balance });
  } catch (error) {
    console.error('Refund wallet error:', error);
    return res.status(500).json({ success: false, error: 'server_error', message: error.message });
  }
});

module.exports = router;

