#!/bin/bash

# Azure App Service Deployment Script
# App: doclittle
# Resource Group: doclittle
# Location: westus2 (eastus has no quota)
# URL: doclittle.azurewebsites.net

set -e

echo "🚀 DEPLOYING TO AZURE APP SERVICE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Configuration
APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
APP_SERVICE_URL="doclittle.azurewebsites.net"
DEPLOYMENT_DIR="middleware-platform"

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

# Navigate to project root
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📦 Preparing deployment package..."
echo ""

# Create deployment package (include middleware-platform + unified-dashboard)
echo "📦 Creating deployment ZIP (without node_modules - Azure will install)..."
echo "   - Including middleware-platform/"
echo "   - Including unified-dashboard/"

# Create a temp directory for deployment
TEMP_DIR=$(mktemp -d)

# Copy middleware-platform files to ROOT (Azure expects package.json in root)
cp -r "$PROJECT_ROOT/middleware-platform"/* "$TEMP_DIR/"
# Remove node_modules and other excluded files
find "$TEMP_DIR" -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find "$TEMP_DIR" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true
find "$TEMP_DIR" -name "*.env*" -delete 2>/dev/null || true
find "$TEMP_DIR" -name "*.log" -delete 2>/dev/null || true
find "$TEMP_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# Copy unified-dashboard to root (as server.js expects it at ../unified-dashboard)
# But since we're in root, we'll copy it as is and adjust server.js path in deployment
cp -r "$PROJECT_ROOT/unified-dashboard" "$TEMP_DIR/"

# Create ZIP from temp directory
DEPLOY_ZIP="$PROJECT_ROOT/deploy.zip"
cd "$TEMP_DIR"
zip -r "$DEPLOY_ZIP" . \
    -x "*.git*" \
    -x "node_modules/*" \
    -x "*node_modules*" \
    -x "*.env*" \
    -x "*test*" \
    -x "*.md" \
    -x "*.log" \
    -x ".DS_Store" \
    -x "middleware.db-journal" \
    -x "*.test.js" \
    -x "tests/*" \
    -x "package-lock.json" > /dev/null

# Clean up temp directory
cd "$PROJECT_ROOT"
rm -rf "$TEMP_DIR"

echo "✅ Deployment package created: $DEPLOY_ZIP"
echo ""

# Deploy to Azure
echo "🚀 Deploying to Azure App Service..."
az webapp deploy \
    --resource-group "$RESOURCE_GROUP" \
    --name "$APP_NAME" \
    --src-path "$DEPLOY_ZIP" \
    --type zip

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📍 Your app is available at:"
echo "   https://$APP_SERVICE_URL"
echo ""
echo "🔍 Check logs:"
echo "   az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "🧹 Cleaning up..."
rm -f "$DEPLOY_ZIP"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

