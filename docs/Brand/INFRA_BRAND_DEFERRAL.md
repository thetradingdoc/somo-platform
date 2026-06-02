# Infrastructure brand deferral

User-facing UI says **Somo**. Production hosts are **callsomo.com** (see [`CALLSOMO_GCP_CUTOVER.md`](../runbooks/CALLSOMO_GCP_CUTOVER.md)).

## Canonical production hosts

| Role | Host |
|------|------|
| Marketing / provider portal UI | `https://callsomo.com` |
| Middleware API | `https://api.callsomo.com` |
| Firebase Hosting | project `somo-4ddf6` |
| GCP API project | `somo-callsomo` (Cloud Run `myskin-middleware`) |

Legacy `myskinandcare.com` / `doclittle.site` are retired in code; DNS 301s are operator-owned ([`LEGACY_DOMAIN_RETIREMENT.md`](../runbooks/LEGACY_DOMAIN_RETIREMENT.md)).

## Internal code names (not consumer brand)

| Pattern | Example |
|---------|---------|
| `Kelly*` services | `KellyAgentService`, `KELLY_*` env vars |
| `STEDI_*` | Stedi integration env vars |
| Cloud Run service `myskin-middleware` | GCP resource name (rename is separate ops) |
| `/api/public/dodgecall` | Deprecated route alias → `/api/public/somo-demo` |

## FHIR namespace

New writes use `https://callsomo.com/fhir/StructureDefinition/...` via [`fhir-brand-identifiers.js`](../../middleware-platform/lib/fhir-brand-identifiers.js). Legacy `doclittle.health` URLs remain readable until backfill:

```bash
DB_PATH=./middleware-staging.db node middleware-platform/scripts/backfill-fhir-callsomo-namespace.cjs --dry-run
```

## Display vs infra

- **Change:** HTML titles, hero copy, support emails, terms party name (Somo).
- **Do not change without migration:** GCP service/bucket names, vendor webhook URLs until consoles are updated.

## Guardrails

- `npm run check:legacy-hosts` — fails on `doclittle.site`, `myskinandcare.com`, `doctor-little-c688d` in active code.
- `npm run check:brand-consumer-strings` — bans legacy consumer strings in services/routes.
- `npm run guardrail:no-azure-deploy` — fails if Azure deploy scripts are reintroduced.
