#!/bin/bash
# Start ngrok tunnel for HTTPS access (required for Safari iOS camera/mic)

echo "🚀 Starting ngrok tunnel for HTTPS access..."
echo "   This enables camera/mic on Safari iOS (requires HTTPS)"
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed."
    echo "   Install it: brew install ngrok/ngrok/ngrok"
    echo "   Or download from: https://ngrok.com/download"
    exit 1
fi

# Kill any existing ngrok processes on port 4000
pkill -f "ngrok.*4000" 2>/dev/null

# Start ngrok tunnel
echo "📡 Starting tunnel: http://localhost:4000 → https://..."
ngrok http 4000 --log=stdout
