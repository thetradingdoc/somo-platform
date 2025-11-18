#!/bin/bash

# Configure Azure App Service Environment Variables from local .env file
# App: doclittle
# Resource Group: doclittle

set -e

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
ENV_FILE="middleware-platform/.env"

echo "⚙️  CONFIGURING AZURE APP SERVICE FROM LOCAL .ENV"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: $ENV_FILE not found"
    exit 1
fi

# Check if Azure CLI is logged in
if ! az account show &> /dev/null; then
    echo "⚠️  Not logged in to Azure. Logging in..."
    az login
fi

echo "📝 Reading environment variables from $ENV_FILE..."
echo ""

# Parse .env file safely (handle URLs and special characters)
while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ "$key" =~ ^#.*$ ]] && continue
    [[ -z "$key" ]] && continue
    
    # Remove leading/trailing whitespace
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    # Remove quotes if present
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    
    # Export variable
    export "$key=$value"
done < "$ENV_FILE"

# Build the settings string
SETTINGS="NODE_ENV=production"
SETTINGS="$SETTINGS PORT=${PORT:-4000}"
SETTINGS="$SETTINGS API_BASE_URL=https://api.doclittle.site"

# Add required secrets if they exist
if [ ! -z "$STRIPE_SECRET_KEY" ]; then
    SETTINGS="$SETTINGS STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY"
fi

if [ ! -z "$TWILIO_ACCOUNT_SID" ]; then
    SETTINGS="$SETTINGS TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID"
fi

if [ ! -z "$TWILIO_AUTH_TOKEN" ]; then
    SETTINGS="$SETTINGS TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN"
fi

if [ ! -z "$TWILIO_PHONE_NUMBER" ]; then
    SETTINGS="$SETTINGS TWILIO_PHONE_NUMBER=$TWILIO_PHONE_NUMBER"
fi

if [ ! -z "$RETELL_API_KEY" ]; then
    SETTINGS="$SETTINGS RETELL_API_KEY=$RETELL_API_KEY"
fi

if [ ! -z "$RETELL_AGENT_ID" ]; then
    SETTINGS="$SETTINGS RETELL_AGENT_ID=$RETELL_AGENT_ID"
fi

if [ ! -z "$AZURE_COMMUNICATION_CONNECTION_STRING" ]; then
    SETTINGS="$SETTINGS AZURE_COMMUNICATION_CONNECTION_STRING=$AZURE_COMMUNICATION_CONNECTION_STRING"
fi

if [ ! -z "$AZURE_EMAIL_SENDER" ]; then
    SETTINGS="$SETTINGS AZURE_EMAIL_SENDER=$AZURE_EMAIL_SENDER"
fi

# Optional: Google Calendar
if [ ! -z "$GOOGLE_CLIENT_ID" ]; then
    SETTINGS="$SETTINGS GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
fi

if [ ! -z "$GOOGLE_CLIENT_SECRET" ]; then
    SETTINGS="$SETTINGS GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
fi

# Optional: Circle
if [ ! -z "$CIRCLE_API_KEY" ]; then
    SETTINGS="$SETTINGS CIRCLE_API_KEY=$CIRCLE_API_KEY"
fi

if [ ! -z "$CIRCLE_WALLET_SET_ID" ]; then
    SETTINGS="$SETTINGS CIRCLE_WALLET_SET_ID=$CIRCLE_WALLET_SET_ID"
fi

# Optional: Merchant ID
if [ ! -z "$MERCHANT_ID" ]; then
    SETTINGS="$SETTINGS MERCHANT_ID=$MERCHANT_ID"
fi

echo "🚀 Setting environment variables in Azure App Service..."
echo ""

# Set all settings at once
az webapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --settings $SETTINGS

echo ""
echo "✅ Environment variables configured successfully!"
echo ""
echo "📋 Verify settings:"
echo "   az webapp config appsettings list --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""

