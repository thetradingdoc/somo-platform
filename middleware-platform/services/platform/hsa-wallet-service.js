/**
 * HSA Wallet Service
 * Embedded wallet creation for patients (Privy or Magic.link).
 * Enables "Bitcoin for Health" - patient as asset owner.
 *
 * Setup: Set PRIVY_APP_ID or MAGIC_PUBLISHABLE_KEY in .env.
 * For Busia: Phone-based wallet creation (no email required).
 */

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const MAGIC_PUBLISHABLE_KEY = process.env.MAGIC_PUBLISHABLE_KEY;

/**
 * Check if HSA wallet provider is configured.
 */
function isConfigured() {
  return !!(PRIVY_APP_ID || MAGIC_PUBLISHABLE_KEY);
}

/**
 * Create embedded wallet for patient (stub - implement with Privy/Magic SDK).
 * @param {Object} params - { phone, email?, patientId }
 * @returns {Promise<{ walletAddress: string, provider: string }|null>}
 */
async function createPatientWallet(params = {}) {
  if (!isConfigured()) {
    console.warn('HSA wallet: No provider configured (PRIVY_APP_ID or MAGIC_PUBLISHABLE_KEY)');
    return null;
  }

  const { phone, email, patientId } = params;

  // Privy: npm install @privy-io/server-auth
  if (PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    try {
      const { PrivyClient } = require('@privy-io/server-auth');
      const privy = new PrivyClient(PRIVY_APP_ID, process.env.PRIVY_APP_SECRET);
      const user = await privy.createUser({ linkedAccount: phone || email });
      const wallet = user?.linkedAccounts?.find(a => a.type === 'wallet');
      if (wallet?.address) return { walletAddress: wallet.address, provider: 'privy' };
    } catch (err) {
      console.error('Privy wallet creation failed:', err.message);
      return null;
    }
  }

  // Magic: Client-side SDK - server returns config for init
  if (MAGIC_PUBLISHABLE_KEY) {
    console.warn('Magic.link: Use client SDK with getClientConfig() - server init not implemented');
    return null;
  }

  return null;
}

/**
 * Get wallet creation config for client-side (Privy/Magic init).
 */
function getClientConfig() {
  return {
    configured: isConfigured(),
    privyAppId: PRIVY_APP_ID || null,
    magicKey: MAGIC_PUBLISHABLE_KEY || null
  };
}

module.exports = {
  isConfigured,
  createPatientWallet,
  getClientConfig
};
