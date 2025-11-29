# Postgres Testing Guide

This guide explains how to test the Postgres routing implementation.

## Prerequisites

1. **Postgres Database**: You need a Postgres database (version 12+) accessible via connection string
2. **Connection String Format**: `postgresql://username:password@host:port/database?sslmode=require`

## Local Testing

### Option 1: Docker Postgres

```bash
# Start a local Postgres container
docker run --name test-postgres \
  -e POSTGRES_PASSWORD=testpass \
  -e POSTGRES_DB=testdb \
  -p 5432:5432 \
  -d postgres:15

# Run the test
POSTGRES_URL=postgresql://postgres:testpass@localhost:5432/testdb \
  node middleware-platform/tests/test-postgres-routing.js
```

### Option 2: Azure Postgres (via Bicep)

1. Deploy infrastructure using the Bicep template:
   ```bash
   az deployment group create \
     --resource-group rg-doclittle-test \
     --template-file infra/bicep/app-service-with-postgres.bicep \
     --parameters \
       namePrefix=doclittle-test \
       location=westus2 \
       adminLogin=adminuser \
       adminPassword=YourSecurePassword123! \
       appServiceSku=B1 \
       postgresSku=Standard_B1ms
   ```

2. Get the connection string from outputs:
   ```bash
   az deployment group show \
     --resource-group rg-doclittle-test \
     --name app-service-with-postgres \
     --query properties.outputs.connectionString.value
   ```

3. Run the test:
   ```bash
   POSTGRES_URL="<connection-string-from-output>" \
     node middleware-platform/tests/test-postgres-routing.js
   ```

## Running the Test

```bash
# From the middleware-platform directory
cd middleware-platform
POSTGRES_URL=postgresql://user:pass@host:5432/dbname \
  node tests/test-postgres-routing.js

# Or from the project root
POSTGRES_URL=postgresql://user:pass@host:5432/dbname \
  node middleware-platform/tests/test-postgres-routing.js
```

## What the Test Does

The test verifies that all critical database methods correctly route to Postgres:

1. ✅ **Clinic Operations**: Create, retrieve by ID
2. ✅ **Appointment Operations**: Create, retrieve, search by date, search by phone
3. ✅ **Voice Checkout Operations**: Create, retrieve, update
4. ✅ **Logging Operations**: Voice call logging, function call logging

## Expected Output

```
🗄️  Postgres Routing Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Postgres URL: postgresql://user:****@host:5432/dbname

📋 Test 1: Creating clinic...
✅ Clinic created

📋 Test 2: Retrieving clinic...
✅ Clinic retrieved: Postgres Test Clinic

... (all tests pass)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 All Postgres routing tests passed!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Troubleshooting

### Connection Errors

- **Error: Connection refused**: Check that Postgres is running and accessible
- **Error: Authentication failed**: Verify username/password in connection string
- **Error: Database does not exist**: Create the database first: `CREATE DATABASE testdb;`

### SSL Errors

If using local Postgres without SSL:
```bash
POSTGRES_URL=postgresql://user:pass@localhost:5432/dbname?sslmode=disable
```

### Schema Issues

The test assumes the database schema is already created. If you're using a fresh database, you'll need to run migrations first. The schema is created automatically when the app starts with `POSTGRES_URL` set.

## Next Steps

After successful testing:

1. **Deploy to Staging**: Use the Bicep template to deploy infrastructure
2. **Run Migrations**: Execute database migrations on the Postgres instance
3. **Update App Service**: Set `POSTGRES_URL` environment variable in Azure App Service
4. **Monitor**: Check application logs to ensure Postgres routing is working

