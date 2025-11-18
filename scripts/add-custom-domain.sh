#!/bin/bash
# Add Custom Domain to Azure App Service
# This script adds api.doclittle.site to your Azure App Service

set -e

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
DOMAIN="api.doclittle.site"

echo "🌐 Adding Custom Domain: $DOMAIN"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

# Check if logged into Azure
if ! az account show &>/dev/null; then
    echo "❌ Not logged into Azure. Please run: az login"
    exit 1
fi

# Get default hostname
DEFAULT_HOSTNAME=$(az webapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --query defaultHostName --output tsv)
echo "📋 App Service: $APP_NAME"
echo "   Default URL: https://$DEFAULT_HOSTNAME"
echo "   Custom Domain: $DOMAIN"
echo ""

# Check if domain already exists
EXISTING=$(az webapp config hostname list --webapp-name $APP_NAME --resource-group $RESOURCE_GROUP --query "[?name=='$DOMAIN'].name" --output tsv)

if [ -n "$EXISTING" ]; then
    echo "✅ Domain $DOMAIN is already configured"
    exit 0
fi

echo "📝 Adding custom domain..."
echo ""

# Add the custom domain
az webapp config hostname add \
    --webapp-name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --hostname $DOMAIN

echo ""
echo "✅ Custom domain added successfully!"
echo ""
echo "📋 Next Steps:"
echo "   1. Configure DNS in IONOS:"
echo "      - Add CNAME: api → $DEFAULT_HOSTNAME"
echo "      - Add TXT: asuid.api → (get value from Azure Portal)"
echo ""
echo "   2. Azure will verify DNS automatically"
echo ""
echo "   3. SSL certificate will be provisioned automatically"
echo ""
echo "   4. Wait 5-30 minutes for DNS propagation"
echo ""
echo "   5. Test: curl https://$DOMAIN/health"
echo ""
echo "💡 To get verification TXT value:"
echo "   Go to Azure Portal → $APP_NAME → Custom domains → $DOMAIN"
echo ""

