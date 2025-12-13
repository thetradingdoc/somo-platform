#!/bin/bash
# Add Tenant Subdomain to Azure App Service
# Usage: ./scripts/add-tenant-subdomain.sh <subdomain>
# Example: ./scripts/add-tenant-subdomain.sh doctor-little

set -e

if [ -z "$1" ]; then
    echo "❌ Error: Subdomain required"
    echo "Usage: ./scripts/add-tenant-subdomain.sh <subdomain>"
    echo "Example: ./scripts/add-tenant-subdomain.sh doctor-little"
    exit 1
fi

SUBDOMAIN=$1
FULL_DOMAIN="${SUBDOMAIN}.doclittle.site"
APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
AZURE_URL="doclittle.azurewebsites.net"

echo "🌐 ADDING TENANT SUBDOMAIN: $FULL_DOMAIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if logged into Azure
if ! az account show &>/dev/null; then
    echo "❌ Not logged into Azure. Please run: az login"
    exit 1
fi

echo "✅ Logged in to Azure"
echo ""

# Check if domain already exists
echo "🔍 Checking if domain already exists..."
EXISTING=$(az webapp config hostname list \
    --webapp-name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "[?name=='$FULL_DOMAIN'].name" \
    --output tsv)

if [ -n "$EXISTING" ]; then
    echo "✅ Domain $FULL_DOMAIN is already configured in Azure"
    echo ""
    echo "📋 Current configuration:"
    az webapp config hostname list \
        --webapp-name $APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --query "[?name=='$FULL_DOMAIN']" \
        --output table
    echo ""
else
    echo "📝 Adding custom domain to Azure..."
    az webapp config hostname add \
        --webapp-name $APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --hostname $FULL_DOMAIN
    
    echo "✅ Domain added to Azure App Service!"
    echo ""
fi

# Get verification TXT value (if available)
echo "🔍 Getting domain verification information..."
VERIFICATION_TXT=$(az webapp config hostname get-external-ip \
    --webapp-name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --output tsv 2>/dev/null || echo "")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEPS - Configure DNS in IONOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Go to: https://my.ionos.com/domain-dns-settings/doclittle.site"
echo ""
echo "2. Add CNAME Record:"
echo "   ─────────────────────────────────────────────"
echo "   Type: CNAME"
echo "   Name/Host: $SUBDOMAIN"
echo "   Value/Points to: $AZURE_URL"
echo "   TTL: 3600"
echo ""
echo "3. (Optional) Add TXT Record for verification:"
echo "   ─────────────────────────────────────────────"
echo "   Type: TXT"
echo "   Name/Host: asuid.$SUBDOMAIN"
echo "   Value: (Get from Azure Portal → Custom domains → $FULL_DOMAIN)"
echo "   TTL: 3600"
echo ""
echo "4. Wait 5-30 minutes for DNS propagation"
echo ""
echo "5. Azure will automatically verify DNS and provision SSL certificate"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔒 SSL Certificate Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "After DNS propagates, create SSL certificate:"
echo ""
echo "az webapp config ssl create \\"
echo "  --resource-group $RESOURCE_GROUP \\"
echo "  --name $APP_NAME \\"
echo "  --hostname $FULL_DOMAIN"
echo ""
echo "Get certificate thumbprint:"
echo ""
echo "az webapp config ssl show \\"
echo "  --resource-group $RESOURCE_GROUP \\"
echo "  --certificate-name $FULL_DOMAIN \\"
echo "  --query thumbprint \\"
echo "  --output tsv"
echo ""
echo "Bind certificate:"
echo ""
echo "az webapp config ssl bind \\"
echo "  --resource-group $RESOURCE_GROUP \\"
echo "  --name $APP_NAME \\"
echo "  --certificate-thumbprint <THUMBPRINT> \\"
echo "  --ssl-type SNI \\"
echo "  --hostname $FULL_DOMAIN"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Test DNS:"
echo "  dig $FULL_DOMAIN CNAME"
echo ""
echo "Test HTTPS:"
echo "  curl -I https://$FULL_DOMAIN"
echo ""
echo "Visit in browser:"
echo "  https://$FULL_DOMAIN"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""


