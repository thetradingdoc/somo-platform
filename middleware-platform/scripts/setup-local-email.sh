#!/bin/bash

# Quick setup script for local email configuration
# Usage: ./setup-local-email.sh

echo "📧 LOCAL EMAIL SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env exists
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Creating .env file..."
    touch "$ENV_FILE"
fi

echo "Choose email service:"
echo "1. Gmail (recommended for testing)"
echo "2. I'll configure manually"
echo ""
read -p "Choice (1-2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "📧 Gmail Setup:"
    echo "   You need a Gmail App Password (not your regular password)"
    echo "   Get one at: https://myaccount.google.com/apppasswords"
    echo ""
    read -p "   Your Gmail address: " gmail
    read -p "   Gmail App Password (16 chars): " app_password
    
    # Remove old email config
    sed -i.bak '/^SMTP_/d' "$ENV_FILE" 2>/dev/null || true
    sed -i.bak '/^BASE_URL/d' "$ENV_FILE" 2>/dev/null || true
    sed -i.bak '/^API_BASE_URL/d' "$ENV_FILE" 2>/dev/null || true
    
    # Add new config
    cat >> "$ENV_FILE" << EOF

# Email Configuration (Local Development)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=$gmail
SMTP_PASSWORD=$app_password
SMTP_FROM=$gmail

# Base URL for payment links
BASE_URL=http://localhost:4000
API_BASE_URL=http://localhost:4000
EOF
    
    echo ""
    echo "✅ Gmail configuration added to .env"
    echo "   Note: Payment links will use http://localhost:4000"
    echo "   For production, change BASE_URL to https://api.callsomo.com"
    
else
    echo ""
    echo "📝 Manual Configuration:"
    echo "   Add these to your .env file:"
    echo ""
    echo "   SMTP_HOST=your-smtp-host"
    echo "   SMTP_PORT=587"
    echo "   SMTP_USER=your-email@example.com"
    echo "   SMTP_PASSWORD=your-password"
    echo "   SMTP_FROM=your-email@example.com"
    echo "   BASE_URL=http://localhost:4000"
    echo "   API_BASE_URL=http://localhost:4000"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "🧪 Test it:"
echo "   node scripts/test-email-payment-link.js"
echo ""

