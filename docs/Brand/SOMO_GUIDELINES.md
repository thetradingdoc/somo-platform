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



### Palette (marketing landing — light pitch layout)



Used by [`unified-dashboard/somo-landing/`](../../unified-dashboard/somo-landing/). Tokens defined in `somo-tokens.css`, applied via `somo.css` overrides.



| Token | Value | Use |

|-------|-------|-----|

| `--somo-bg-marketing` | `#fbf9f4` | Hero / page background (cream) |

| `--somo-green-marketing` | `#93d33b` | Primary CTA, demo orb, accents |

| `--somo-green-marketing-hover` | `#7fb832` | Hover states |

| `--somo-text-marketing` | `#1a1a1a` | Headlines and body on cream |

| `--somo-muted-marketing` | `#6b6b6b` | Subcopy |



### Typography



| Token | Stack |

|-------|--------|

| `--font-brand` | League Spartan, system-ui, sans-serif |



All marketing headlines and body copy use **League Spartan**. Headlines use weight **700** (hero h1, demo section title). Subcopy uses weight **400**.



Font loading: `@fontsource/league-spartan` in somo-landing (`main.jsx`); other surfaces link fonts in HTML as needed.



Wordmark: gecko lockup PNG in nav; uppercase **S** + lowercase **omo** in vector explorations (see [`somo_logo_exploration.html`](./somo_logo_exploration.html)).



### Logo assets



| File | Use |

|------|-----|

| `somo-landing/public/assets/brand/somo-logo.png` | Nav lockup (gecko + wordmark, transparent) |

| `unified-dashboard/assets/brand/somo-logo-wordmark.png` | Full lockup (legacy path) |

| `unified-dashboard/assets/brand/somo-logo-wordmark.svg` | Vector wordmark |

| `unified-dashboard/assets/brand/somo-icon-lizard.png` | App icon source |

| `favicon-*.png`, `favicon.ico`, `apple-touch-icon.png` | Browser / PWA icons |



## Surface scope



- **Marketing:** Vite app at `/` (`unified-dashboard/somo-landing/`) — **white page** (`#ffffff`), dark ink text, **lime green** CTAs (`#93d33b`), gecko wordmark in nav. Hero layout: [SOMO_LANDING_HERO.md](../deployment/SOMO_LANDING_HERO.md).

- **Provider:** `business/*.html` + `provider-portal.css` — canonical green `#16a637`.

- **Patient / consumer:** `patients/*.html`, checkout — Somo green, no Skin & Care lockup.



## Related



- [INFRA_BRAND_DEFERRAL.md](./INFRA_BRAND_DEFERRAL.md) — hostnames and internal names unchanged until somopay.ai

- [somo_logo_exploration.html](./somo_logo_exploration.html) — logo variants and product wordmarks

