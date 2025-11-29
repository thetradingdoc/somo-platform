# Stripe Issuing - Status & How It Works

## Current Status

✅ **Fully Implemented** - The Stripe Issuing integration is complete and ready to use.

⚠️ **Requires Configuration** - Needs `STRIPE_SECRET_KEY` to work in live mode. Without it, runs in mock mode.

## How It Works

### 1. **Automatic Card Creation**

When a patient is created in the system, a virtual card is **automatically** created:

```
Patient Created → FHIR Service → Stripe Issuing Service → Virtual Card Created
```

**Location:** `middleware-platform/services/fhir-service.js` → `createPatientCard()` method

**Flow:**
1. Patient is created via `FHIRService.getOrCreatePatient()`
2. After patient creation, `createPatientCard()` is automatically called
3. Stripe cardholder is created (if doesn't exist)
4. Virtual card is issued to the cardholder
5. Card details are stored in database

### 2. **What Gets Created**

#### **Cardholder** (in Stripe)
- Represents the patient as a cardholder
- Contains: name, email, phone, billing address
- Linked to patient via `patient_id` in metadata

#### **Virtual Card** (in Stripe)
- Virtual payment card (like a credit card)
- Can be added to Apple Pay / Google Pay
- Has spending limits and controls
- Default limit: $1,000 (configurable)

### 3. **Card Features**

- **Type:** Virtual cards (can add physical later)
- **Currency:** USD
- **Spending Limits:** 
  - Default: $1,000 (100,000 cents)
  - Intervals: `all_time`, `daily`, `weekly`, `monthly`, `yearly`
- **Spending Controls:**
  - Category restrictions (e.g., healthcare only)
  - Merchant restrictions
  - Time-based limits

### 4. **Database Storage**

Three tables store the card data:

1. **`stripe_cardholders`** - Cardholder info
   - Links to `fhir_patients` via `patient_id`
   - Stores Stripe cardholder ID, name, email, phone, address

2. **`stripe_cards`** - Card info
   - Links to `stripe_cardholders` via `cardholder_id`
   - Stores: last4, brand, expiry, spending controls

3. **`stripe_card_transactions`** - Transaction history
   - Links to `stripe_cards` via `card_id`
   - Stores all card transactions from Stripe webhooks

## API Endpoints (All Implemented)

### Get Patient Cards
```bash
GET /api/patient/:patientId/cards
```
Returns all cards for a patient.

### Create Card for Patient
```bash
POST /api/patient/:patientId/cards
{
  "spending_limit": 100000,  // $1,000 in cents
  "spending_interval": "all_time",
  "clinic_id": "clinic-123"
}
```

### Get Card Details (PAN/CVC)
```bash
GET /api/patient/cards/:cardId
```
Returns full card details including PAN (card number) and CVC for virtual cards.

### Update Spending Controls
```bash
PATCH /api/patient/cards/:cardId/spending-controls
{
  "spending_limit": 50000,
  "spending_interval": "monthly",
  "allowed_categories": ["healthcare", "pharmacy"]
}
```

### Cancel Card
```bash
POST /api/patient/cards/:cardId/cancel
```

### Get Card Transactions
```bash
GET /api/patient/cards/:cardId/transactions
GET /api/patient/:patientId/transactions
```

## Webhook Handler

**Endpoint:** `POST /webhooks/stripe/issuing`

Handles real-time Stripe events:
- `issuing_authorization.created` - When card is used
- `issuing_transaction.created` - Transaction completed
- `issuing_card.created` - Card created
- `issuing_card.updated` - Card updated

**What it does:**
- Stores transactions in database
- Updates card status
- Tracks authorization events

## Configuration

### Required Environment Variables

```bash
# Required for live mode
STRIPE_SECRET_KEY=sk_test_...  # or sk_live_... for production

# Optional (for webhook verification)
STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...
```

### Mock Mode

If `STRIPE_SECRET_KEY` is **not set**, the service runs in **mock mode**:
- ✅ All API calls work (return mock data)
- ✅ No actual Stripe API calls
- ✅ Logs operations to console
- ✅ Allows development without Stripe account

**Example Mock Response:**
```json
{
  "success": false,
  "mock": true,
  "error": "Stripe Issuing not configured",
  "mock_card_id": "card_mock_abc123"
}
```

## How to Test

### 1. **Test with Mock Mode** (No Stripe Account Needed)

```bash
# Don't set STRIPE_SECRET_KEY
# Create a patient via API or voice agent
# Check logs - should see mock card creation
```

### 2. **Test with Live Stripe** (Requires Stripe Account)

```bash
# Set STRIPE_SECRET_KEY in .env
export STRIPE_SECRET_KEY=sk_test_...

# Enable Stripe Issuing in Stripe Dashboard:
# 1. Go to Stripe Dashboard → Issuing
# 2. Complete onboarding
# 3. Get approved for card issuing
# 4. Fund your issuing balance

# Create a patient
POST /api/fhir/Patient
{
  "name": [{"given": ["John"], "family": "Doe"}],
  "telecom": [{"system": "phone", "value": "+15555551234"}]
}

# Check if card was created
GET /api/patient/:patientId/cards
```

### 3. **Test Webhooks** (Local Development)

```bash
# Install Stripe CLI
stripe listen --forward-to http://localhost:4000/webhooks/stripe/issuing

# Trigger test events
stripe trigger issuing_transaction.created
```

## Example Flow

### Scenario: Patient Calls Voice Agent

1. **Patient calls** → Voice agent collects info
2. **Patient created** → `FHIRService.getOrCreatePatient()` called
3. **Card automatically created** → `createPatientCard()` called
4. **Stripe cardholder created** → `StripeIssuingService.createCardholder()`
5. **Virtual card issued** → `StripeIssuingService.issueVirtualCard()`
6. **Card stored in database** → Linked to patient
7. **Patient can view card** → In wallet portal (`/patients/wallet.html`)
8. **Patient can use card** → For healthcare payments
9. **Transactions tracked** → Via Stripe webhooks

## Key Code Locations

### Service
- **`middleware-platform/services/stripe-issuing-service.js`** - Main service
  - `createCardholder()` - Creates Stripe cardholder
  - `issueVirtualCard()` - Issues virtual card
  - `createCardholderAndCard()` - Combined operation
  - `getCardDetails()` - Gets PAN/CVC
  - `updateCardSpendingControls()` - Updates limits
  - `cancelCard()` - Cancels card

### Integration
- **`middleware-platform/services/fhir-service.js`** - Auto-creates cards
  - `createPatientCard()` - Called after patient creation

### API Endpoints
- **`middleware-platform/server.js`** - All card management endpoints
  - Lines ~7695-7940: Card CRUD operations
  - Line ~7539: Webhook handler

### Database
- **`middleware-platform/database.js`** - Database functions
  - `createStripeCardholder()` - Store cardholder
  - `createStripeCard()` - Store card
  - `getCardsByPatientId()` - Get patient cards
  - `createCardTransaction()` - Store transaction

## Current Status Check

### ✅ What's Working

1. **Service Implementation** - Complete
2. **Auto-Card Creation** - Integrated with patient creation
3. **API Endpoints** - All implemented
4. **Webhook Handler** - Ready for events
5. **Database Schema** - Tables created
6. **Error Handling** - Graceful failures
7. **Mock Mode** - Works without Stripe

### ⚠️ What Needs Configuration

1. **Stripe Account** - Need to enable Issuing
2. **Stripe Secret Key** - Set `STRIPE_SECRET_KEY`
3. **Webhook Secret** - Optional, for webhook verification
4. **Issuing Balance** - Fund your Stripe Issuing balance

### ❓ To Check If It's Running

```bash
# Check if service is loaded
curl http://localhost:4000/api/patient/test-patient-id/cards

# Check logs when creating a patient
# Should see: "💳 Creating Stripe cardholder for patient: ..."
# Or: "⚠️  Stripe Issuing: Mock mode - cardholder creation skipped"
```

## Summary

**Status:** ✅ **Fully Implemented & Ready**

**How It Works:**
1. Patient created → Card automatically created
2. Virtual card issued with spending limits
3. Card stored in database
4. Transactions tracked via webhooks
5. Patient can view/use card in wallet

**To Use:**
- Set `STRIPE_SECRET_KEY` for live mode
- Or use mock mode for development
- Cards are created automatically when patients are created

**Next Steps:**
1. Enable Stripe Issuing in Stripe Dashboard
2. Set `STRIPE_SECRET_KEY` environment variable
3. Test by creating a patient
4. Check cards via API: `GET /api/patient/:patientId/cards`




