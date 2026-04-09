# Deployment Documentation

Deployment guides, infrastructure setup, and operational documentation.

---

## 📚 Documentation index (verified paths)

| Topic | File |
|--------|------|
| **Main deployment guide** | [`guides/DEPLOYMENT_GUIDE.md`](./guides/DEPLOYMENT_GUIDE.md) |
| **Quick Azure deploy** | [`guides/basic/QUICK_DEPLOYMENT_GUIDE.md`](./guides/basic/QUICK_DEPLOYMENT_GUIDE.md) |
| **CI / deploy source of truth** | [`CI_AND_DEPLOY_SOURCE_OF_TRUTH.md`](./CI_AND_DEPLOY_SOURCE_OF_TRUTH.md) |
| **Azure email (ACS)** | [`../azure/README.md`](../azure/README.md) |
| **Tenant / DNS automation** | [`azure/AUTOMATED_TENANT_DOMAIN_SETUP.md`](./azure/AUTOMATED_TENANT_DOMAIN_SETUP.md) |
| **Postgres migration** | [`database/POSTGRES_MIGRATION.md`](./database/POSTGRES_MIGRATION.md) |
| **Backups** | [`guides/BACKUP_STRATEGY.md`](./guides/BACKUP_STRATEGY.md) |
| **Security** | [`security/SECURITY_IMPROVEMENTS.md`](./security/SECURITY_IMPROVEMENTS.md) |
| **Production API keys** | [`security/PRODUCTION_DEPLOYMENT_API_KEYS.md`](./security/PRODUCTION_DEPLOYMENT_API_KEYS.md) |
| **DNS / SSL** | [`dns/ionos/IONOS_DNS_SETUP.md`](./dns/ionos/IONOS_DNS_SETUP.md), [`dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md`](./dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md) |

---

## 🚀 Deployment overview

- **Azure** cloud services (see [`../azure/README.md`](../azure/README.md) for email + env)
- **Custom domain / DNS** (`deployment/dns/`, `deployment/azure/`)
- **Database** SQLite default; optional Postgres ([`database/POSTGRES_MIGRATION.md`](./database/POSTGRES_MIGRATION.md))
- **Security** hardening ([`security/`](./security/))

---

## 🔗 Related documentation

- **Azure:** [`../azure/README.md`](../azure/README.md)
- **Architecture:** [`../architecture/README.md`](../architecture/README.md)
- **Main docs:** [`../README.md`](../README.md)

---

**Last Updated:** April 9, 2026

