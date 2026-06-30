# Somo — brand guidelines

> **Last reviewed:** 2026-06-25

## Product lines

| Line | Audience | Entry | Spoken persona |
|------|----------|-------|----------------|
| **Somo Health** | Consumer (anonymous) | `/health-video/` | **Somo** — AI health assistant, education-only, no diagnosis |
| **Somo front desk** | B2B practices | `/business/trial-activation.html` | **Kelly front desk** — AI receptionist, booking, demo |
| **Somo pay** | Providers / RCM | `business/*.html` | Billing, eligibility, claims (no Kelly chat in UI) |

## Naming

| Context | Use |
|---------|-----|
| Platform | **Somo** |
| Consumer health | **Somo Health** — Safe VideoGPT for Healthcare |
| Voice / receptionist (B2B) | **Somo front desk** |
| RCM / billing | **Somo pay** |
| B2B tagline | **Somo — never answer business calls again.** (front desk only — not consumer health) |
| Consumer Somo (spoken) | "Hi, I'm Somo" — AI health assistant for health chat |
| B2B Kelly (spoken) | "Hi, I'm Kelly, Somo's front desk receptionist" |
| Legal / invoices | **Somo** in product UI; registered entity name may differ on contracts |

**Do not** use DocLittle, Skin & Care, LittleLab, or DodgeCall in user-facing copy.

## Design tokens

Canonical CSS: [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css)

Legacy `skin-care-tokens.css` re-exports Somo tokens for backward-compatible imports.

### Palette (product / dark surfaces)

| Token | Value | Use |
|-------|-------|-----|
| `--somo-green` | `#16a637` | Primary CTA, links, accents |
| `--somo-green-hover` | `#128a2e` | Hover states |
| `--somo-green-soft` | `#e8f7ed` | Soft backgrounds |
| `--somo-ink` | `#0a0a0a` | Dark background |
| `--somo-surface` | `#111111` | Cards on dark |
| `--somo-text` | `#ffffff` | Text on dark |
| `--somo-muted` | `#9ca3af` | Secondary text on dark |

### Palette (marketing landing — Image 1)

Used by [`business/trial-activation portal/`](../../business/trial-activation portal/). **Canonical table:** [`docs/design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md).

| Token | Value | Use |
|-------|-------|-----|
| `--somo-lizard` | `#b5e930` | Primary CTA, demo sphere, progress accents |
| `--somo-msu` | `#164437` | Headings, dark pills, free-tier emphasis |
| `--somo-grass` | `#238108` | Capability panel titles (assist step) |

### Typography

| Token | Stack |
|-------|--------|
| `--font-brand` | League Spartan, system-ui, sans-serif |

### Logo & icon — single source of truth

**Read first:** [LOGO_AND_ICON_SSOT.md](./LOGO_AND_ICON_SSOT.md). **Sync command:** `npm run brand:sync`.

| Role | File | Use |
|------|------|-----|
| **Logo** | `unified-dashboard/assets/brand/somo-logo.png` | Nav, signup, login |
| **Icon** | `somo-icon.png`, `somo-icon-lizard.png` | Favicon, dark headers |

**Forbidden in product UI:** text-only `somo-logo-wordmark.svg`, CSS `<span>` brand marks, Somo / Skin & Care lockups.

## Surface scope

- **Consumer health:** `unified-dashboard/health-video-landing/` — Safe VideoGPT, Somo health assistant, Somo green tokens.
- **Marketing (B2B):** `business/trial-activation.html` — trial demo, Kelly front desk.
- **Provider:** `business/*.html` + `provider-portal.css` — canonical green `#16a637`.
- **Admin ops:** `unified-dashboard/admin/*.html` — MSU + lizard palette.

- [LOGO_AND_ICON_SSOT.md](./LOGO_AND_ICON_SSOT.md)
- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md)
- [HEALTH_SESSION_ARCHITECTURE.md](../architecture/HEALTH_SESSION_ARCHITECTURE.md) — consumer health SSOT
