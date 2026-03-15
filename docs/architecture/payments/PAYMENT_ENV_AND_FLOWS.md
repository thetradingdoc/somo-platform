# Payment Environment Variables & Flow Diagrams

## 4.3 Environment Variables

### Core (required for card payments)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes (Stripe) | Stripe secret key for Payment Intents |
| `STRIPE_PUBLISHABLE_KEY` | Yes (Stripe) | Stripe publishable key for client-side |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Webhook signature verification |
| `BASE_URL` | Yes (links) | Base URL for payment links (e.g. `https://yoursite.com`) |

### Payment Method Selection (4.1)

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYMENT_METHODS_ALLOWED` | `link,stripe` | Comma-separated: `link`, `stripe`, `mastercard`, `visa` |

### Mastercard Agent Pay

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTERCARD_AGENT_PAY_API_URL` | Yes | API base URL (sandbox or production) |
| `MASTERCARD_AGENT_PAY_API_KEY` | Yes | API key |
| `MASTERCARD_AGENT_PAY_MERCHANT_ID` | No | Merchant ID |

### Visa Agent Toolkit

| Variable | Required | Description |
|----------|----------|-------------|
| `VISA_AGENT_TOOLKIT_API_URL` | Yes | API base URL (sandbox or production) |
| `VISA_AGENT_TOOLKIT_API_KEY` | Yes | API key |
| `VISA_AGENT_TOOLKIT_MERCHANT_ID` | No | Merchant ID |

---

## Flow Diagrams

### Link Payment (default)

```
Voice/Web → create_checkout (payment_method=link)
    → Email verification
    → Payment link sent
    → User clicks link → Stripe page
    → Card entered → /process-payment
    → Payment Intent created/confirmed
    → Webhook payment_intent.succeeded
    → Checkout completed
```

### Direct Stripe

```
Voice/Web → create_checkout (payment_method=stripe, payment_method_id=pm_xxx)
    → _handleStripePayment
    → Payment Intent create + confirm
    → If requires_action → return client_secret
    → Client: stripe.confirmCardPayment(client_secret)
    → Webhook → Checkout completed
```

### Mastercard / Visa (voice commerce)

```
Voice → create_checkout (payment_method=mastercard|visa, mandate_id=xxx)
    → _handleMastercardPayment | _handleVisaPayment
    → verifyMandate
    → createAuthorization
    → processPayment
    → Checkout completed
```

### Payment Method Selection

```
Request payment_method
    → isPaymentMethodAllowed(method, merchantId)?
        → PAYMENT_METHODS_ALLOWED env
        → merchant.allowed_payment_methods (if set)
    → If not allowed → fallback to link
    → If allowed → route to handler
    → Handler checks credentials → fallback to link if not configured
```

---

## 4.4 Security

### Credential handling

- Never log `STRIPE_SECRET_KEY`, `MASTERCARD_AGENT_PAY_API_KEY`, `VISA_AGENT_TOOLKIT_API_KEY`
- Use `payment-security.sanitizeForLog()` before logging payment-related objects
- Sensitive fields redacted: `payment_method_id`, `client_secret`, `mandate_id`, `token`

### PCI scope

- **In scope:** `payment_method_id`, `client_secret`, `mandate_id`, `payment_token`
- **Never log:** card number, CVV, full PAN
- **Stored tokens:** Use tokenized IDs only; never store raw card data

### Token handling

- Payment links use cryptographically secure tokens (32-byte hex)
- Tokens expire (1 hour for payment links)
- Idempotency keys prevent duplicate charges
