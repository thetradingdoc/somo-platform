/**
 * Local Off-Ramp Service
 * Converts USDC to local mobile money (M-Pesa) or fiat for rural liquidity.
 * For Busia: Integrate Kotani Pay or similar.
 *
 * Setup: Set KOTANI_API_KEY or OFF_RAMP_PROVIDER in .env.
 * Patient sees $10.00 in wallet → converts to M-Pesa/cash for local pharmacy.
 */

const KOTANI_API_KEY = process.env.KOTANI_API_KEY;
const OFF_RAMP_PROVIDER = process.env.OFF_RAMP_PROVIDER || 'kotani';

/**
 * Check if off-ramp is configured.
 */
function isConfigured() {
  return !!KOTANI_API_KEY;
}

/**
 * Request USDC → M-Pesa/cash conversion.
 * @param {Object} params - { walletAddress, amountUsdc, mobileMoneyPhone, currency }
 * @returns {Promise<{ success: boolean, transactionId?: string, error?: string }>}
 */
async function convertToLocal(params = {}) {
  if (!isConfigured()) {
    return { success: false, error: 'Off-ramp not configured (KOTANI_API_KEY)' };
  }

  const { walletAddress, amountUsdc, mobileMoneyPhone, currency = 'KES' } = params;

  if (!walletAddress || !amountUsdc || !mobileMoneyPhone) {
    return { success: false, error: 'walletAddress, amountUsdc, mobileMoneyPhone required' };
  }

  if (OFF_RAMP_PROVIDER === 'kotani' && KOTANI_API_KEY) {
    try {
      const axios = require('axios');
      const res = await axios.post(
        'https://api.kotani.io/v1/offramp',
        {
          wallet_address: walletAddress,
          amount: amountUsdc,
          destination: mobileMoneyPhone,
          destination_type: 'mobile_money',
          currency
        },
        { headers: { 'Authorization': `Bearer ${KOTANI_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      return { success: true, transactionId: res.data?.transaction_id };
    } catch (err) {
      console.error('Kotani off-ramp error:', err.response?.data || err.message);
      return { success: false, error: err.response?.data?.message || err.message };
    }
  }

  return { success: false, error: 'Unknown off-ramp provider' };
}

/**
 * Get supported regions and rates (stub).
 */
function getSupportedRegions() {
  return [
    { code: 'KE', name: 'Kenya', provider: 'mpesa', currency: 'KES' },
    { code: 'UG', name: 'Uganda', provider: 'mobile_money', currency: 'UGX' }
  ];
}

module.exports = {
  isConfigured,
  convertToLocal,
  getSupportedRegions
};
