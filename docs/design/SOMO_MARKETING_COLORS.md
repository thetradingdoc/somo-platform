# Somo marketing colors

> **Superseded by:** [SOMO_COLORS.md](./SOMO_COLORS.md) — use that doc for the unified blue palette.

**Last updated:** 2026-06-25

This file documents marketing-specific component mapping. All hex values now use the unified blue palette (`#1C35EA` primary, `#000000` headlines).

## Core swatches

| Name | CSS variable | Hex | Use |
|------|----------------|-----|-----|
| Ink | `--somo-msu` | `#000000` | Headings, dark pills, icons on light surfaces |
| Primary | `--somo-lizard` | `#1C35EA` | CTAs, accents, active states, sphere |
| Primary hover | `--somo-lizard-hover` | `#1529C4` | Button/link hover |
| Secondary emphasis | `--somo-grass` | `#1529C4` | Secondary emphasis, medium pill tier |
| Soft 10% | `--somo-lizard-10` | `#EEF0FE` | Inactive capability strips, light pills |
| Soft 20% | `--somo-lizard-20` | `#E8EBFD` | Hover on light surfaces |
| White | `--somo-bg` (landing) | `#ffffff` | Page and active panels |

## Gradients

- **Capability rail:** `--somo-rail-gradient` — `linear-gradient(180deg, #1C35EA 0%, #1529C4 55%, #000000 100%)`

## Source of truth

Defined in [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css).
