# CI/CD Setup for Infrastructure Deployment

This guide explains how to use the GitHub Actions workflow to deploy infrastructure using Bicep templates.

## Overview

The `.github/workflows/deploy-infrastructure.yml` workflow automates the deployment of:
- Azure App Service Plan
- Azure App Service (Node.js 20)
- Azure Database for PostgreSQL Flexible Server
- Database and connection configuration

## Prerequisites

### 1. Azure Service Principal

Create an Azure service principal with Contributor role:

```bash
az ad sp create-for-rbac \
  --name "github-actions-doclittle" \
  --role Contributor \
  --scopes /subscriptions/{subscription-id} \
  --sdk-auth
```

Save the JSON output - you'll need it for GitHub secrets.

### 2. GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret Name | Description | Example |
|------------|-------------|---------|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `12345678-1234-1234-1234-123456789012` |
| `AZURE_TENANT_ID` | Azure tenant ID | `87654321-4321-4321-4321-210987654321` |
| `AZURE_CLIENT_ID` | Service principal client ID | `abcd1234-5678-90ef-ghij-klmnopqrstuv` |
| `AZURE_CLIENT_SECRET` | Service principal client secret | `your-secret-key` |
| `POSTGRES_ADMIN_LOGIN` | Postgres admin username | `adminuser` |
| `POSTGRES_ADMIN_PASSWORD` | Postgres admin password | `YourSecurePassword123!` |

## Usage

### Manual Deployment (Workflow Dispatch)

1. Go to **Actions** tab in GitHub
2. Select **Deploy Infrastructure** workflow
3. Click **Run workflow**
4. Fill in the parameters:
   - **Environment**: `staging` or `production`
   - **Name prefix**: Resource name prefix (e.g., `doclittle`)
   - **Location**: Azure region (e.g., `westus2`)
5. Click **Run workflow**

### Automatic Deployment (Push to main)

The workflow automatically runs when:
- Code is pushed to `main` branch
- Files in `infra/bicep/` are modified
- The workflow file itself is updated

## Workflow Steps

1. **Checkout code**: Gets the latest code from repository
2. **Azure Login**: Authenticates using service principal
3. **Set deployment variables**: Configures environment-specific settings
4. **Create resource group**: Creates or updates Azure resource group
5. **Deploy Bicep template**: Provisions all infrastructure resources
6. **Get deployment outputs**: Retrieves connection strings and URLs
7. **Display results**: Shows deployment summary

## Outputs

After successful deployment, the workflow outputs:

- **App Service URL**: `https://{name-prefix}-{env}-api.azurewebsites.net`
- **Postgres Host**: `{name-prefix}-{env}-pg.postgres.database.azure.com`
- **Connection String**: Full Postgres connection string (masked in logs)

## Post-Deployment Steps

### 1. Configure App Service Environment Variables

The Bicep template sets `POSTGRES_URL` but you may need to update other variables:

```bash
az webapp config appsettings set \
  --resource-group rg-{name-prefix}-{env} \
  --name {name-prefix}-{env}-api \
  --settings \
    RETELL_API_KEY="your-key" \
    TWILIO_ACCOUNT_SID="your-sid" \
    TWILIO_AUTH_TOKEN="your-token" \
    DEFAULT_CLINIC_ID="clinic-default"
```

### 2. Run Database Migrations

Connect to Postgres and run the schema creation:

```bash
# Get connection string
az deployment group show \
  --resource-group rg-{name-prefix}-{env} \
  --name app-service-with-postgres \
  --query properties.outputs.connectionString.value

# Connect and run migrations
psql "{connection-string}" -f middleware-platform/scripts/schema.sql
```

### 3. Seed Initial Data (Optional)

If you have existing SQLite data:

```bash
# Export from SQLite
cd middleware-platform
npm run export:postgres

# Import to Postgres
psql "{connection-string}" -f backups/postgres-seed-*.sql
```

### 4. Deploy Application Code

Deploy your application to the App Service:

```bash
# Using ZIP deployment
az webapp deployment source config-zip \
  --resource-group rg-{name-prefix}-{env} \
  --name {name-prefix}-{env}-api \
  --src deploy.zip
```

## Environment-Specific Configuration

### Staging

- Resource group: `rg-doclittle-staging`
- App Service: `doclittle-staging-api`
- Postgres: `doclittle-staging-pg`

### Production

- Resource group: `rg-doclittle-production`
- App Service: `doclittle-production-api`
- Postgres: `doclittle-production-pg`

## Troubleshooting

### Deployment Fails

1. **Check Azure permissions**: Ensure service principal has Contributor role
2. **Verify secrets**: All required secrets must be set in GitHub
3. **Check resource limits**: Ensure subscription has quota for resources
4. **Review logs**: Check workflow logs for specific error messages

### Connection Issues

1. **Postgres networking**: By default, public access is disabled. Enable if needed:
   ```bash
   az postgres flexible-server firewall-rule create \
     --resource-group rg-{name-prefix}-{env} \
     --name {name-prefix}-{env}-pg \
     --rule-name AllowAzureServices \
     --start-ip-address 0.0.0.0 \
     --end-ip-address 0.0.0.0
   ```

2. **SSL requirements**: Connection string includes `sslmode=require` - ensure SSL is enabled

### App Service Not Starting

1. **Check logs**: `az webapp log tail --name {name} --resource-group {rg}`
2. **Verify environment variables**: Ensure `POSTGRES_URL` is set correctly
3. **Check application code**: Ensure code is deployed and compatible

## Security Best Practices

1. **Use Key Vault**: Store sensitive values in Azure Key Vault instead of App Settings
2. **Rotate credentials**: Regularly rotate Postgres admin password
3. **Network isolation**: Use VNet integration for App Service to Postgres communication
4. **Private endpoints**: Configure private endpoints for Postgres in production
5. **RBAC**: Use least-privilege access for service principal

## Cost Optimization

- **Staging**: Use `B1` App Service and `Standard_B1ms` Postgres (lowest cost)
- **Production**: Scale up based on traffic (`P1v3` App Service, `Standard_B2s` Postgres)
- **Auto-shutdown**: Consider auto-shutdown for non-production environments

## Next Steps

1. Set up monitoring and alerts
2. Configure backup policies for Postgres
3. Set up staging → production promotion workflow
4. Add integration tests to CI/CD pipeline
5. Configure DNS and SSL certificates

