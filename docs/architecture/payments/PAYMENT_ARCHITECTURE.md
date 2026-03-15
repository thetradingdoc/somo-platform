# Payment Architecture Overview

## Two Separate Payment Systems

### 1. **Circle API Wallets** (Already Implemented ✅)
**Purpose**: USDC cryptocurrency payments for **insurance claims**

**Flow**:
- Insurance claim gets approved
- Insurer pays provider via Circle (USDC transfer)
- Provider receives USDC in their Circle wallet
- Used for healthcare billing/insurance reimbursements

**Status**: ✅ **FULLY IMPLEMENTED**
- Wallet creation
- Balance checking
- USDC transfers
- Webhook verification

---

### 2. **Payment Methods** (TODOs - Different System)
**Purpose**: Traditional card payments for **appointments/products**

**Current Status**:
- ✅ **Link-based payment** (working) - Email verification → Payment page
- ❌ **Direct Stripe** (TODO) - Direct payment intent
- 🔄 **Mastercard Agent Pay** (Implemented – requires credentials) - Voice commerce integration
- 🔄 **Visa Agent Toolkit** (Implemented – requires credentials) - Voice commerce integration

**These are for**:
- Patient pays for appointments ($39.99)
- Patient pays for products/services
- Voice agent purchases
- AI commerce transactions

---

## Payment Method Implementation Details

### Current: Link-Based Payment (Working ✅)

**Flow**:
1. Create checkout → Generate verification code
2. Email code to patient
3. Patient verifies code → Get payment link
4. Patient clicks link → Stripe payment page
5. Patient enters card → Payment processed

**Code**: `_handleLinkPayment()` in `payment-orchestrator.js`

---

### TODO 1: Direct Stripe Payment Intent

**What it does**: Process payment immediately without email verification step

**Implementation**:
```javascript
static async _handleStripePayment(checkout, merchant, paymentRequest) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
        amount: checkout.amount * 100, // Convert to cents
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
            checkout_id: checkout.id,
            merchant_id: merchant.id
        }
    });
    
    return {
        success: true,
        payment_intent_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        requires_action: paymentIntent.status === 'requires_action'
    };
}
```

**When to use**: When you have card details already (e.g., saved cards, direct API calls)

---

### Mastercard Agent Pay ✅ (Implemented)

**What it does**: Voice commerce payment protocol from Mastercard

**Implementation** (in `payment-orchestrator.js` + `mastercard-agent-pay-service.js`):
- `_handleMastercardPayment`: mandate verification → authorization → payment
- Fallback to link payment when not configured or mandate missing
- Env: `MASTERCARD_AGENT_PAY_API_URL`, `MASTERCARD_AGENT_PAY_API_KEY`, `MASTERCARD_AGENT_PAY_MERCHANT_ID`

**Usage**: Voice agent calls `create_checkout` with `payment_method: "mastercard"` and `mandate_id`

---

### Visa Agent Toolkit ✅ (Implemented)

**What it does**: Voice commerce payment protocol from Visa

**Implementation** (in `payment-orchestrator.js` + `visa-agent-toolkit-service.js`):
- `_handleVisaPayment`: mandate verification → authorization → payment
- Fallback to link payment when not configured or mandate missing
- Env: `VISA_AGENT_TOOLKIT_API_URL`, `VISA_AGENT_TOOLKIT_API_KEY`, `VISA_AGENT_TOOLKIT_MERCHANT_ID`

**Usage**: Voice agent calls `create_checkout` with `payment_method: "visa"` and `mandate_id`

---

## Summary

**Circle API Wallets** = ✅ Done (for insurance claims)
**Payment Methods** = Link ✅, Stripe ✅, Mastercard 🔄, Visa 🔄

### Shared / Infrastructure (4.x)

- **4.1 Payment method selection:** `PAYMENT_METHODS_ALLOWED` env; `GET /api/payment/methods`
- **4.2 Retell function:** `get_available_payment_methods` – returns configured methods for voice
- **4.3 Documentation:** See [PAYMENT_ENV_AND_FLOWS.md](./PAYMENT_ENV_AND_FLOWS.md) for env vars and flow diagrams
- **4.4 Security:** `payment-security.js` – log sanitization, credential checks, PCI scope

