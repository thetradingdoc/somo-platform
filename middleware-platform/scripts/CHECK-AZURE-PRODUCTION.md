# How to Check Azure Postgres Production

## Quick Method: Run on Azure App Service Console

1. **Go to Azure Portal** → App Service `doclittle` → **Console** (under Development Tools)

2. **Run these commands:**
```bash
cd /home/site/wwwroot/middleware-platform
node scripts/get-all-merchants-including-azure.js
```

This will show:
- All merchants in Azure Postgres (Production)
- All merchants in local SQLite databases
- Which merchants are in both
- Which merchants are only in Azure
- Which merchants are only local

## What You'll See

The script will display:
- **Azure Postgres (Production) Only** - merchants that exist only in production
- **In Both Local and Azure** - merchants synced to both
- **Local Only** - test/development merchants not in production

## Alternative: Get POSTGRES_URL and Run Locally

If you want to run locally, you need the Postgres connection string:

1. **Get connection string from Azure:**
   - Azure Portal → Postgres server → Connection strings
   - Copy the connection string

2. **Run locally:**
```bash
cd middleware-platform
POSTGRES_URL="postgresql://user:password@host:5432/dbname" node scripts/get-all-merchants-including-azure.js
```

## Expected Results

You should see:
- All merchant IDs from Azure production
- Comparison with local databases
- Which merchants need to be synced



