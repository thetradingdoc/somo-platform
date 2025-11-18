#!/bin/bash

# Configure Azure App Service Environment Variables
# App: doclittle
# Resource Group: doclittle

set -e

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"

echo "⚙️  CONFIGURING AZURE APP SERVICE ENVIRONMENT VARIABLES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install it first."
    exit 1
fi

# Check if logged in
if ! az account show &> /dev/null; then
    echo "⚠️  Not logged in. Logging in..."
    az login
fi

echo "📝 Setting environment variables..."
echo ""

# Required environment variables
az webapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --settings \
        NODE_ENV=production \
        PORT=4000 \
        API_BASE_URL=https://api.doclittle.site \
        BASE_URL=https://api.doclittle.site

echo "✅ Basic configuration set"
echo ""
echo "⚠️  IMPORTANT: You need to set these secrets manually in Azure Portal:"
echo ""
echo "   Go to: Azure Portal → $APP_NAME → Configuration → Application settings"
echo ""
echo "   Add these settings (from your local .env file):"
echo ""
echo "   Required Secrets:"
echo "   - STRIPE_SECRET_KEY"
echo "   - TWILIO_ACCOUNT_SID"
echo "   - TWILIO_AUTH_TOKEN"
echo "   - TWILIO_PHONE_NUMBER"
echo "   - RETELL_API_KEY"
echo "   - RETELL_AGENT_ID"
echo "   - AZURE_COMMUNICATION_CONNECTION_STRING"
echo "   - AZURE_EMAIL_SENDER"
echo "   - ADMIN_PORTAL_SECRET (generate with: openssl rand -hex 32)"
echo ""
echo "   Optional (if using):"
echo "   - GOOGLE_CLIENT_ID"
echo "   - GOOGLE_CLIENT_SECRET"
echo "   - CIRCLE_API_KEY"
echo "   - CIRCLE_WALLET_SET_ID"
echo "   - MERCHANT_ID"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

