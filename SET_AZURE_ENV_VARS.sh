#!/bin/bash

# Script to set CRITICAL environment variables in Azure
# These are REQUIRED for the server to start in production

set -e

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"

echo "🔐 SETTING CRITICAL ENVIRONMENT VARIABLES IN AZURE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  These variables are REQUIRED - server will NOT start without them!"
echo ""

# Check Azure login
if ! az account show &> /dev/null; then
    echo "❌ Not logged in to Azure. Please run: az login"
    exit 1
fi

echo "📝 You will be prompted to enter the following secrets:"
echo "   1. ADMIN_PORTAL_SECRET - Secret for admin portal authentication"
echo "   2. API_KEY_ENCRYPTION_KEY - 32-byte hex string (64 hex characters)"
echo "   3. RETELL_WEBHOOK_SECRET - Secret for verifying Retell webhooks"
echo ""

# Prompt for secrets
read -sp "Enter ADMIN_PORTAL_SECRET: " ADMIN_SECRET
echo ""
read -sp "Enter API_KEY_ENCRYPTION_KEY (64 hex characters): " ENCRYPTION_KEY
echo ""
read -sp "Enter RETELL_WEBHOOK_SECRET: " WEBHOOK_SECRET
echo ""

# Validate encryption key length (should be 64 hex chars = 32 bytes)
if [ ${#ENCRYPTION_KEY} -ne 64 ]; then
    echo "⚠️  WARNING: API_KEY_ENCRYPTION_KEY should be 64 hex characters (32 bytes)"
    read -p "Continue anyway? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "❌ Aborted"
        exit 1
    fi
fi

echo ""
echo "🚀 Setting environment variables in Azure..."

az webapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --settings \
        ADMIN_PORTAL_SECRET="$ADMIN_SECRET" \
        API_KEY_ENCRYPTION_KEY="$ENCRYPTION_KEY" \
        RETELL_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
    --output none

echo ""
echo "✅ Environment variables set successfully!"
echo ""
echo "📋 Verify settings:"
echo "   az webapp config appsettings list --name $APP_NAME --resource-group $RESOURCE_GROUP --query \"[?name=='ADMIN_PORTAL_SECRET' || name=='API_KEY_ENCRYPTION_KEY' || name=='RETELL_WEBHOOK_SECRET'].{name:name, set:'✓'}\" -o table"
echo ""
echo "🔄 The app will restart automatically. Check logs:"
echo "   az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""

