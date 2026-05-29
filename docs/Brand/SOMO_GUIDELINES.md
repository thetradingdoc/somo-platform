# Somo — brand guidelines

> **Last reviewed:** 2026-05-29

## Naming

| Context | Use |
|---------|-----|
| Platform | **Somo** |
| Voice / receptionist | **Somo front desk** (agentic AI receptionist) |
| RCM / billing | **Somo pay** (revenue cycle management) |
| Tagline | **Somo — never answer business calls again.** |
| Assistant copy (user-facing) | **Somo** (not Kelly, DocLittle, or DodgeCall in UI) |
| Legal / invoices | **Somo** in product UI; registered entity name may differ on contracts — confirm before filing |

## Design tokens

Canonical CSS: [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css)

Legacy `skin-care-tokens.css` re-exports Somo tokens for backward-compatible imports.

### Palette

| Token | Value | Use |
|-------|-------|-----|
| `--somo-green` | `#16a637` | Primary CTA, links, accents |
| `--somo-green-hover` | `#128a2e` | Hover states |
| `--somo-green-soft` | `#e8f7ed` | Soft backgrounds |
| `--somo-ink` | `#0a0a0a` | Marketing dark background |
| `--somo-surface` | `#111111` | Cards on dark |
| `--somo-text` | `#ffffff` | Wordmark on dark |
| `--somo-muted` | `#9ca3af` | Secondary text |

### Typography

| Token | Stack |
|-------|--------|
| `--font-brand` | League Spartan, system-ui, sans-serif |

Wordmark: uppercase **S** + lowercase **omo** (see [`somo_logo_exploration.html`](./somo_logo_exploration.html)).

### Logo assets

| File | Use |
|------|-----|
| `unified-dashboard/assets/brand/somo-logo-wordmark.png` | Full lockup (lizard + wordmark) |
| `unified-dashboard/assets/brand/somo-logo-wordmark.svg` | Vector wordmark |
| `unified-dashboard/assets/brand/somo-icon-lizard.png` | App icon source |
| `favicon-*.png`, `favicon.ico`, `apple-touch-icon.png` | Browser / PWA icons |

## Surface scope

- **Marketing:** Vite app at `/` (`unified-dashboard/dodgecall/`) — dark hero, white wordmark, green CTAs.
- **Provider:** `business/*.html` + `provider-portal.css`.
- **Patient / consumer:** `patients/*.html`, checkout, `littlelab-landing` — Somo green, no Skin & Care lockup.

## Related

- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md) — hostnames and internal names unchanged until somopay.ai
- [somo_logo_exploration.html](./somo_logo_exploration.html) — logo variants and product wordmarks
