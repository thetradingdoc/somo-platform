#!/bin/bash

# Azure App Service Startup Script
# Ensures dependencies are installed before starting the server

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

