#!/bin/bash

# Comprehensive Test Runner
# Tests frontend, backend, voice agent, and database

echo "🧪 DocLittle Comprehensive Test Suite"
echo "======================================"
echo ""

# Check if server is running
echo "📡 Checking if server is running..."
if curl -s http://localhost:4000/health > /dev/null 2>&1; then
    echo "✅ Server is running"
else
    echo "⚠️  Server is not running on port 4000"
    echo "   Start server with: cd middleware-platform && npm start"
    echo ""
    read -p "Continue with tests anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "🔧 Running tests..."
echo ""

# Run Node.js test suite
if command -v node &> /dev/null; then
    node tests/test-all.js
else
    echo "❌ Node.js not found. Cannot run comprehensive tests."
    echo "   Install Node.js or use: nvm use"
    exit 1
fi

echo ""
echo "✅ Test suite completed!"
echo ""

