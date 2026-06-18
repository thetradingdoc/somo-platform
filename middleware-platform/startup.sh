#!/bin/bash

# Azure App Service startup ONLY — do not use for local development.
# Local dev: repo root `./run` → scripts/dev/run.sh

echo "🚀 Starting Azure App Service..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Navigate to app directory
cd /home/site/wwwroot

# Always install dependencies on startup (Azure doesn't run build for ZIP deployments)
echo "📦 Installing dependencies..."
npm install --production --no-audit --no-fund
echo "✅ Dependencies installed"

# Start the server
echo "🚀 Starting server..."
exec node server.js

