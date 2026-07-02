'use strict';

/**
 * PaymentFlowService
 *
 * Shared helpers for payment route consistency:
 * - lifecycle response contracts
 * - provider wallet resolution policy
 * - standardized transition logging
 */
class PaymentFlowService {
  static async resolveAmountDue(opts = {}) {
    const { resolveAmountDue } = require('./resolve-amount-due');
    return resolveAmountDue(opts);
  }

  static async resolveCheckoutAmount(opts = {}) {
    const { resolveCheckoutAmount } = require('./resolve-amount-due');
    return resolveCheckoutAmount(opts);
  }

  static async resolvePatientCheckoutAmount(opts = {}) {
    const { resolvePatientCheckoutAmount } = require('./resolve-amount-due');
    return resolvePatientCheckoutAmount(opts);
  }

  static logAmountResolution(entry = {}) {
    const { logAmountResolution } = require('./resolve-amount-due');
    return logAmountResolution(entry);
  }

  static resolveProviderWalletId({ clinicId = null, merchantId = null } = {}) {
    // Resolution policy (stable order):
    // 1) Clinic-scoped provider wallet
    // 2) Merchant-scoped provider wallet
    // 3) Global provider wallet env
    // 4) System wallet fallback env
    const envClinicWallet = clinicId
      ? process.env[`CIRCLE_PROVIDER_WALLET_ID_CLINIC_${String(clinicId).toUpperCase()}`]
      : null;
    const envMerchantWallet = merchantId
      ? process.env[`CIRCLE_PROVIDER_WALLET_ID_MERCHANT_${String(merchantId).toUpperCase()}`]
      : null;
    const envProviderWallet = process.env.CIRCLE_PROVIDER_WALLET_ID || null;
    const envSystemWallet = process.env.CIRCLE_SYSTEM_WALLET_ID || null;

    const walletId = envClinicWallet || envMerchantWallet || envProviderWallet || envSystemWallet || null;
    const source = envClinicWallet
      ? 'clinic_env'
      : envMerchantWallet
        ? 'merchant_env'
        : envProviderWallet
          ? 'provider_env'
          : envSystemWallet
            ? 'system_env'
            : 'none';
    return { walletId, source };
  }

  static buildLifecycleResponse({
    stage,
    nextAction = null,
    message = null,
    checkoutId = null,
    paymentToken = null,
    paymentMethod = null,
    paymentIntentId = null,
    transferId = null,
    requiresVerification = null,
    requiresAction = null,
    wallet = null,
    extra = {}
  }) {
    return {
      success: true,
      stage,
      next_action: nextAction,
      message,
      checkout_id: checkoutId,
      payment_token: paymentToken,
      payment_method: paymentMethod,
      payment_intent_id: paymentIntentId,
      transfer_id: transferId,
      requires_verification: requiresVerification,
      requires_action: requiresAction,
      wallet,
      ...extra
    };
  }

  static logTransition(label, context = {}) {
    try {
      const ctx = {
        checkout_id: context.checkout_id || null,
        appointment_id: context.appointment_id || null,
        clinic_id: context.clinic_id || null,
        merchant_id: context.merchant_id || null,
        payment_method: context.payment_method || null,
        triage_session_id: context.triage_session_id || null
      };
      console.log(`[Payments] transition=${label}`, ctx);
    } catch (_) {}
  }
}

module.exports = PaymentFlowService;
