#!/bin/bash
# Fix SSL for doctor-little.doclittle.site
# DNS is already working (wildcard CNAME), just need Azure custom domain + SSL

set -e

SUBDOMAIN="doctor-little"
FULL_DOMAIN="${SUBDOMAIN}.doclittle.site"
APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"

echo "🔧 FIXING SSL FOR: $FULL_DOMAIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ DNS is already working (wildcard CNAME confirmed)"
echo "📋 Next: Add Azure custom domain + SSL certificate"
echo ""

# Check if logged into Azure
if ! az account show &>/dev/null; then
    echo "❌ Not logged into Azure. Please run: az login"
    exit 1
fi

echo "✅ Logged in to Azure"
echo ""

# Step 1: Check if custom domain exists
echo "🔍 Step 1: Checking if custom domain exists in Azure..."
EXISTING=$(az webapp config hostname list \
    --webapp-name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "[?name=='$FULL_DOMAIN'].name" \
    --output tsv)

if [ -n "$EXISTING" ]; then
    echo "✅ Custom domain already exists in Azure"
else
    echo "📝 Adding custom domain to Azure..."
    az webapp config hostname add \
        --webapp-name $APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --hostname $FULL_DOMAIN
    
    echo "✅ Custom domain added!"
    echo "⏳ Wait 2-3 minutes for Azure to verify DNS..."
    sleep 120
fi

echo ""

# Step 2: Check if SSL certificate exists
echo "🔍 Step 2: Checking SSL certificate..."
CERT_EXISTS=$(az webapp config ssl list \
    --resource-group $RESOURCE_GROUP \
    --query "[?name=='$FULL_DOMAIN'].name" \
    --output tsv 2>/dev/null || echo "")

if [ -n "$CERT_EXISTS" ]; then
    echo "✅ SSL certificate already exists"
else
    echo "📝 Creating SSL certificate..."
    az webapp config ssl create \
        --resource-group $RESOURCE_GROUP \
        --name $APP_NAME \
        --hostname $FULL_DOMAIN
    
    echo "✅ SSL certificate created!"
    echo "⏳ Wait 2-3 minutes for certificate to be issued..."
    sleep 120
fi

echo ""

# Step 3: Get certificate thumbprint and bind
echo "🔍 Step 3: Binding SSL certificate..."
THUMBPRINT=$(az webapp config ssl show \
    --resource-group $RESOURCE_GROUP \
    --certificate-name $FULL_DOMAIN \
    --query thumbprint \
    --output tsv 2>/dev/null || echo "")

if [ -z "$THUMBPRINT" ]; then
    echo "⚠️  Certificate thumbprint not found. Certificate may still be provisioning."
    echo "   Wait a few more minutes and run this script again."
    exit 1
fi

echo "📋 Certificate thumbprint: $THUMBPRINT"

# Check if already bound
BOUND=$(az webapp config ssl list \
    --resource-group $RESOURCE_GROUP \
    --query "[?name=='$FULL_DOMAIN' && sslState=='SniEnabled'].name" \
    --output tsv 2>/dev/null || echo "")

if [ -n "$BOUND" ]; then
    echo "✅ SSL certificate already bound"
else
    echo "📝 Binding SSL certificate..."
    az webapp config ssl bind \
        --resource-group $RESOURCE_GROUP \
        --name $APP_NAME \
        --certificate-thumbprint $THUMBPRINT \
        --ssl-type SNI \
        --hostname $FULL_DOMAIN
    
    echo "✅ SSL certificate bound!"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ SETUP COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔍 Verification:"
echo "  curl -I https://$FULL_DOMAIN"
echo ""
echo "🌐 Test in browser:"
echo "  https://$FULL_DOMAIN"
echo ""
echo "⏳ Note: It may take 5-10 minutes for SSL to fully propagate"
echo ""


