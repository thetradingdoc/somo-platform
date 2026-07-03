# Somo colors

**Last updated:** 2026-06-25

Canonical palette for all Somo surfaces — marketing, provider portal, patient/consumer, health video, admin, and transactional email.

**CSS source of truth:** [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css)

## Core swatches

| Name | CSS variable | Hex | Use |
|------|----------------|-----|-----|
| Primary blue | `--somo-primary` | `#1C35EA` | CTAs, links, progress, `theme_color` |
| Primary hover | `--somo-primary-hover` | `#1529C4` | Button/link hover |
| Primary soft | `--somo-primary-soft` | `#EEF0FE` | Badges, icon wells, soft strips |
| Primary mid | `--somo-primary-mid` | `#C5CCFA` | Active borders, step rings |
| Ink (headlines) | `--somo-ink` | `#000000` | Headlines on light UI |
| Body text | `--somo-text-marketing` | `#1a1a1a` | Body on light surfaces |
| Muted | `--somo-muted-marketing` | `#6b6b6b` | Secondary text |
| White | — | `#ffffff` | Page and card backgrounds |
| Dark ink | `--somo-ink` (dark chrome) | `#0a0a0a` | Live session, dark surfaces |
| Dark surface | `--somo-surface` | `#111111` | Cards on dark |

## Gradients

- **Brand CTA / hero:** `linear-gradient(135deg, #1C35EA 0%, #1529C4 100%)`
- **Capability rail (marketing):** `--somo-rail-gradient` — `linear-gradient(180deg, #1C35EA 0%, #1529C4 55%, #000000 100%)`
- **Email header:** `linear-gradient(135deg, #000000 0%, #1C35EA 100%)`

## Contrast rules

- On white or `--somo-primary-soft`: body `#1a1a1a`, headlines `--somo-ink` (`#000000`)
- On `--somo-primary`: text/icons `#ffffff`
- On dark surfaces (`#0a0a0a`): text `#ffffff`, accents `--somo-primary`

## Semantic colors (not brand)

Keep separate from primary blue:

| Use | Example |
|-----|---------|
| Success / paid / OK | `#16a34a`, `#48bb78` |
| Warning | `#d97706` |
| Danger | `#dc2626` |
| Info | `#4299e1` |

## Deprecated tokens

Do not use in new code — aliases exist in `somo-tokens.css` for backward compatibility:

| Deprecated | Replaced by |
|------------|-------------|
| `--somo-green` | `--somo-primary` |
| `--somo-lizard` | `--somo-primary` |
| `--somo-msu` | `--somo-ink` |
| `--somo-grass` | `--somo-primary-hover` |

## Related

- [SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md) — naming, typography, surface scope
- [SOMO_MARKETING_COLORS.md](./SOMO_MARKETING_COLORS.md) — legacy marketing component mapping (being consolidated here)
