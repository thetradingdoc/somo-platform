/**
 * PAYMENT SERVICE
 * Handles payment token generation and Stripe integration
 * 
 * Flow:
 * 1. Generate secure token for checkout
 * 2. Customer opens payment page with token
 * 3. Customer pays with Stripe
 * 4. Service validates and completes order
 */

const crypto = require('crypto');
const db = require('../database');

class PaymentService {
    /**
     * Create a secure payment token for checkout
     * Token is used in SMS link: /payment/{token}
     * 
     * Tokens expire after 1 hour for security
     */
    static createPaymentToken(checkoutId) {
        // Generate cryptographically secure random token
        const token = crypto.randomBytes(32).toString('hex');

        // Store token in database
        db.createPaymentToken({
            token,
            checkout_id: checkoutId,
            status: 'pending'
        });

        return token;
    }

    /**
     * Get checkout details by payment token
     * Validates token is not expired or already used
     * Note: getVoiceCheckout is async — must await or checkout row is a Promise and breaks payment UI.
     */
    static async getCheckoutByToken(token) {
        const paymentToken = db.getPaymentToken(token);

        if (!paymentToken) {
            return {
                success: false,
                error: 'Invalid payment link'
            };
        }

        // Task 18: Configurable expiry (default 1 hour)
        const expiryHours = parseFloat(process.env.PAYMENT_TOKEN_EXPIRY_HOURS || '1');
        const createdAt = new Date(paymentToken.created_at);
        const now = new Date();
        const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

        if (expiryHours > 0 && hoursSinceCreated > expiryHours) {
            return {
                success: false,
                error: 'Payment link expired'
            };
        }

        // Check if cancelled or already used
        if (paymentToken.status === 'cancelled') {
            return {
                success: false,
                error: 'Payment link was cancelled'
            };
        }
        if (paymentToken.status === 'used') {
            return {
                success: false,
                error: 'Payment link already used'
            };
        }

        // Get checkout details (Task 53: return checkout with requires_verification when pending)
        const checkout = await db.getVoiceCheckout(paymentToken.checkout_id);

        if (!checkout) {
            return {
                success: false,
                error: 'Checkout not found'
            };
        }

        // Get merchant details
        const merchant = db.getMerchant(checkout.merchant_id);

        // Task 53: require verification when token has verification_code and not yet verified
        const identity_verified = !!(paymentToken.identity_verified_at || paymentToken.status === 'verified');
        const requires_verification = !identity_verified && !!paymentToken.verification_code;

        return {
            success: true,
            checkout: {
                ...checkout,
                merchant_name: merchant ? merchant.name : 'Unknown Merchant'
            },
            token: paymentToken,
            requires_verification,
            identity_verified
        };
    }

    /**
     * Mark payment token as used
     * Prevents token reuse
     */
    static markTokenAsUsed(token) {
        db.updatePaymentToken(token, { status: 'used' });
    }

    /**
     * Process payment after Stripe confirmation
     * Called from payment page after Stripe processes card
     * SECURITY: Uses atomic check-and-set to prevent race conditions
     */
    static async processPayment(token, paymentIntentId) {
        // SECURITY: Atomic check-and-set - mark token as used only if still pending
        const tokenRecord = db.getPaymentToken(token);

        if (!tokenRecord) {
            return {
                success: false,
                error: 'Invalid payment link'
            };
        }

        // Task 18: Configurable expiry
        const expiryHours = parseFloat(process.env.PAYMENT_TOKEN_EXPIRY_HOURS || '1');
        const createdAt = new Date(tokenRecord.created_at);
        const now = new Date();
        const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

        if (expiryHours > 0 && hoursSinceCreated > expiryHours) {
            return {
                success: false,
                error: 'Payment link expired'
            };
        }
        if (tokenRecord.status === 'cancelled') {
            return {
                success: false,
                error: 'Payment link was cancelled'
            };
        }

        // ATOMIC: Update token to 'used' only after identity verification when verification_code exists.
        const requiresVerification = !!tokenRecord.verification_code;
        let updateResult = null;

        if (requiresVerification) {
            updateResult = db.updatePaymentTokenAtomic(token, 'verified', 'used');
        } else {
            // Legacy flow: allow redemption from pending tokens.
            updateResult = db.updatePaymentTokenAtomic(token, 'pending', 'used');
            if (!updateResult.success) {
                updateResult = db.updatePaymentTokenAtomic(token, 'verified', 'used');
            }
        }

        if (!updateResult?.success) {
            // Token was already used or in wrong state
            return {
                success: false,
                error: requiresVerification
                    ? (updateResult?.error || 'Identity verification required')
                    : (updateResult?.error || 'Payment link already used or invalid state'),
                error_code: requiresVerification ? 'IDENTITY_NOT_VERIFIED' : undefined
            };
        }

        // Get checkout details
        const checkout = await db.getVoiceCheckout(tokenRecord.checkout_id);
        if (!checkout) {
            return {
                success: false,
                error: 'Checkout not found'
            };
        }

        // Update checkout with payment intent
        // Align with enforced checkout lifecycle (pending -> completed) (mvp-23)
        await db.updateVoiceCheckout(checkout.id, {
            payment_intent_id: paymentIntentId,
            status: 'completed'
        });

        return {
            success: true,
            checkout_id: checkout.id,
            message: 'Payment processed successfully'
        };
    }

    /**
     * Get Stripe publishable key
     * SECURITY: No hardcoded fallback - must be set in environment
     */
    static getStripePublishableKey() {
        const key = process.env.STRIPE_PUBLISHABLE_KEY;
        if (!key) {
            throw new Error('STRIPE_PUBLISHABLE_KEY environment variable is required');
        }
        return key;
    }

    /**
     * Get Stripe secret key
     * In production, use environment variables
     */
    static getStripeSecretKey() {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY environment variable is required');
        }
        return process.env.STRIPE_SECRET_KEY;
    }
}

module.exports = PaymentService;