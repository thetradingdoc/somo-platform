# Somo — brand guidelines



> **Last reviewed:** 2026-06-01



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

Used by [`unified-dashboard/somo-landing/`](../../unified-dashboard/somo-landing/). **Canonical table:** [`docs/design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md). Tokens in `unified-dashboard/assets/css/somo-tokens.css`; landing overrides in `somo-landing/src/styles/somo.css` (`--somo-green` → lizard).

| Token | Value | Use |
|-------|-------|-----|
| `--somo-lizard` | `#b5e930` | Primary CTA, demo sphere, progress accents |
| `--somo-msu` | `#164437` | Headings, dark pills, free-tier emphasis |
| `--somo-grass` | `#238108` | Capability panel titles (assist step) |
| `--somo-lizard-10` / `--somo-lizard-20` | `#f4fbe8` / `#e8f7d0` | Capability strips, hovers |
| `--somo-bg` (landing) | `#ffffff` | Page and active capability panel |
| `--somo-text-marketing` | `#1a1a1a` | Body on light surfaces |

Legacy `#93d33b` is **not** the current marketing CTA color.



### Typography



| Token | Stack |

|-------|--------|

| `--font-brand` | League Spartan, system-ui, sans-serif |



All marketing headlines and body copy use **League Spartan**. Headlines use weight **700** (hero h1, demo section title). Subcopy uses weight **400**.



Font loading: `@fontsource/league-spartan` in somo-landing (`main.jsx`); other surfaces link fonts in HTML as needed.



Wordmark: gecko lockup PNG in nav; uppercase **S** + lowercase **omo** in vector explorations (see [`somo_logo_exploration.html`](./somo_logo_exploration.html)).



### Logo & icon — single source of truth

**Read first:** [LOGO_AND_ICON_SSOT.md](./LOGO_AND_ICON_SSOT.md). **Sync command:** `npm run brand:sync` (copies from `unified-dashboard/assets/brand/` to API static and somo-landing public).

| Role | File | Use |
|------|------|-----|
| **Logo** | `unified-dashboard/assets/brand/somo-logo.png` | Nav, signup, login — official gecko + wordmark (PNG only) |
| **Icon** | `somo-icon.png`, `somo-icon-lizard.png` | Favicon source, dark headers, app icon |
| **Favicon** | `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` | Browser / PWA |

**Forbidden in product UI:** text-only `somo-logo-wordmark.svg`, CSS `<span>` brand marks, invented gecko SVGs for nav/favicon, DocLittle / Skin & Care lockups. `somo-gecko.svg` is decorative (marketing “how it works”) only.

**Deprecated (do not use in UI):** `somo-logo-wordmark.svg`, `somo-wordmark-text.svg` — League Spartan text without the official gecko lockup.



## Surface scope



- **Marketing:** Vite app at `/` (`unified-dashboard/somo-landing/`) — white page, Image 1 lizard CTAs (`#b5e930`), MSU headings, gecko in nav. Sections: hero, capabilities explorer, how-it-works, live demo + sphere, ROI, pricing, languages, FAQ. Docs: [SOMO_LANDING.md](../deployment/SOMO_LANDING.md), [SOMO_MARKETING_COLORS.md](../design/SOMO_MARKETING_COLORS.md), [SOMO_LANDING_HERO.md](../deployment/SOMO_LANDING_HERO.md). Legacy Kelly/LiveKit CRA: `_archive/littlelab-landing/`.

- **Provider:** `business/*.html` + `provider-portal.css` — canonical green `#16a637`.

- **Patient / consumer:** `patients/*.html`, checkout — Somo green, no Skin & Care lockup.



## Related

- [LOGO_AND_ICON_SSOT.md](./LOGO_AND_ICON_SSOT.md) — mandatory logo vs icon vs favicon paths
- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md) — hostnames and internal names unchanged until somopay.ai
- [somo_logo_exploration.html](./somo_logo_exploration.html) — logo variants and product wordmarks

