#!/bin/bash

# Add root domain (doclittle.site) to Azure App Service
# App: doclittle
# Resource Group: doclittle

set -e

echo "🌐 ADDING ROOT DOMAIN TO AZURE APP SERVICE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Configuration
APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
ROOT_DOMAIN="doclittle.site"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install it first:"
    echo "   curl -L https://aka.ms/InstallAzureCLIMacOS -o azure-cli-installer.pkg"
    exit 1
fi

# Check if logged in
echo "🔐 Checking Azure login..."
if ! az account show &> /dev/null; then
    echo "⚠️  Not logged in. Logging in..."
    az login
fi

echo "✅ Logged in to Azure"
echo ""

# Add custom domain
echo "🌐 Adding custom domain: $ROOT_DOMAIN"
az webapp config hostname add \
    --resource-group "$RESOURCE_GROUP" \
    --webapp-name "$APP_NAME" \
    --hostname "$ROOT_DOMAIN"

echo ""
echo "✅ Domain added to Azure App Service!"
echo ""

# List all domains
echo "📋 Current custom domains:"
az webapp config hostname list \
    --resource-group "$RESOURCE_GROUP" \
    --webapp-name "$APP_NAME" \
    --query "[].{Hostname:name, Status:azureResourceName}" \
    --output table

echo ""
echo "⚠️  NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Configure DNS in IONOS:"
echo "   - Go to: https://my.ionos.com/domain-dns-settings/$ROOT_DOMAIN"
echo "   - Add A record or ALIAS: @ → doclittle.azurewebsites.net"
echo "   - OR use Azure App Service IP (check Azure Portal → App Service → Properties)"
echo ""
echo "2. Create SSL certificate:"
echo "   az webapp config ssl create \\"
echo "     --resource-group $RESOURCE_GROUP \\"
echo "     --name $APP_NAME \\"
echo "     --hostname $ROOT_DOMAIN"
echo ""
echo "3. Bind SSL certificate (after DNS propagates):"
echo "   az webapp config ssl bind \\"
echo "     --resource-group $RESOURCE_GROUP \\"
echo "     --name $APP_NAME \\"
echo "     --certificate-thumbprint <THUMBPRINT> \\"
echo "     --ssl-type SNI \\"
echo "     --hostname $ROOT_DOMAIN"
echo ""
echo "4. Wait for DNS propagation (5-30 minutes)"
echo ""
echo "5. Test:"
echo "   curl https://$ROOT_DOMAIN"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

