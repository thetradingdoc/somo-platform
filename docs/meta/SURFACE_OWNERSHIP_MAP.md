# Surface ownership map

**Last Updated:** 2026-05-30  
**Purpose:** Where code lives vs which doc owns it. Read this before editing paths in consolidated READMEs.

| Surface | Code path | Canonical docs |
|---------|-----------|----------------|
| **Marketing landing (Somo)** | [`unified-dashboard/somo-landing/`](../../unified-dashboard/somo-landing/) | [`deployment/SOMO_LANDING.md`](../deployment/SOMO_LANDING.md), [`design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md), [`deployment/SOMO_LANDING_HERO.md`](../deployment/SOMO_LANDING_HERO.md) |
| **Legacy marketing + assistant (archived)** | [`unified-dashboard/_archive/littlelab-landing/`](../../unified-dashboard/_archive/littlelab-landing/) | [`_archive/README.md`](../../unified-dashboard/_archive/README.md) — retired 2026-05-29; Kelly/LiveKit landing assistant paths only |
| **Provider / admin HTML** | [`unified-dashboard/business/`](../../unified-dashboard/business/), [`login.html`](../../unified-dashboard/login.html), [`signup.html`](../../unified-dashboard/signup.html) | [`Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md) (product green `#16a637`), [`auth/auth-entrypoints.md`](../auth/auth-entrypoints.md) |
| **API developer signup** | [`middleware-platform/public/signup/`](../../middleware-platform/public/signup/) on `api.callsomo.com` | [`auth/API_DEVELOPER_SIGNUP.md`](../auth/API_DEVELOPER_SIGNUP.md) |
| **Patient web** | [`unified-dashboard/patients/`](../../unified-dashboard/patients/) | [`patient-app/README.md`](../patient-app/README.md), architecture patient anchors |
| **Middleware API** | [`middleware-platform/`](../../middleware-platform/) | [`middleware-platform/README.md`](../middleware-platform/README.md), [`architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md`](../architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md) |
| **Patient mobile** | [`patient-app/`](../../patient-app/) | [`patient-app/README.md`](../patient-app/README.md) |
| **Design tokens (code SSOT)** | [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css) | Marketing overrides in `somo-landing/src/styles/somo.css`; palette doc: [`design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md) |

## Color surfaces

| Context | Tokens | Hex (primary) |
|---------|--------|----------------|
| **Marketing landing** | `--somo-lizard`, `--somo-msu`, `--somo-grass` | CTA `#b5e930`, headings `#164437` |
| **Provider / patient app UI** | `--somo-green` | `#16a637` |

Do not document `#93d33b` as the current marketing CTA; Image 1 lizard replaced it.

## Related

- [`CANONICAL_DOC_MAP.md`](./CANONICAL_DOC_MAP.md)
- [`CURRENT_STATE_ARCHITECTURE.md`](../architecture/CURRENT_STATE_ARCHITECTURE.md)
