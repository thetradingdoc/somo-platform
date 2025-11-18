# Stripe Issuing Setup Guide

## Your Stripe Keys

✅ **Publishable Key (Frontend):**
```
pk_test_... (get from Stripe Dashboard)
```

✅ **Secret Key (Backend):**
```
sk_test_... (get from Stripe Dashboard)
```

**⚠️ Note:** Add your Stripe keys from the Stripe Dashboard to your `.env` file. Never commit keys to version control.

## Step 1: Add Keys to Environment Variables

Add these to your `.env` file:

```bash
# Stripe Keys (replace with your actual keys from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Or export them:
```bash
export STRIPE_SECRET_KEY=sk_test_...
export STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Step 2: Enable Stripe Issuing in Dashboard

1. **Go to Stripe Dashboard:**
   - https://dashboard.stripe.com/test/issuing

2. **Complete Onboarding:**
   - Click "Get Started" or "Enable Issuing"
   - Fill out business information
   - Accept terms and conditions
   - Wait for approval (usually instant for test mode)

3. **Verify Issuing is Enabled:**
   - You should see "Issuing" in the left sidebar
   - You should be able to access "Cardholders" and "Cards" sections

## Step 3: Fund Your Issuing Balance (Test Mode)

1. **Go to Issuing Balance:**
   - https://dashboard.stripe.com/test/issuing/balance

2. **Add Test Funds:**
   - Click "Add Funds" or "Top Up"
   - Enter amount (e.g., $1,000 for testing)
   - Use test card: `4242 4242 4242 4242`
   - Cards can only spend up to available balance

**Note:** In test mode, you can add unlimited test funds. In live mode, you'll need real money.

## Step 4: Set Up Webhook (Optional but Recommended)

### For Local Development:

1. **Install Stripe CLI:**
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   
   # Or download from: https://stripe.com/docs/stripe-cli
   ```

2. **Login to Stripe:**
   ```bash
   stripe login
   ```

3. **Forward Webhooks to Local Server:**
   ```bash
   stripe listen --forward-to http://localhost:4000/webhooks/stripe/issuing
   ```

4. **Copy Webhook Secret:**
   - The CLI will output a webhook secret like: `whsec_...`
   - Add to `.env`:
     ```bash
     STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...
     ```

### For Production:

1. **Go to Stripe Dashboard → Webhooks:**
   - https://dashboard.stripe.com/test/webhooks

2. **Add Endpoint:**
   - URL: `https://your-domain.com/webhooks/stripe/issuing`
   - Select events:
     - `issuing_authorization.created`
     - `issuing_authorization.request`
     - `issuing_transaction.created`
     - `issuing_card.created`
     - `issuing_card.updated`

3. **Copy Webhook Secret:**
   - Click on the webhook endpoint
   - Copy "Signing secret" (starts with `whsec_`)
   - Add to `.env`:
     ```bash
     STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...
     ```

## Step 5: Test It!

### Test 1: Create a Patient (Card Auto-Created)

```bash
# Create a patient via API
curl -X POST http://localhost:4000/api/fhir/Patient \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Patient",
    "name": [{
      "given": ["John"],
      "family": "Doe"
    }],
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

### Test 2: Get Patient Cards

```bash
# Get patient ID from previous response, then:
curl http://localhost:4000/api/patient/{patientId}/cards
```

**Expected Response:**
```json
{
  "success": true,
  "cards": [
    {
      "id": "card-...",
      "stripe_card_id": "ic_...",
      "last4": "1234",
      "brand": "visa",
      "type": "virtual",
      "status": "active"
    }
  ],
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

## What You Have Now

✅ **Stripe Keys** - Ready to use
✅ **Environment Variables** - Need to add to `.env`
✅ **Stripe Issuing** - Need to enable in dashboard
✅ **Issuing Balance** - Need to fund (test mode)
✅ **Webhook** - Optional but recommended

## Quick Checklist

- [ ] Add `STRIPE_SECRET_KEY` to `.env`
- [ ] Add `STRIPE_PUBLISHABLE_KEY` to `.env`
- [ ] Enable Stripe Issuing in dashboard
- [ ] Fund Issuing balance (test mode)
- [ ] Set up webhook (optional)
- [ ] Restart server
- [ ] Test by creating a patient

## Troubleshooting

### "Stripe Issuing not configured"
- Check `STRIPE_SECRET_KEY` is set in `.env`
- Restart server after adding environment variable

### "Issuing not enabled"
- Go to Stripe Dashboard → Issuing
- Complete onboarding process
- Wait for approval

### "Insufficient funds"
- Go to Stripe Dashboard → Issuing → Balance
- Add test funds

### "Card creation failed"
- Check patient has valid address
- Check Issuing balance has funds
- Check Stripe Dashboard for error details

## Next Steps

1. **Add keys to `.env` file**
2. **Enable Stripe Issuing in dashboard**
3. **Fund test balance**
4. **Restart server**
5. **Test by creating a patient**

Once these are done, cards will be automatically created for every new patient! 🎉




