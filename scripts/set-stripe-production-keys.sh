#!/bin/bash

# Script to set Stripe Production Keys in Azure App Service
# Usage: bash scripts/set-stripe-production-keys.sh

set -e

echo "🔐 Setting Stripe Production Keys for api.doclittle.site"
echo "════════════════════════════════════════════════════════"
echo ""

# Production keys - SET THESE MANUALLY or source from secure storage
# ⚠️ DO NOT commit actual keys to git!
# Get keys from: docs/SECRETS_BACKUP.md (gitignored) or Azure Key Vault
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"

# Check if keys are provided
if [ -z "$STRIPE_SECRET_KEY" ] || [ -z "$STRIPE_PUBLISHABLE_KEY" ]; then
  echo "❌ ERROR: Stripe keys not provided"
  echo ""
  echo "Usage:"
  echo "  export STRIPE_SECRET_KEY='sk_live_...'"
  echo "  export STRIPE_PUBLISHABLE_KEY='pk_live_...'"
  echo "  bash scripts/set-stripe-production-keys.sh"
  echo ""
  echo "Or set them in the script directly (then remove before committing)"
  exit 1
fi

# Verify keys are production keys
if [[ ! "$STRIPE_SECRET_KEY" =~ ^sk_live_ ]]; then
  echo "❌ ERROR: Secret key does not start with sk_live_"
  echo "   This must be a production key, not a test key!"
  exit 1
fi

if [[ ! "$STRIPE_PUBLISHABLE_KEY" =~ ^pk_live_ ]]; then
  echo "❌ ERROR: Publishable key does not start with pk_live_"
  echo "   This must be a production key, not a test key!"
  exit 1
fi

echo "✅ Production keys validated"
echo "   Secret Key: ${STRIPE_SECRET_KEY:0:20}..."
echo "   Publishable Key: ${STRIPE_PUBLISHABLE_KEY:0:20}..."
echo ""

# Confirm before proceeding
read -p "⚠️  This will set PRODUCTION Stripe keys in Azure. Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "❌ Cancelled"
  exit 1
fi

echo ""
echo "📤 Setting Stripe keys in Azure App Service..."
echo ""

# Set Stripe keys
az webapp config appsettings set \
  --name doclittle \
  --resource-group doclittle \
  --settings \
    STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
    STRIPE_PUBLISHABLE_KEY="$STRIPE_PUBLISHABLE_KEY" \
    NODE_ENV="production" \
  --output none

echo ""
echo "✅ Stripe production keys set successfully!"
echo ""
echo "🔍 Verifying configuration..."
echo ""

# Verify the keys were set
az webapp config appsettings list \
  --name doclittle \
  --resource-group doclittle \
  --query "[?name=='STRIPE_SECRET_KEY' || name=='STRIPE_PUBLISHABLE_KEY' || name=='NODE_ENV'].{name:name, value:value}" \
  --output table

echo ""
echo "✅ Configuration complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Wait 30-60 seconds for Azure to apply changes"
echo "   2. Test the payment flow on https://api.doclittle.site"
echo "   3. Monitor Stripe dashboard for test transactions"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - These are LIVE production keys - real money will be processed"
echo "   - Monitor Stripe dashboard regularly"
echo "   - Test with real cards carefully"
echo ""

