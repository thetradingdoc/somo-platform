#!/bin/bash
# Setup Custom Domain: api.doclittle.site
# This script helps configure the custom domain in Azure and provides DNS instructions

set -e

echo "🌐 Setting up api.doclittle.site on Azure"
echo "══════════════════════════════════════════════════════════════════════"
echo ""

# Check if logged into Azure
if ! az account show &>/dev/null; then
    echo "❌ Not logged into Azure. Please run: az login"
    exit 1
fi

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
DOMAIN="api.doclittle.site"
AZURE_URL="doclittle.azurewebsites.net"

echo "📋 Configuration:"
echo "   App Service: $APP_NAME"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Custom Domain: $DOMAIN"
echo "   Azure URL: $AZURE_URL"
echo ""

# Get current hostnames
echo "📡 Checking current hostnames..."
CURRENT_HOSTNAMES=$(az webapp config hostname list --webapp-name $APP_NAME --resource-group $RESOURCE_GROUP --output json)

# Check if domain already exists
if echo "$CURRENT_HOSTNAMES" | grep -q "$DOMAIN"; then
    echo "✅ Domain $DOMAIN is already configured"
else
    echo "⚠️  Domain $DOMAIN is not yet configured"
    echo ""
    echo "📝 To add the custom domain, you need to:"
    echo ""
    echo "STEP 1: Configure DNS in IONOS"
    echo "────────────────────────────────────────────────────────────────────"
    echo "1. Log in to IONOS: https://www.ionos.com"
    echo "2. Go to: Domains → doclittle.site → DNS Settings"
    echo "3. Add these DNS records:"
    echo ""
    echo "   Record 1: TXT (for domain verification)"
    echo "   ────────────────────────────────────────"
    echo "   Type: TXT"
    echo "   Name/Host: asuid.api"
    echo "   Value: (Get from Azure Portal - see below)"
    echo "   TTL: 3600"
    echo ""
    echo "   Record 2: CNAME (points to Azure)"
    echo "   ────────────────────────────────────────"
    echo "   Type: CNAME"
    echo "   Name/Host: api"
    echo "   Value/Points to: $AZURE_URL"
    echo "   TTL: 3600"
    echo ""
    echo "STEP 2: Add Domain in Azure Portal"
    echo "────────────────────────────────────────────────────────────────────"
    echo "1. Go to: https://portal.azure.com"
    echo "2. Navigate to: Resource Groups → $RESOURCE_GROUP → $APP_NAME"
    echo "3. Click: Custom domains (left menu)"
    echo "4. Click: + Add custom domain"
    echo "5. Enter: $DOMAIN"
    echo "6. Azure will verify DNS automatically"
    echo "7. Once verified, SSL certificate will be provisioned automatically"
    echo ""
    echo "OR use Azure CLI:"
    echo "────────────────────────────────────────────────────────────────────"
    echo "az webapp config hostname add \\"
    echo "  --webapp-name $APP_NAME \\"
    echo "  --resource-group $RESOURCE_GROUP \\"
    echo "  --hostname $DOMAIN"
    echo ""
fi

# Get verification ID (if available)
echo "🔍 Getting domain verification information..."
VERIFICATION_ID=$(az webapp config hostname get-external-ip \
    --webapp-name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --output tsv 2>/dev/null || echo "")

if [ -n "$VERIFICATION_ID" ]; then
    echo "✅ Azure App Service IP: $VERIFICATION_ID"
    echo ""
    echo "💡 For A record (if needed):"
    echo "   Type: A"
    echo "   Name: api"
    echo "   Value: $VERIFICATION_ID"
fi

# Check SSL binding
echo ""
echo "🔒 Checking SSL certificate status..."
SSL_BINDINGS=$(az webapp config ssl list --resource-group $RESOURCE_GROUP --output json 2>/dev/null || echo "[]")

if echo "$SSL_BINDINGS" | grep -q "$DOMAIN"; then
    echo "✅ SSL certificate is configured for $DOMAIN"
else
    echo "⚠️  SSL certificate not yet configured"
    echo "   Azure will automatically provision SSL once domain is verified"
fi

# Verify DNS
echo ""
echo "🔍 Verifying DNS configuration..."
DNS_RESULT=$(dig +short $DOMAIN CNAME 2>/dev/null || echo "")
if [ -n "$DNS_RESULT" ]; then
    echo "✅ DNS CNAME found: $DNS_RESULT"
    if echo "$DNS_RESULT" | grep -q "$AZURE_URL"; then
        echo "   ✅ CNAME points to correct Azure URL"
    else
        echo "   ⚠️  CNAME does not point to $AZURE_URL"
        echo "   Current: $DNS_RESULT"
        echo "   Expected: $AZURE_URL"
    fi
else
    echo "⚠️  DNS CNAME not found yet"
    echo "   DNS may still be propagating (wait 5-30 minutes)"
fi

# Summary
echo ""
echo "📊 SUMMARY"
echo "══════════════════════════════════════════════════════════════════════"
echo "✅ Azure App Service: $APP_NAME (Running)"
echo "✅ Resource Group: $RESOURCE_GROUP"
if echo "$CURRENT_HOSTNAMES" | grep -q "$DOMAIN"; then
    echo "✅ Custom Domain: $DOMAIN (Configured)"
else
    echo "⚠️  Custom Domain: $DOMAIN (Not configured - follow steps above)"
fi

echo ""
echo "🌐 Test URLs:"
echo "   Default: https://$AZURE_URL"
if echo "$CURRENT_HOSTNAMES" | grep -q "$DOMAIN"; then
    echo "   Custom:  https://$DOMAIN"
else
    echo "   Custom:  https://$DOMAIN (not yet configured)"
fi

echo ""
echo "💡 Next Steps:"
echo "   1. Configure DNS in IONOS (see instructions above)"
echo "   2. Add custom domain in Azure Portal"
echo "   3. Wait for DNS propagation (5-30 minutes)"
echo "   4. Test: curl https://$DOMAIN/health"
echo "   5. Update API_BASE_URL environment variable to: https://$DOMAIN"
echo ""

