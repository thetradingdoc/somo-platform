# How to Check Azure Postgres for doctor-little

## Option 1: Run on Azure App Service Console (Recommended)

1. Go to Azure Portal → App Service `doclittle` → **Console** (under Development Tools)
2. Run these commands:

```bash
cd /home/site/wwwroot/middleware-platform
node scripts/check-azure-doctor-little-remote.js
```

The script will automatically use `POSTGRES_URL` from App Service environment variables.

## Option 2: Run Locally with Connection String

If you have the Postgres connection string, run:

```bash
cd middleware-platform
POSTGRES_URL="postgresql://user:password@host:5432/dbname" node scripts/check-azure-doctor-little-remote.js
```

## What the Script Does

1. Searches for customer with email `doctorjay254+1000@gmail.com`
2. Finds the merchant associated with that customer
3. Checks if the merchant has subdomain `doctor-little` set
4. Lists all merchants with "doctor" or "little" in name/subdomain
5. Shows the last 20 merchants in the database

## Expected Output

If the customer exists but merchant subdomain is missing, you'll see:
```
⚠️  ISSUE DETECTED:
   Current subdomain: NULL
   Expected subdomain: doctor-little
   The merchant exists but subdomain is not set correctly!

💡 TO FIX: Run this SQL on Azure Postgres:
   UPDATE merchants SET subdomain = 'doctor-little' WHERE id = '...';
```



