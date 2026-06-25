# Somo — brand guidelines

> **Last reviewed:** 2026-06-25

## Naming

| Context | Use |
|---------|-----|
| Platform | **Somo** |
| Voice / receptionist | **Somo front desk** (agentic AI receptionist) |
| RCM / billing | **Somo pay** (revenue cycle management) |
| Tagline | **Somo — never answer business calls again.** |
| Assistant copy (user-facing) | **Somo** product chrome; spoken voice persona is **Kelly** (e.g. "Hi, I'm Kelly, Somo's front desk receptionist") |
| Legal / invoices | **Somo** in product UI; registered entity name may differ on contracts — confirm before filing |

## Design tokens

Canonical CSS: [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css)

**Color reference:** [`docs/design/SOMO_COLORS.md`](../design/SOMO_COLORS.md)

Legacy `skin-care-tokens.css` re-exports Somo tokens for backward-compatible imports.

### Palette (unified — all surfaces)

| Token | Value | Use |
|-------|-------|-----|
| `--somo-primary` | `#1C35EA` | Primary CTA, links, progress, `theme_color` |
| `--somo-primary-hover` | `#1529C4` | Button/link hover |
| `--somo-primary-soft` | `#EEF0FE` | Badges, icon wells, soft strips |
| `--somo-primary-mid` | `#C5CCFA` | Active borders, step rings |
| `--somo-ink` | `#000000` | Headlines on light UI (pairs with black logo) |
| `--somo-text-marketing` | `#1a1a1a` | Body on light surfaces |
| `--somo-muted-marketing` | `#6b6b6b` | Secondary text on light |
| `--somo-ink` (dark chrome) | `#0a0a0a` | Dark background |
| `--somo-surface` | `#111111` | Cards on dark |
| `--somo-text` | `#ffffff` | Text on dark |
| `--somo-muted` | `#9ca3af` | Secondary text on dark |

### Deprecated aliases (do not use in new code)

| Token | Maps to |
|-------|---------|
| `--somo-green` | `--somo-primary` |
| `--somo-green-hover` | `--somo-primary-hover` |
| `--somo-green-soft` | `--somo-primary-soft` |
| `--somo-lizard` | `--somo-primary` |
| `--somo-msu` | `--somo-ink` (`#000000`) |
| `--somo-grass` | `--somo-primary-hover` |

**Semantic success colors** (`--success`, `--green: #16a34a`, paid/checkmark chips) are UX semantics — not brand accent. Do not change these when updating brand CTAs.

### Typography

| Token | Stack |
|-------|--------|
| `--font-brand` | League Spartan, system-ui, sans-serif |

All marketing headlines and body copy use **League Spartan**. Headlines use weight **700** (hero h1, demo section title). Subcopy uses weight **400**.

Font loading: `@fontsource/league-spartan` in somo-landing (`main.jsx`); other surfaces link fonts in HTML as needed.

Wordmark: **Somo** title case + botanical mark in `somo-logo.png` (black on transparent). Historical vector explorations in [`somo_logo_exploration.html`](./somo_logo_exploration.html) are archived reference only.

### Logo & icon — single source of truth

**Read first:** [Brand README](./README.md#logo-and-icon). **Prepare new logo:** `node scripts/prepare-somo-logo.cjs <source.png>`. **Sync command:** `npm run brand:sync` (copies from `unified-dashboard/assets/brand/` to API static and somo-landing public). **Icon crop:** `npm run brand:crop-icon` after updating `somo-logo.png`.

| Role | File | Use |
|------|------|-----|
| **Logo** | `unified-dashboard/assets/brand/somo-logo.png` | Nav, signup, login — Somo title-case lockup (PNG only) |
| **Icon** | `somo-icon.png` | Favicon source, sidebars, app icon (botanical mark cropped from lockup) |
| **Favicon** | `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` | Browser / PWA |

**Forbidden in product UI:** text-only wordmark SVGs, CSS `<span>` brand marks, legacy gecko/lizard assets, Somo / Skin & Care lockups.

**Deprecated / archived:** `somo-gecko.svg`, `somo-icon-lizard.png`, `somo-logo-wordmark.svg`, `somo-wordmark-text.svg` — in `_archive/gecko-legacy/`. Do not use in UI.

## Surface scope

- **Marketing:** Vite app at `/` (`business/trial-activation portal/`) — white page, blue CTAs (`#1C35EA`), black headings, `somo-logo.png` in nav.

- **Provider:** `business/*.html` + `provider-portal.css` — blue primary `#1C35EA`. Shell and page header contract: [PROVIDER_PORTAL_SHELL.md](../design/PROVIDER_PORTAL_SHELL.md).

- **Patient / consumer:** `patients/*.html`, health video — blue CTAs, black headlines on light surfaces, no Skin & Care lockup.

- **Admin ops:** `unified-dashboard/admin/*.html` — light palette (black headings + blue CTAs), League Spartan, shared [`admin-portal.css`](../../unified-dashboard/assets/css/admin-portal.css). Login reuses `auth-somo.css` / `signup-somo.css`. Official `somo-logo.png` on sign-in; `somo-icon.png` in sidebar. **Do not** use legacy purple (`#7c5dfa`, `#38bdf8`) or Inter as primary font.

- [Brand README](./README.md) — mandatory logo vs icon vs favicon paths
- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md) — hostnames and internal names unchanged until somopay.ai
- [somo_logo_exploration.html](./somo_logo_exploration.html) — logo variants and product wordmarks
