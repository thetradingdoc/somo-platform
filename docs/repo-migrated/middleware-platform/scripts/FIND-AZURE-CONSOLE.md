# How to Find Azure Console / SSH

## Option 1: Via Azure Portal (Browser-based)

1. **In the left menu**, find **"Development Tools"** (it has a right arrow `▶` indicating a submenu)
2. **Click "Development Tools"** to expand it
3. You should see:
   - **Console** - Browser-based terminal
   - **SSH** - SSH connection
   - **Log stream** - Real-time logs
   - **Advanced Tools (Kudu)** - Advanced debugging

4. **Click "Console"** or **"SSH"** to open a terminal

## Option 2: Via Azure Portal (Direct URL)

If you can't find it in the menu, try this direct URL pattern:
```
https://portal.azure.com/#@your-tenant/resource/subscriptions/YOUR_SUB/resourceGroups/YOUR_RG/providers/Microsoft.Web/sites/doclittle/console
```

Or go to:
- Azure Portal → App Services → `doclittle` → **SSH** (under Development Tools)

## Option 3: Use Azure CLI (Local Terminal)

If you have Azure CLI installed locally:

```bash
# Login to Azure
az login

# Set your subscription
az account set --subscription "your-subscription-name"

# Open SSH session
az webapp ssh --name doclittle --resource-group YOUR_RESOURCE_GROUP
```

## Option 4: Get Environment Variables via Azure CLI

If you just need the POSTGRES_URL, you can get it via Azure CLI:

```bash
# Get all environment variables
az webapp config appsettings list --name doclittle --resource-group YOUR_RG --output table

# Get specific variable
az webapp config appsettings list --name doclittle --resource-group YOUR_RG --query "[?name=='POSTGRES_URL'].value" -o tsv
```

Then you can run the script locally with that connection string.

## What to Run Once You Have Console/SSH Access

```bash
cd /home/site/wwwroot/middleware-platform
node scripts/get-all-merchants-including-azure.js
```

This will show all merchants from Azure Postgres production.

