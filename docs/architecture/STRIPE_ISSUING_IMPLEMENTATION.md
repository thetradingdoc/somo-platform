# Stripe Issuing Implementation - Patient Virtual Cards

## Overview

This document describes the implementation of Stripe Issuing for automatically creating virtual cards for every patient in the DocLittle platform.

## What Was Implemented

### 1. Database Schema

#### New Tables

**`stripe_cardholders` table:**
- Stores Stripe cardholder information linked to patients
- Fields: `id`, `patient_id`, `clinic_id`, `stripe_cardholder_id`, `type`, `name`, `email`, `phone`, `billing_address`, `status`, `metadata`

**`stripe_cards` table:**
- Stores Stripe card information
- Fields: `id`, `patient_id`, `clinic_id`, `cardholder_id`, `stripe_card_id`, `type`, `currency`, `status`, `last4`, `brand`, `expiry_month`, `expiry_year`, `spending_controls`, `metadata`

**`stripe_card_transactions` table:**
- Stores card transaction history
- Fields: `id`, `card_id`, `patient_id`, `clinic_id`, `stripe_transaction_id`, `amount`, `currency`, `merchant_name`, `merchant_category`, `status`, `authorization_code`, `metadata`

#### Database Functions

Added to `database.js`:
- `createStripeCardholder()` - Create cardholder record
- `getCardholderByPatientId()` - Get cardholder by patient ID
- `getCardholderByStripeId()` - Get cardholder by Stripe ID
- `createStripeCard()` - Create card record
- `getCardsByPatientId()` - Get all cards for a patient
- `getCardByStripeId()` - Get card by Stripe ID
- `getCardById()` - Get card by internal ID
- `updateCardStatus()` - Update card status
- `updateCardSpendingControls()` - Update spending controls
- `createCardTransaction()` - Create transaction record
- `getTransactionsByCardId()` - Get transactions for a card
- `getTransactionsByPatientId()` - Get all transactions for a patient

### 2. Stripe Issuing Service

**File:** `middleware-platform/services/stripe-issuing-service.js`

**Features:**
- Create cardholders for patients
- Issue virtual cards automatically
- Set spending controls (limits, categories)
- Update card spending controls
- Get card details (PAN, CVC for virtual cards)
- Cancel cards
- Extract billing address from patient data

**Methods:**
- `createCardholder(patientData, options)` - Create a Stripe cardholder
- `issueVirtualCard(cardholderId, options)` - Issue a virtual card
- `createCardholderAndCard(patientData, options)` - Create cardholder and card in one call
- `updateCardSpendingControls(cardId, spendingControls)` - Update spending controls
- `getCardDetails(cardId)` - Get card details including PAN/CVC
- `cancelCard(cardId)` - Cancel a card
- `setSpendingLimit(cardId, amount, interval)` - Set spending limit

### 3. Integration with Patient Creation

**File:** `middleware-platform/services/fhir-service.js`

**Changes:**
- Automatically creates a Stripe card when a new patient is created
- Calls `createPatientCard()` after patient creation
- Handles errors gracefully (patient creation doesn't fail if card creation fails)
- Checks for existing cards before creating new ones

**New Method:**
- `createPatientCard(patientResource, options)` - Create Stripe card for a patient

### 4. API Endpoints

**File:** `middleware-platform/server.js`

**Endpoints:**
- `GET /api/patient/:patientId/cards` - Get all cards for a patient
- `POST /api/patient/:patientId/cards` - Create a new card for a patient
- `GET /api/patient/cards/:cardId` - Get card details (including PAN/CVC)
- `PATCH /api/patient/cards/:cardId/spending-controls` - Update spending controls
- `POST /api/patient/cards/:cardId/cancel` - Cancel a card
- `GET /api/patient/cards/:cardId/transactions` - Get transactions for a card
- `GET /api/patient/:patientId/transactions` - Get all transactions for a patient

### 5. Webhook Handler

**File:** `middleware-platform/server.js`

**Endpoint:** `POST /webhooks/stripe/issuing`

**Handles Events:**
- `issuing_authorization.created` - Authorization events
- `issuing_authorization.request` - Authorization requests
- `issuing_transaction.created` - Transaction created
- `issuing_card.created` - Card created
- `issuing_card.updated` - Card updated

**Functions:**
- `handleAuthorizationEvent()` - Handle authorization events
- `handleTransactionCreated()` - Store transaction records
- `handleCardCreated()` - Handle card creation webhook
- `handleCardUpdated()` - Update card status and controls

## Configuration

### Environment Variables

Required in `.env`:
```bash
STRIPE_SECRET_KEY=sk_test_... # Stripe secret key
STRIPE_ISSUING_WEBHOOK_SECRET=whsec_... # Stripe webhook secret (optional)
```

### Stripe Issuing Setup

1. **Enable Stripe Issuing:**
   - Go to Stripe Dashboard → Issuing
   - Complete onboarding process
   - Get approved for card issuing

2. **Configure Webhooks:**
   - Go to Stripe Dashboard → Webhooks
   - Add endpoint: `https://your-domain.com/webhooks/stripe/issuing`
   - Select events:
     - `issuing_authorization.created`
     - `issuing_authorization.request`
     - `issuing_transaction.created`
     - `issuing_card.created`
     - `issuing_card.updated`
   - Copy webhook secret to `.env`

3. **Fund Issuing Balance:**
   - Go to Stripe Dashboard → Issuing → Balance
   - Add funds to your issuing balance
   - Cards can only spend up to the available balance

## Usage

### Automatic Card Creation

When a patient is created via `FHIRService.getOrCreatePatient()`, a virtual card is automatically created:

```javascript
const patientResult = await FHIRService.getOrCreatePatient({
  name: 'John Doe',
  phone: '+15555551234',
  email: 'john@example.com'
});

// Card is automatically created and linked to the patient
```

### Manual Card Creation

Create a card for an existing patient:

```javascript
POST /api/patient/:patientId/cards
{
  "spending_limit": 100000, // $1,000 in cents
  "spending_interval": "all_time",
  "clinic_id": "clinic-123"
}
```

### Get Patient Cards

```javascript
GET /api/patient/:patientId/cards
```

Response:
```json
{
  "success": true,
  "cards": [
    {
      "id": "card-123",
      "stripe_card_id": "ic_...",
      "last4": "1234",
      "brand": "visa",
      "type": "virtual",
      "status": "active",
      "spending_controls": {
        "spending_limits": [
          {
            "amount": 100000,
            "interval": "all_time"
          }
        ]
      }
    }
  ],
  "count": 1
}
```

### Get Card Details (PAN/CVC)

```javascript
GET /api/patient/cards/:cardId
```

Response:
```json
{
  "success": true,
  "card": {
    "id": "card-123",
    "last4": "1234",
    "brand": "visa",
    "details": {
      "pan": "4242424242424242",
      "cvc": "123",
      "expiry_month": 12,
      "expiry_year": 2025
    }
  }
}
```

### Update Spending Controls

```javascript
PATCH /api/patient/cards/:cardId/spending-controls
{
  "spending_limit": 50000, // $500 in cents
  "spending_interval": "monthly",
  "allowed_categories": ["healthcare", "pharmacy"],
  "blocked_categories": ["alcohol", "tobacco"]
}
```

### Cancel Card

```javascript
POST /api/patient/cards/:cardId/cancel
```

### Get Transactions

```javascript
GET /api/patient/cards/:cardId/transactions
GET /api/patient/:patientId/transactions
```

## Default Settings

### Spending Limits

- **Default Limit:** $1,000 (100,000 cents)
- **Default Interval:** `all_time` (lifetime limit)
- **Other Intervals:** `daily`, `weekly`, `monthly`, `yearly`

### Card Type

- **Type:** Virtual cards only (can be added to Apple Pay/Google Pay)
- **Currency:** USD
- **Status:** Active

### Billing Address

- Extracted from patient FHIR resource
- Falls back to default address if not available
- Required by Stripe for cardholder creation

## Error Handling

### Card Creation Failures

- Patient creation continues even if card creation fails
- Errors are logged but don't block patient creation
- Cards can be created manually later via API

### Stripe API Errors

- Handled gracefully with error messages
- Returns mock responses in development if API key is not configured
- Logs all errors for debugging

### Webhook Failures

- Webhook events are logged
- Missing cards are handled gracefully
- Transactions are stored even if card lookup fails

## Testing

### Test Card Creation

1. Create a patient via API or voice agent
2. Check database for cardholder and card records
3. Verify card is linked to patient
4. Test spending controls

### Test Webhooks

1. Use Stripe CLI to forward webhooks:
   ```bash
   stripe listen --forward-to http://localhost:4000/webhooks/stripe/issuing
   ```

2. Trigger test events:
   ```bash
   stripe trigger issuing_transaction.created
   ```

3. Verify transactions are stored in database

## Security Considerations

### Card Data

- PAN and CVC are only returned via API (not stored in database)
- Card details are only available in live mode (not test mode)
- Access to card details should be restricted to authorized users

### Webhook Security

- Webhook signature verification (when secret is configured)
- Webhook events are validated before processing
- Invalid events are rejected

### Spending Controls

- Default limits prevent excessive spending
- Limits can be adjusted per patient
- Merchant category restrictions can be set

## Limitations

### Stripe Issuing Availability

- **US:** Available
- **UK:** Available
- **EEA:** Available
- **Other Countries:** Check Stripe documentation

### Card Types

- Currently only virtual cards are supported
- Physical cards can be added later
- Virtual cards can be added to digital wallets

### Funding

- Cards require funding via Stripe Issuing balance
- Balance must be maintained for cards to work
- Funding can be automated or manual

## Next Steps

### 1. Frontend UI

- Create patient card management UI
- Display card details (masked)
- Show transaction history
- Allow spending control updates

### 2. Card Funding

- Implement automatic funding for cards
- Add funding API endpoints
- Set up balance monitoring

### 3. Physical Cards

- Add support for physical card issuance
- Handle shipping addresses
- Track card delivery status

### 4. Enhanced Spending Controls

- Add time-based limits (business hours only)
- Add location-based restrictions
- Add merchant whitelist/blacklist

### 5. Card Replacement

- Implement card replacement flow
- Handle lost/stolen cards
- Update card status automatically

## Summary

✅ Database schema created
✅ Stripe Issuing service implemented
✅ Automatic card creation for patients
✅ API endpoints for card management
✅ Webhook handler for transactions
✅ Spending controls support
✅ Transaction tracking
✅ Error handling implemented

The Stripe Issuing integration is now fully functional and ready for testing!

## API Documentation

### Create Card for Patient

**Endpoint:** `POST /api/patient/:patientId/cards`

**Request Body:**
```json
{
  "spending_limit": 100000,
  "spending_interval": "all_time",
  "clinic_id": "clinic-123"
}
```

**Response:**
```json
{
  "success": true,
  "card": {
    "card_id": "ic_...",
    "cardholder_id": "ich_...",
    "last4": "1234",
    "brand": "visa"
  }
}
```

### Get Patient Cards

**Endpoint:** `GET /api/patient/:patientId/cards`

**Response:**
```json
{
  "success": true,
  "cards": [...],
  "count": 1
}
```

### Get Card Details

**Endpoint:** `GET /api/patient/cards/:cardId`

**Response:**
```json
{
  "success": true,
  "card": {
    "id": "card-123",
    "last4": "1234",
    "brand": "visa",
    "details": {
      "pan": "4242424242424242",
      "cvc": "123",
      "expiry_month": 12,
      "expiry_year": 2025
    }
  }
}
```

### Update Spending Controls

**Endpoint:** `PATCH /api/patient/cards/:cardId/spending-controls`

**Request Body:**
```json
{
  "spending_limit": 50000,
  "spending_interval": "monthly",
  "allowed_categories": ["healthcare", "pharmacy"]
}
```

### Cancel Card

**Endpoint:** `POST /api/patient/cards/:cardId/cancel`

**Response:**
```json
{
  "success": true,
  "message": "Card canceled successfully"
}
```

### Get Transactions

**Endpoint:** `GET /api/patient/cards/:cardId/transactions`

**Response:**
```json
{
  "success": true,
  "transactions": [...],
  "count": 10
}
```

