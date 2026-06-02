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
| `dodgecall-*` modules / HTTP paths | `dodgecall-demo`, `services/dodgecall-*.js` |
| `Kelly*` services | `KellyAgentService`, `KELLY_*` env vars |
| `STEDI_*` | Stedi integration env vars |
| Cloud Run service `myskin-middleware` | GCP resource name (rename is separate ops) |
| FHIR `doclittle.health` extension URLs | Stored data namespace — migrate deliberately |

## Display vs infra

- **Change:** HTML titles, hero copy, support emails, terms party name (Somo).
- **Do not change without migration:** FHIR extension URLs, GCP service/bucket names, vendor webhook URLs until consoles are updated.

## Guardrails

- `npm run check:legacy-hosts` — fails on `doclittle.site`, `myskinandcare.com`, `doctor-little-c688d` in active code.
- `npm run guardrail:no-azure-deploy` — fails if Azure deploy scripts are reintroduced.
