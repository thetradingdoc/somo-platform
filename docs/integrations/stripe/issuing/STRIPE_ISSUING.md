# Stripe Issuing — Setup, Status & Implementation

**Last Updated:** April 6, 2026

Consolidated from: STRIPE_ISSUING_COMPLETE_GUIDE, STRIPE_ISSUING_STATUS, STRIPE_ISSUING_ON_DEMAND, STRIPE_ISSUING_IMPLEMENTATION, STRIPE_ISSUING_INTEGRATION.

---

## 1. Status

✅ **Fully Implemented** — Stripe Issuing integration is complete.

⚠️ **Requires Configuration** — Needs `STRIPE_SECRET_KEY`. Without it, runs in mock mode.

### Card Creation Modes

| Mode | When | Location | Note |
|------|------|----------|------|
| **Auto (legacy)** | At patient creation via FHIR | fhir-service.js `createPatientCard()` | Can be disabled |
| **On-demand** | When insured patient has bills/copays | insurance-service.js, voice/appointments/checkout | Cards only for insured patients with patient responsibility |
| **Manual** | `POST /api/patient/:patientId/cards` | server.js | Admin or patient request |

**Current default:** On-demand only for insured patients (see [On-Demand section](#4-on-demand-card-creation)).

---

## 2. Quick Setup

### Environment Variables
```bash
STRIPE_SECRET_KEY=sk_test_...    # Required
STRIPE_PUBLISHABLE_KEY=pk_test_...  # Optional (frontend)
STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...  # For webhooks
```

### Enable Issuing
1. [Stripe Dashboard → Issuing](https://dashboard.stripe.com/test/issuing) → Enable
2. Fund Issuing Balance (test mode: use `4242 4242 4242 4242`)

### Webhook
- **Endpoint:** `POST /webhooks/stripe/issuing`
- **Events:** `issuing_authorization.created`, `issuing_transaction.created`, `issuing_card.created`, `issuing_card.updated`

---

## 3. How It Works

### Flow
```
Patient/Bill/Copay → FHIR/Insurance → StripeIssuingService → Stripe API → stripe_cardholders, stripe_cards, stripe_card_transactions
```

### Database Tables
- **stripe_cardholders** — patient_id, stripe_cardholder_id, name, email, phone, billing_address
- **stripe_cards** — cardholder_id, stripe_card_id, last4, brand, spending_controls
- **stripe_card_transactions** — card_id, amount, merchant_name, status

### API Endpoints
- `GET /api/patient/:patientId/cards`
- `POST /api/patient/:patientId/cards`
- `GET /api/patient/cards/:cardId` (PAN/CVC for virtual)
- `PATCH /api/patient/cards/:cardId/spending-controls`
- `POST /api/patient/cards/:cardId/cancel`
- `GET /api/patient/cards/:cardId/transactions`

### Key Service Methods (stripe-issuing-service.js)
- `createCardholder()`, `createCard()`, `createCardholderAndCard()`
- `getCardDetails()`, `updateCardSpendingControls()`, `cancelCard()`

---

## 4. On-Demand Card Creation

Cards are **on-demand** for **insured patients** when:
- Insurance claim submitted with patient responsibility
- Appointment checkout with copay
- Manual API request (`POST /api/patient/:patientId/cards`)

**Insurance check:** Cards only created when `patientHasInsurance(patientId)`.

**Bill/copay limits:** Card limit = bill/copay amount + 10% buffer.

---

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| "Stripe Issuing not configured" | Set `STRIPE_SECRET_KEY` in .env |
| "Issuing not enabled" | Enable in Stripe Dashboard → Issuing |
| "Insufficient funds" | Add funds to Issuing Balance |
| Webhook not receiving events | Verify URL, `STRIPE_ISSUING_WEBHOOK_SECRET` |

---

## 6. Related

- [Payment Architecture](../../architecture/payments/PAYMENT_ARCHITECTURE.md)
- [API Documentation](../../api/API_DOCUMENTATION.md)
