# Stripe Issuing Integration - How It Works

## Overview

Stripe Issuing automatically creates virtual payment cards for every patient when they are registered in the DocLittle system. This enables patients to make healthcare payments directly from their allocated card balance.

## Integration Flow

### 1. **Patient Creation Trigger**
When a new patient is created via the FHIR service, Stripe Issuing is automatically triggered:

**Location:** `middleware-platform/services/fhir-service.js`

```javascript
// In getOrCreatePatient() method (line ~308)
if (StripeIssuingService) {
  try {
    await this.createPatientCard(patientResource, {
      clinic_id: patientData.clinic_id || null,
      spending_limit: patientData.card_spending_limit || 100000, // $1,000 default
      spending_interval: patientData.card_spending_interval || 'all_time'
    });
  } catch (cardError) {
    // Don't fail patient creation if card creation fails
    console.warn(`[FHIR] ⚠️  Failed to create Stripe card for patient ${patientResource.id}:`, cardError.message);
  }
}
```

### 2. **Card Creation Process**

**Location:** `middleware-platform/services/fhir-service.js` → `createPatientCard()` method (line ~812)

The process:
1. **Check for existing card** - Prevents duplicate cards
2. **Extract patient data** - Name, email, phone, address from FHIR resource
3. **Create Stripe Cardholder** - Via `StripeIssuingService.createCardholderAndCard()`
4. **Create Virtual Card** - With spending limits and controls
5. **Store in Database** - Save cardholder and card records

### 3. **Stripe Issuing Service**

**Location:** `middleware-platform/services/stripe-issuing-service.js`

This service handles:
- **Cardholder Creation** - Creates a Stripe cardholder entity
- **Card Creation** - Creates virtual or physical cards
- **Spending Controls** - Sets limits and restrictions
- **Card Management** - Update, cancel, retrieve card details

**Key Methods:**
- `createCardholder()` - Creates a cardholder in Stripe
- `createCard()` - Creates a card for a cardholder
- `createCardholderAndCard()` - Combined operation
- `getCardDetails()` - Retrieves PAN/CVC for virtual cards
- `updateCardSpendingControls()` - Updates spending limits
- `cancelCard()` - Cancels a card

### 4. **Database Storage**

**Location:** `middleware-platform/database.js`

Three tables store Stripe Issuing data:

1. **`stripe_cardholders`** - Cardholder information
   - Links to `fhir_patients` via `patient_id`
   - Stores Stripe cardholder ID, name, email, phone, billing address

2. **`stripe_cards`** - Card information
   - Links to `stripe_cardholders` via `cardholder_id`
   - Stores card details: last4, brand, expiry, spending controls

3. **`stripe_card_transactions`** - Transaction history
   - Links to `stripe_cards` via `card_id`
   - Stores all card transactions from Stripe webhooks

### 5. **API Endpoints**

**Location:** `middleware-platform/server.js`

Patient card management endpoints:

- `GET /api/patient/:patientId/cards` - Get all cards for a patient
- `POST /api/patient/:patientId/cards` - Create a new card
- `GET /api/patient/cards/:cardId` - Get card details (including PAN/CVC)
- `PATCH /api/patient/cards/:cardId/spending-controls` - Update spending limits
- `POST /api/patient/cards/:cardId/cancel` - Cancel a card
- `GET /api/patient/cards/:cardId/transactions` - Get card transactions
- `GET /api/patient/:patientId/transactions` - Get all patient transactions

### 6. **Webhook Handler**

**Location:** `middleware-platform/server.js` → `POST /webhooks/stripe/issuing`

Handles real-time Stripe events:
- `issuing_authorization.created` - Card authorization events
- `issuing_transaction.created` - Transaction events
- `issuing_card.created` - Card creation events
- `issuing_card.updated` - Card update events

### 7. **Frontend Integration**

**Location:** `unified-dashboard/patients/wallet.html` and `patient-dashboard.html`

**Wallet Page:**
- Displays all patient cards with brand styling
- Shows card details (masked number, expiry, spending limits)
- View full card details modal (PAN/CVC for virtual cards)
- View transaction history per card
- Cancel card functionality

**Dashboard:**
- Payment cards summary card
- Quick access to wallet page

## When Cards Are Created

Cards are automatically created when:
1. **New Patient Registration** - Via FHIR `getOrCreatePatient()`
2. **Voice Agent Registration** - When patient provides info during call
3. **Manual Creation** - Via API endpoint `POST /api/patient/:patientId/cards`

## Card Features

- **Virtual Cards** - Default card type
- **Spending Limits** - Configurable per card (default: $1,000)
- **Spending Controls** - Can restrict by category, merchant, etc.
- **Real-time Transactions** - Via Stripe webhooks
- **Card Details** - PAN and CVC available for virtual cards (in live mode)

## Configuration

**Environment Variables:**
- `STRIPE_SECRET_KEY` - Stripe API secret key (required for live mode)
- `STRIPE_ISSUING_WEBHOOK_SECRET` - Webhook verification secret

**Mock Mode:**
If `STRIPE_SECRET_KEY` is not set, the service operates in mock mode:
- Returns mock card IDs and details
- Logs operations to console
- Allows development without Stripe account

## Example Flow

1. Patient calls voice agent
2. Agent collects patient information
3. FHIR service creates patient record
4. **Stripe Issuing automatically creates card** ← **HERE**
5. Card stored in database
6. Patient can view card in wallet portal
7. Patient can use card for healthcare payments
8. Transactions tracked via webhooks

## Key Files

- `middleware-platform/services/fhir-service.js` - Triggers card creation
- `middleware-platform/services/stripe-issuing-service.js` - Stripe API wrapper
- `middleware-platform/database.js` - Database schema and CRUD functions
- `middleware-platform/server.js` - API endpoints and webhooks
- `unified-dashboard/patients/wallet.html` - Frontend card display
- `docs/STRIPE_ISSUING_IMPLEMENTATION.md` - Full implementation details

