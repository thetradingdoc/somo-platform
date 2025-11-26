#!/bin/bash
# Azure App Service Startup Script
# Ensures reliable startup and monitoring

set -e

echo "🚀 Starting DocLittle API..."
echo "Timestamp: $(date)"
echo "Node version: $(node --version)"
echo "NODE_ENV: ${NODE_ENV:-production}"

# Create logs directory
mkdir -p logs

# Enable garbage collection if available
export NODE_OPTIONS="--max-old-space-size=1024 ${NODE_OPTIONS}"

# Start the application
# Azure will automatically restart on failure
node server.js


