# Brand documentation index

> **Last reviewed:** 2026-06-02

## Canonical brand guide

- [LOGO_AND_ICON_SSOT.md](./LOGO_AND_ICON_SSOT.md) — **logo, icon, favicon paths (read before changing UI marks)**
- [SOMO_GUIDELINES.md](./SOMO_GUIDELINES.md) — naming, design tokens, typography, and surface scope.
- [SOMO_MARKETING_COLORS.md](../design/SOMO_MARKETING_COLORS.md) — Image 1 palette (marketing landing UI).

## Related

- [docs/README.md](../README.md)
- [docs/meta/CANONICAL_DOC_MAP.md](../meta/CANONICAL_DOC_MAP.md)
- [docs/meta/SURFACE_OWNERSHIP_MAP.md](../meta/SURFACE_OWNERSHIP_MAP.md)
- [QA_MATRIX.md](./QA_MATRIX.md)
- [Transactional email HTML](../../middleware-platform/lib/somo-email-layout.js) — see LOGO_AND_ICON_SSOT § Transactional email
- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md) — consumer vs GCP/internal names


---

<a id="github-migration"></a>

## GITHUB MIGRATION

*Merged from `docs/Brand/GITHUB_MIGRATION.md` on 2026-06-02.*

# GitHub migration: doclittle-platform → somo-platform

**Status:** Repository cutover complete (2026-05-29).

| Item | Value |
|------|--------|
| New remote | `https://github.com/richiejeremiah/somo-platform` (private) |
| Legacy remote | `doclittle-old` → `richiejeremiah/doclittle-platform` (archive after smoke) |
| Production hosts | `callsomo.com` / `api.callsomo.com` (unchanged until somopay.ai) |

## Manual follow-up

1. **GitHub Actions secrets** — configure on `richiejeremiah/somo-platform`:

| Secret / variable | Purpose |
|-------------------|---------|
| `FIREBASE_TOKEN` | `firebase deploy` for `callsomo.com` hosting |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF for deploy-staging workflow |
| `GCP_SERVICE_ACCOUNT` | SA email with Cloud Run + Secret Manager access |
| `CLOUDSQL_CONNECTION_NAME` (repo **variable**) | e.g. `somo-callsomo:us-central1:somo-staging-pg` |

**GCP Secret Manager** (`somo-staging-*` prefix): seed via `./scripts/provision-staging-secrets.sh` from operator `.env`. Keys: `JWT_SECRET`, `TWILIO_*`, `RETELL_*`, `STRIPE_*`, `SOMO_OWNER_PASSWORD`, `POSTGRES_URL`. See `middleware-platform/.env.staging.example`.

2. **GCP / Firebase access (Phase 0 checklist)**

| Check | Command / URL |
|-------|----------------|
| GCP project | `gcloud config get-value project` → `somo-callsomo` |
| API live | `curl -sS https://api.callsomo.com/health/live` |
| UI live | `curl -sS -I https://callsomo.com` |
| Bootstrap script | `npm run gcp:bootstrap:check` |

3. **Railway** — **deprecated** for API. Production/staging API SSOT is Cloud Run `somo-middleware`. Disconnect Railway GitHub auto-deploy if still linked.

4. **Deploy API** — `./scripts/deploy-to-gcp.sh` or `.github/workflows/deploy-staging.yml` (manual dispatch).

5. **Firebase Hosting** — `npm run deploy:staging-hosting` (full `hosting-dist` bundle).

6. **Archive old repo** — After green CI on `somo-platform` `main`, archive `doclittle-platform`.

## Clone

```bash
git clone https://github.com/richiejeremiah/somo-platform.git somo
cd somo
```


---

<a id="infra-brand-deferral"></a>

## INFRA BRAND DEFERRAL

*Merged from `docs/Brand/INFRA_BRAND_DEFERRAL.md` on 2026-06-02.*

# Infrastructure brand deferral

User-facing product name: **Somo**. Production hosts:

| Role | Host |
|------|------|
| Marketing / provider portal UI | `https://callsomo.com` |
| Middleware API | `https://api.callsomo.com` |
| Firebase Hosting | project `somo-4ddf6` |
| GCP API project | `somo-callsomo` |
| Cloud Run service | `somo-middleware` (`us-central1`) |

Legacy domains `myskinandcare.com` / `doclittle.site` are retired in application code; DNS 301s are operator-owned ([`../runbooks/LEGACY_DOMAIN_RETIREMENT.md`](../runbooks/LEGACY_DOMAIN_RETIREMENT.md)).

## Internal code names (not consumer brand)

| Pattern | Example |
|---------|---------|
| `Kelly*` services | `KellyAgentService`, `KELLY_*` env vars |
| `STEDI_*` | Stedi integration env vars |
| Tenant subdomain `doctor-little` | Historical seed data / DNS examples |
| `DODGECALL_*` env (legacy) | Read via [`somo-demo-env.js`](../../middleware-platform/lib/somo-demo-env.js); prefer `SOMO_DEMO_*` |

## Somo demo public API

| Canonical | Notes |
|-----------|--------|
| `/api/public/somo-demo/*` | Only supported public demo routes |
| `/api/public/dodgecall/*` | **Removed** — deploy revision must include `somo-demo` mounts |

## FHIR namespace

New writes use `https://callsomo.com/fhir/StructureDefinition/...` via [`fhir-brand-identifiers.js`](../../middleware-platform/lib/fhir-brand-identifiers.js). Legacy `doclittle.health` URLs remain readable until backfill:

```bash
DB_PATH=./middleware-staging.db node middleware-platform/scripts/backfill-fhir-callsomo-namespace.cjs --dry-run
```

## Display vs infra

- **Change:** HTML titles, hero copy, support emails, terms party name (Somo).
- **Do not change without migration:** GCP bucket names, PBKDF2 salt in `api-keys.js`, vendor webhook URLs until consoles are updated.

## Guardrails

- `npm run check:legacy-hosts` — fails on `doclittle.site`, `myskinandcare.com`, `doctor-little-c688d` in active code.
- `npm run check:brand-consumer-strings` — bans legacy consumer strings in services/routes.
- `npm run guardrail:no-azure-deploy` — fails if Azure deploy scripts are reintroduced.

Deploy SSOT: [`../deployment/SOMO_CLOUD_RUN_DEPLOY.md`](../deployment/SOMO_CLOUD_RUN_DEPLOY.md).


---

<a id="logo-and-icon-ssot"></a>

## LOGO AND ICON SSOT

*Merged from `docs/Brand/LOGO_AND_ICON_SSOT.md` on 2026-06-02.*

# Somo logo and icon — single source of truth

> **Last reviewed:** 2026-06-01

Read this before changing any logo, favicon, or nav mark in the repo.

## Canonical files (do not invent replacements)

All official raster assets live in **[`unified-dashboard/assets/brand/`](../../unified-dashboard/assets/brand/)**.

| Role | File | Use |
|------|------|-----|
| **Logo** (full lockup) | `somo-logo.png` | Nav, signup cards, login, API signup on light backgrounds — green gecko + “Somo” wordmark |
| **Master / archive** | `somo-logo-master.png` | Same as logo; keep in sync with `somo-logo.png` |
| **Icon** (gecko only) | `somo-icon.png`, `somo-icon-lizard.png` | Favicon source, app icon, dark headers beside typography |
| **Favicon** | `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` | Browser tab |
| **Apple touch** | `apple-touch-icon.png` | iOS home screen |

Regenerate favicon sizes after updating the icon:

```bash
npm run brand:favicons
```

Copy SSOT to API static and marketing public:

```bash
npm run brand:sync
```

## Forbidden in product UI

- **Do not** use text-only `somo-logo-wordmark.svg` or `somo-wordmark-text.svg` as a logo.
- **Do not** build logos from CSS (`<span class="doc">`), inline SVG text, or AI-generated geckos.
- **Do not** use `somo-gecko.svg` for favicon, nav lockup, or signup header (decorative marketing only).
- **Do not** add new logo files under `public/` without updating SSOT first.

## Dark green headers (API profile, docs sidebar)

Use **gecko icon + typography**, not the text-only wordmark:

```html
<div class="logo-brand logo-brand--on-dark">
  <img src="/assets/brand/somo-icon.png" alt="" width="40" height="40" aria-hidden="true" />
  <span class="logo-brand-text">Somo</span>
</div>
```

League Spartan “Somo” beside the official gecko is allowed; inventing a new mark is not.

## Light surfaces (signup card, terms)

```html
<img src="/assets/brand/somo-logo.png" alt="Somo" width="200" height="auto" />
```

## Transactional email (HTML)

All outbound templates use [`middleware-platform/lib/somo-email-layout.js`](../../middleware-platform/lib/somo-email-layout.js):

- Header: official logo from `https://callsomo.com/assets/brand/somo-logo.png` (override with `SOMO_EMAIL_LOGO_URL`)
- Colors: Somo green `#16a637`, MSU green header gradient, League Spartan stack
- Footer: tagline, `callsomo.com`, `info@callsomo.com`

Do not use CSS text logos (`<span class="doc">`) or legacy blue `#1e40af` in new templates.

## Favicon (all static HTML)

```html
<link rel="icon" href="/assets/brand/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32x32.png" />
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png" />
```

## Related

- [SOMO_GUIDELINES.md](./SOMO_GUIDELINES.md) — naming, colors, typography
- [SOMO_GUIDELINES.md#logo--icon--single-source-of-truth](./SOMO_GUIDELINES.md) — summary in main guide


---

<a id="qa-matrix"></a>

## QA MATRIX

*Merged from `docs/Brand/QA_MATRIX.md` on 2026-06-02.*

# Somo brand — manual QA matrix

**Last Updated:** 2026-05-30

Run after brand changes; production host may still be **callsomo.com**.

| Surface | URL (local :4000) | Check |
|---------|-------------------|--------|
| Marketing landing | `/` | Somo gecko wordmark; hero on white; lizard CTA `#b5e930` (not legacy `#93d33b`); MSU `#164437` on headings/pills; capability panels without gray taglines under tab labels; muted free pricing card + single lizard primary on Practice |
| Provider login | `/login` or `/business/login.html` | Somo branding, product green `#16a637` CTAs |
| RCM | `/business/rcm.html` | Provider shell “Somo”, green accents |
| Patient wallet | `/patients/wallet.html` | Somo colors, no Skin & Care |
| Signup terms | `/public/signup/terms.html` | Party name Somo, green header |
| Privacy | `/public/signup/privacy.html` | Somo privacy policy |
| PWA manifest | `manifest.webmanifest` | `name` Somo, `theme_color` `#16a637` (product) |

**Automated:** `npm run check:brand` from repo root.

**E2E:** `npm run test:e2e-somo-landing --prefix middleware-platform` (Somo hero, capabilities, pricing hierarchy).

**Palette SSOT:** [`docs/design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md).
