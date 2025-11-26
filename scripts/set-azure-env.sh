#!/bin/bash

# Configure Azure App Service Environment Variables from local .env file
# App: doclittle, Resource Group: doclittle

set -e

APP_NAME="doclittle"
RESOURCE_GROUP="doclittle"
ENV_FILE="middleware-platform/.env"

echo "⚙️  CONFIGURING AZURE APP SERVICE FROM LOCAL .ENV"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Azure CLI
if ! az account show &> /dev/null; then
    echo "⚠️  Not logged in. Logging in..."
    az login
fi

echo "📝 Reading environment variables from $ENV_FILE..."
echo ""

# Use Python to safely parse .env file and set via Azure CLI
python3 << 'PYTHON_SCRIPT'
import os
import subprocess
import re

app_name = "doclittle"
resource_group = "doclittle"
env_file = "middleware-platform/.env"

# Read .env file
env_vars = {}
if os.path.exists(env_file):
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.match(r'^([^=]+)=(.*)$', line)
            if match:
                key = match.group(1).strip()
                value = match.group(2).strip()
                # Remove quotes
                if (value.startswith('"') and value.endswith('"')) or \
                   (value.startswith("'") and value.endswith("'")):
                    value = value[1:-1]
                env_vars[key] = value

# Build settings
settings = [
    "NODE_ENV=production",
    f"PORT={env_vars.get('PORT', '4000')}",
    "API_BASE_URL=https://api.doclittle.site"
]

# Add required vars
for key in ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 
            'TWILIO_PHONE_NUMBER', 'RETELL_API_KEY', 'RETELL_AGENT_ID',
            'AZURE_COMMUNICATION_CONNECTION_STRING', 'AZURE_EMAIL_SENDER']:
    if key in env_vars and env_vars[key]:
        settings.append(f"{key}={env_vars[key]}")

# Add optional vars
for key in ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CIRCLE_API_KEY', 
            'CIRCLE_WALLET_SET_ID', 'MERCHANT_ID']:
    if key in env_vars and env_vars[key]:
        settings.append(f"{key}={env_vars[key]}")

# Build command
cmd = ['az', 'webapp', 'config', 'appsettings', 'set',
       '--resource-group', resource_group,
       '--name', app_name,
       '--settings'] + settings

print(f"🚀 Setting {len(settings)} environment variables...")
print("")

# Execute
result = subprocess.run(cmd, capture_output=True, text=True)
print(result.stdout)
if result.stderr:
    print(result.stderr)
if result.returncode == 0:
    print("")
    print("✅ Environment variables configured successfully!")
    print("")
    print(f"📋 Verify: az webapp config appsettings list --name {app_name} --resource-group {resource_group}")
else:
    print("❌ Error configuring environment variables")
    exit(result.returncode)
PYTHON_SCRIPT

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

