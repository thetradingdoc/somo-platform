# Get POSTGRES_URL from Azure Portal

## Steps:

1. **In Azure Portal**, go to your App Service `doclittle`
2. **In the left menu**, find **"Configuration"** (under Settings)
3. **Click "Configuration"**
4. **Look for "Application settings"** tab
5. **Find `POSTGRES_URL`** in the list
6. **Copy the value**

## Then run locally:

```bash
cd middleware-platform
POSTGRES_URL="paste-the-value-here" node scripts/get-all-merchants-including-azure.js
```

This will check both local databases AND Azure Postgres production.

