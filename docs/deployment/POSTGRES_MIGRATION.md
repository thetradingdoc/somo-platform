# Postgres Migration & Infrastructure Hardening

## Overview

The production roadmap calls for moving from the embedded SQLite database to a managed Azure Database for PostgreSQL instance. This guide introduces:

1. A repeatable export script that converts critical SQLite tables into Postgres-compatible SQL.
2. An Azure Bicep template (`infra/bicep/app-service-with-postgres.bicep`) that provisions an App Service, hosting plan, and Postgres flexible server with matching environment variables.

These assets allow you to bootstrap a managed Postgres environment, seed it with current data, and keep infrastructure reproducible across regions.

---

## 1. Generate a Postgres Seed

The middleware now ships with `scripts/export-sqlite-to-postgres.js`. It emits `CREATE TABLE` statements plus `INSERT` statements for the most sensitive multi-tenant data (clinics, clinic numbers, appointments, voice checkouts/logs, customers).

```bash
cd middleware-platform
npm run export:postgres           # writes backups/postgres-seed-<timestamp>.sql

# or specify a custom path
node scripts/export-sqlite-to-postgres.js /tmp/postgres-seed.sql
```

Upload the generated `.sql` file to your Azure Postgres instance (Azure Cloud Shell, `psql`, or GitHub Actions step) to seed the new database.

> The script is idempotent: it truncates the destination tables before inserting rows, making it safe for nightly refreshes during migration testing.

---

## 2. Provision Infra via Bicep

The new template lives at `infra/bicep/app-service-with-postgres.bicep` and creates:

- An App Service Plan (`B1` by default)
- A Linux App Service configured for Node 20
- A Flexible Server for PostgreSQL with public networking disabled by default
- App Settings for `POSTGRES_URL`, `RETELL_API_KEY`, `TWILIO_*`, etc.

### Parameters

| Parameter          | Description                               |
|--------------------|-------------------------------------------|
| `namePrefix`       | Base name for all Azure resources         |
| `location`         | Azure region (defaults to `westus2`)      |
| `postgresSku`      | Flexible server SKU (`Standard_B1ms`, …)  |
| `appServiceSku`    | App Service plan SKU (`B1`, `P1v3`, …)    |
| `adminLogin`       | Postgres admin username                   |
| `adminPassword`    | Postgres admin password (secure string)   |

### Deployment Command

```bash
cd infra/bicep
az deployment group create \
  --name voice-agent-hardened \
  --resource-group <rg> \
  --template-file app-service-with-postgres.bicep \
  --parameters namePrefix=doclittle \
               adminLogin=doclittle_admin \
               adminPassword=<secure-password>
```

This emits outputs for `appServiceUrl`, `postgresHost`, and `connectionString` that can be copied into GitHub secrets or Azure DevOps pipelines.

---

## 3. Cutover Checklist

1. **Run nightly exports** using `npm run export:postgres`.
2. **Load seed file** into the Azure Postgres flexible server (via `psql -f postgres-seed.sql`).
3. **Update App Settings** in App Service: set `POSTGRES_URL` to enable write-through mirroring (clinics, appointments, voice checkouts/logs). The middleware still reads from SQLite today, but every write is mirrored into Postgres so you can validate data correctness before a full flip.
4. **Verify telemetry** using Application Insights and the existing cost dashboards.
5. **Disable SQLite** once confidence is high (remove fallback envs, lock down file-based DB).

---

## Future Work

- Introduce a runtime DB abstraction so the middleware can switch between SQLite and Postgres via env flag.
- Expand read-path support so the API uses Postgres directly once `POSTGRES_URL` is set (currently writes are mirrored; reads still come from SQLite).
- Add GitHub Actions workflow that runs Bicep deployments + database exports on demand.
- Mirror infrastructure definitions for Twilio sub-accounts / phone-number provisioning once Azure Resource Graph adds support.

For now, the combination of the export script and the Bicep template gives the team a solid foundation for managed storage plus reproducible infrastructure. Use this guide as the canonical runbook for the “Harden data + infra” initiative.

