# Somo marketing colors (Image 1)

**Last Updated:** 2026-05-30

Canonical palette for the Somo landing, signup wizard, and related light marketing surfaces. Product/app UI continues to use `--somo-green` (`#16a637`) in `somo-tokens.css`.

## Core swatches

| Name | CSS variable | Hex | Use |
|------|----------------|-----|-----|
| MSU Green | `--somo-msu` | `#164437` | Headings, dark pills, icons on light surfaces |
| Green Lizard | `--somo-lizard` | `#b5e930` | CTAs, accents, active states, sphere |
| Lizard hover | `--somo-lizard-hover` | `#9fd628` | Button/link hover |
| Grass | `--somo-grass` | `#238108` | Secondary emphasis, medium pill tier |
| Lizard 10% | `--somo-lizard-10` | `#f4fbe8` | Inactive capability strips, light pills |
| Lizard 20% | `--somo-lizard-20` | `#e8f7d0` | Hover on light surfaces |
| White | `--somo-bg` (landing) | `#ffffff` | Page and active panels |

## Gradients

- **Capability rail:** `--somo-rail-gradient` — `linear-gradient(180deg, #b5e930 0%, #238108 55%, #164437 100%)`

## Contrast rules

- On white or `lizard-10`: body text `#1a1a1a`, emphasis `--somo-msu`
- On `--somo-lizard`: text/icons `--somo-msu`
- On `--somo-msu` or `--somo-grass`: text/icons `#ffffff` or `--somo-lizard` (large type)
- Avoid gray-on-gray pills; use tier colors from this palette

## Component mapping

| Component | Tokens |
|-----------|--------|
| Hero CTAs | `--somo-lizard`, `--somo-lizard-hover` |
| Capabilities (inactive strip) | `--somo-lizard-10`, `--somo-cap-border` |
| Capabilities (active panel) | Rail: `--somo-rail-gradient`; header: **label** + grass **seoTitle** only (no subtitle tagline) |
| Demo sphere | `--somo-lizard`, `--somo-grass`, `--somo-msu` |
| Demo persona pills | light / medium / dark tiers + active lizard |
| How it works panels | `data-theme`: **setup** (lizard-10, MSU title), **assist** (grass border/title, lizard gradient), **control** (lizard border + outer ring via `box-shadow`, lizard-20 → white gradient) |
| Pricing — Free trial | White card, MSU top border, `.somo-pricing-badge-start`, CTA `.somo-btn-free` |
| Pricing — Practice (hero) | `.somo-pricing-card-popular`, 2px lizard border, lizard shadow; sole `.somo-btn-primary` in the pricing grid |
| How it works | Per-step `data-theme` on active panel (setup / assist / control) |
| ROI section | Old way (rose) vs new way (lizard) + savings column |
| Scroll cue | Hero mouse indicator; hidden on mobile and `prefers-reduced-motion` |

On the landing SPA, legacy aliases in `somo-landing/src/styles/somo.css` map `--somo-green` → lizard and `--somo-green-dark` → MSU so older class names still resolve to Image 1.

## Source of truth

Defined in [`unified-dashboard/assets/css/somo-tokens.css`](../unified-dashboard/assets/css/somo-tokens.css) under the marketing block. Landing imports via [`somo-landing/src/styles/somo.css`](../business/trial-activation portal/src/styles/somo.css).
