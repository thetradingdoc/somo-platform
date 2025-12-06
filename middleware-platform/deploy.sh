#!/bin/bash

# Azure deployment script - runs after files are deployed
echo "📦 Installing dependencies..."
npm install --production --no-audit --no-fund
echo "✅ Dependencies installed"

