# Stripe Issuing - Complete Setup & Implementation Guide

**Last Updated**: January 2025  
**Status**: Production Ready

---

## 📋 Overview

Stripe Issuing automatically creates virtual payment cards for every patient when they are registered in the DocLittle system. This enables patients to make healthcare payments directly from their allocated card balance.

### Key Features

- ✅ **Automatic Card Creation** - Cards created when patients are registered
- ✅ **Virtual Cards** - Default card type for all patients
- ✅ **Spending Controls** - Configurable limits per card
- ✅ **Real-time Transactions** - Tracked via Stripe webhooks
- ✅ **Multi-Tenant Support** - Cards isolated per clinic/tenant

---

## 🚀 Quick Setup (15 Minutes)

### Step 1: Get Your Stripe Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers** → **API keys**
3. Copy:
   - **Publishable Key** (starts with `pk_test_...` or `pk_live_...`)
   - **Secret Key** (starts with `sk_test_...` or `sk_live_...`)

### Step 2: Add Keys to Environment Variables

**Development (.env file):**
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

**Production (Azure App Settings):**
```bash
az webapp config appsettings set \
  --resource-group doclittle \
  --name doclittle \
  --settings \
    STRIPE_SECRET_KEY=sk_live_... \
    STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### Step 3: Enable Stripe Issuing

1. Go to [Stripe Dashboard → Issuing](https://dashboard.stripe.com/test/issuing)
2. Click **"Get Started"** or **"Enable Issuing"**
3. Fill out business information
4. Accept terms and conditions
5. Wait for approval (usually instant for test mode)

### Step 4: Fund Your Issuing Balance (Test Mode)

1. Go to [Issuing Balance](https://dashboard.stripe.com/test/issuing/balance)
2. Click **"Add Funds"** or **"Top Up"**
3. Enter amount (e.g., $1,000 for testing)
4. Use test card: `4242 4242 4242 4242`

**Note:** In test mode, you can add unlimited test funds. In live mode, you'll need real money.

### Step 5: Set Up Webhook (Optional but Recommended)

#### For Local Development:

1. **Install Stripe CLI:**
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   ```

2. **Login to Stripe:**
   ```bash
   stripe login
   ```

3. **Forward Webhooks:**
   ```bash
   stripe listen --forward-to http://localhost:4000/webhooks/stripe/issuing
   ```

4. **Copy Webhook Secret:**
   - The CLI outputs: `whsec_...`
   - Add to `.env`:
     ```bash
     STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...
     ```

#### For Production:

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Click **"Add endpoint"**
3. URL: `https://api.doclittle.site/webhooks/stripe/issuing`
4. Select events:
   - `issuing_authorization.created`
   - `issuing_authorization.request`
   - `issuing_transaction.created`
   - `issuing_card.created`
   - `issuing_card.updated`
5. Copy **Signing secret** (`whsec_...`) and add to environment variables

### Step 6: Restart Server

```bash
cd middleware-platform
npm start
```

### Step 7: Test It!

Create a patient and verify card is created:

```bash
curl -X POST http://localhost:4000/api/fhir/Patient \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Patient",
    "name": [{"given": ["John"], "family": "Doe"}],
    "telecom": [
      {"system": "phone", "value": "+15555551234"},
      {"system": "email", "value": "john@example.com"}
    ],
    "address": [{
      "line": ["123 Main St"],
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    }]
  }'
```

**Check logs** - You should see:
```
💳 Creating Stripe cardholder for patient: John Doe
✅ Stripe cardholder created: ich_...
💳 Issuing virtual card for cardholder: ich_...
✅ Virtual card issued: ic_... (****1234)
```

---

## 🔄 How It Works

### Integration Flow

#### 1. Patient Creation Trigger

When a new patient is created via the FHIR service, Stripe Issuing is automatically triggered:

**Location:** `middleware-platform/services/fhir-service.js`

```javascript
// In getOrCreatePatient() method
if (StripeIssuingService) {
  try {
    await this.createPatientCard(patientResource, {
      clinic_id: patientData.clinic_id || null,
      spending_limit: patientData.card_spending_limit || 100000, // $1,000 default
      spending_interval: patientData.card_spending_interval || 'all_time'
    });
  } catch (cardError) {
    // Don't fail patient creation if card creation fails
    console.warn(`[FHIR] ⚠️  Failed to create Stripe card:`, cardError.message);
  }
}
```

#### 2. Card Creation Process

**Location:** `middleware-platform/services/fhir-service.js` → `createPatientCard()`

The process:
1. **Check for existing card** - Prevents duplicate cards
2. **Extract patient data** - Name, email, phone, address from FHIR resource
3. **Create Stripe Cardholder** - Via `StripeIssuingService.createCardholderAndCard()`
4. **Create Virtual Card** - With spending limits and controls
5. **Store in Database** - Save cardholder and card records

#### 3. Stripe Issuing Service

**Location:** `middleware-platform/services/stripe-issuing-service.js`

**Key Methods:**
- `createCardholder()` - Creates a cardholder in Stripe
- `createCard()` - Creates a card for a cardholder
- `createCardholderAndCard()` - Combined operation
- `getCardDetails()` - Retrieves PAN/CVC for virtual cards
- `updateCardSpendingControls()` - Updates spending limits
- `cancelCard()` - Cancels a card

#### 4. Database Storage

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

#### 5. API Endpoints

**Location:** `middleware-platform/server.js`

Patient card management endpoints:

- `GET /api/patient/:patientId/cards` - Get all cards for a patient
- `POST /api/patient/:patientId/cards` - Create a new card
- `GET /api/patient/cards/:cardId` - Get card details (including PAN/CVC)
- `PATCH /api/patient/cards/:cardId/spending-controls` - Update spending limits
- `POST /api/patient/cards/:cardId/cancel` - Cancel a card
- `GET /api/patient/cards/:cardId/transactions` - Get card transactions
- `GET /api/patient/:patientId/transactions` - Get all patient transactions

#### 6. Webhook Handler

**Location:** `middleware-platform/server.js` → `POST /webhooks/stripe/issuing`

Handles real-time Stripe events:
- `issuing_authorization.created` - Card authorization events
- `issuing_transaction.created` - Transaction events
- `issuing_card.created` - Card creation events
- `issuing_card.updated` - Card update events

---

## 📊 Database Schema

### Tables

#### `stripe_cardholders`

Stores Stripe cardholder information linked to patients.

**Fields:**
- `id` - Internal cardholder ID
- `patient_id` - Links to `fhir_patients.resource_id`
- `clinic_id` - Links to `clinics.clinic_id`
- `stripe_cardholder_id` - Stripe cardholder ID (starts with `ich_`)
- `type` - Cardholder type (`individual` or `company`)
- `name` - Cardholder name
- `email` - Cardholder email
- `phone` - Cardholder phone
- `billing_address` - JSON billing address
- `status` - Cardholder status (`active`, `inactive`)
- `metadata` - JSON metadata
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp

#### `stripe_cards`

Stores Stripe card information.

**Fields:**
- `id` - Internal card ID
- `patient_id` - Links to `fhir_patients.resource_id`
- `clinic_id` - Links to `clinics.clinic_id`
- `cardholder_id` - Links to `stripe_cardholders.id`
- `stripe_card_id` - Stripe card ID (starts with `ic_`)
- `type` - Card type (`virtual` or `physical`)
- `currency` - Card currency (default: `usd`)
- `status` - Card status (`active`, `inactive`, `canceled`)
- `last4` - Last 4 digits of card
- `brand` - Card brand (`visa`, `mastercard`, etc.)
- `expiry_month` - Expiry month (1-12)
- `expiry_year` - Expiry year
- `spending_controls` - JSON spending controls
- `metadata` - JSON metadata
- `created_at` - Creation timestamp
- `updated_at` - Update timestamp

#### `stripe_card_transactions`

Stores card transaction history.

**Fields:**
- `id` - Internal transaction ID
- `card_id` - Links to `stripe_cards.id`
- `patient_id` - Links to `fhir_patients.resource_id`
- `clinic_id` - Links to `clinics.clinic_id`
- `stripe_transaction_id` - Stripe transaction ID
- `amount` - Transaction amount (in cents)
- `currency` - Transaction currency
- `merchant_name` - Merchant name
- `merchant_category` - Merchant category code
- `status` - Transaction status (`pending`, `completed`, `declined`)
- `authorization_code` - Authorization code
- `metadata` - JSON metadata
- `created_at` - Transaction timestamp

### Database Functions

**Location:** `middleware-platform/database.js`

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

---

## 🎯 When Cards Are Created

Cards are automatically created when:

1. **New Patient Registration** - Via FHIR `getOrCreatePatient()`
2. **Voice Agent Registration** - When patient provides info during call
3. **Manual Creation** - Via API endpoint `POST /api/patient/:patientId/cards`

---

## 💳 Card Features

- **Virtual Cards** - Default card type
- **Spending Limits** - Configurable per card (default: $1,000)
- **Spending Controls** - Can restrict by category, merchant, etc.
- **Real-time Transactions** - Via Stripe webhooks
- **Card Details** - PAN and CVC available for virtual cards (in live mode)

---

## 🔧 Configuration

### Environment Variables

**Required:**
- `STRIPE_SECRET_KEY` - Stripe API secret key

**Optional:**
- `STRIPE_PUBLISHABLE_KEY` - Stripe publishable key (for frontend)
- `STRIPE_ISSUING_WEBHOOK_SECRET` - Webhook verification secret

### Mock Mode

If `STRIPE_SECRET_KEY` is not set, the service operates in mock mode:
- Returns mock card IDs and details
- Logs operations to console
- Allows development without Stripe account

---

## 🧪 Testing

### Test 1: Create a Patient (Card Auto-Created)

```bash
curl -X POST http://localhost:4000/api/fhir/Patient \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Patient",
    "name": [{"given": ["John"], "family": "Doe"}],
    "telecom": [
      {"system": "phone", "value": "+15555551234"},
      {"system": "email", "value": "john@example.com"}
    ],
    "address": [{
      "line": ["123 Main St"],
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    }]
  }'
```

### Test 2: Get Patient Cards

```bash
curl http://localhost:4000/api/patient/{patientId}/cards
```

**Expected Response:**
```json
{
  "success": true,
  "cards": [{
    "id": "card-...",
    "stripe_card_id": "ic_...",
    "last4": "1234",
    "brand": "visa",
    "type": "virtual",
    "status": "active"
  }],
  "count": 1
}
```

### Test 3: Get Card Details (PAN/CVC)

```bash
curl http://localhost:4000/api/patient/cards/{cardId}
```

**Expected Response:**
```json
{
  "success": true,
  "card": {
    "id": "card-...",
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

---

## 🐛 Troubleshooting

### "Stripe Issuing not configured"

**Cause**: `STRIPE_SECRET_KEY` not set in environment variables.

**Fix**:
1. Check `.env` file has `STRIPE_SECRET_KEY`
2. Restart server after adding environment variable
3. Verify key is correct (starts with `sk_test_` or `sk_live_`)

### "Issuing not enabled"

**Cause**: Stripe Issuing not enabled in Stripe Dashboard.

**Fix**:
1. Go to Stripe Dashboard → Issuing
2. Complete onboarding process
3. Wait for approval (instant in test mode)

### "Insufficient funds"

**Cause**: Issuing balance has no funds.

**Fix**:
1. Go to Stripe Dashboard → Issuing → Balance
2. Click "Add Funds"
3. Add test funds (unlimited in test mode)

### "Card creation failed"

**Cause**: Invalid patient data or Stripe API error.

**Fix**:
1. Check patient has valid address
2. Check Issuing balance has funds
3. Check Stripe Dashboard for error details
4. Review server logs for specific error

### "Webhook not receiving events"

**Cause**: Webhook not configured or secret incorrect.

**Fix**:
1. Verify webhook endpoint URL is correct
2. Check `STRIPE_ISSUING_WEBHOOK_SECRET` matches Stripe Dashboard
3. Test webhook with Stripe CLI: `stripe listen --forward-to http://localhost:4000/webhooks/stripe/issuing`

---

## 🔒 Security Best Practices

- ✅ **Never commit Stripe keys** to version control
- ✅ **Use environment variables** for all secrets
- ✅ **Verify webhook signatures** using webhook secret
- ✅ **Store card details securely** (encrypted in database)
- ✅ **Use HTTPS** for all webhook endpoints
- ✅ **Limit card spending** with spending controls
- ✅ **Monitor transactions** via webhooks

---

## 📊 Frontend Integration

**Location:** `unified-dashboard/patients/wallet.html`

**Features:**
- Displays all patient cards with brand styling
- Shows card details (masked number, expiry, spending limits)
- View full card details modal (PAN/CVC for virtual cards)
- View transaction history per card
- Cancel card functionality

---

## ✅ Setup Checklist

Before going live:

- [ ] Stripe account created
- [ ] Stripe Issuing enabled
- [ ] Issuing balance funded
- [ ] `STRIPE_SECRET_KEY` added to environment
- [ ] `STRIPE_PUBLISHABLE_KEY` added to environment (if using frontend)
- [ ] Webhook endpoint configured
- [ ] `STRIPE_ISSUING_WEBHOOK_SECRET` added to environment
- [ ] Test patient creation works
- [ ] Test card retrieval works
- [ ] Test webhook events received
- [ ] Frontend wallet page tested

---

## 🔗 Related Documentation

- **API Documentation**: `docs/api/API_DOCUMENTATION.md`
- **FHIR Service**: `docs/architecture/HEALTHCARE_ASSESSMENT.md`
- **Payment Architecture**: `docs/architecture/payments/PAYMENT_ARCHITECTURE.md`

---

**Status**: ✅ Production Ready  
**Last Updated**: January 2025

