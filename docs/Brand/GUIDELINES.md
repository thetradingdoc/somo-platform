# Skin & Care — brand guidelines

> **Last reviewed:** 2026-05-25

## Naming

| Context | Use |
|---------|-----|
| Consumer product | **Skin & Care** (not “Kelly” as the product name) |
| Assistant copy | **Skin & Care assistant** |
| Legal / invoices / receipts | **Doctor Little LLC** where a legal party is required |
| Internal code / env | `KellyAgentService`, `KELLY_*` env vars (implementation names) |

## Design tokens

Canonical CSS: [`unified-dashboard/assets/css/skin-care-tokens.css`](../../unified-dashboard/assets/css/skin-care-tokens.css)

The landing CRA app symlinks the same file: `littlelab-landing/src/skin-care-tokens.css`.

### Palette

| Token | Value | Use |
|-------|-------|-----|
| `--brand-accent` | `#ffa51f` | Primary CTA, highlights |
| `--brand-accent-hover` | `#e8951a` | Hover states |
| `--brand-black` | `#1a1a1d` | Headings, strong text |
| `--brand-gray` | `#48484a` | Secondary text |
| `--brand-white` | `#ffffff` | Surfaces |
| `--brand-border` | `#eee8df` | Dividers |
| `--brand-cream` | `#faf9f6` | Page background |
| `--brand-kelly-bubble` | `#fff8ef` | Assistant chat bubbles |

### Typography

| Token | Stack |
|-------|--------|
| `--font-ui` | Inter, system-ui, sans-serif |
| `--font-display` | Gloock, Georgia, serif |

### Radii and shadows

- `--radius-pill`, `--radius-card`, `--radius-panel`
- `--shadow-nav`, `--shadow-soft`

## Surface scope

- **Skin & Care consumer surfaces:** landing (`littlelab-landing`), patient checkout chat, static patient portal HTML that imports `skin-care-tokens.css`.
- **Provider / admin dashboards:** separate CSS; do not force consumer lockup on legacy admin chrome unless explicitly redesigning that surface.

## Superseded

Older **LittleLab** positioning in [`docs/architecture/README.md`](../architecture/README.md) (branding section) is historical only. Do not use for new Skin & Care work.

## Related

- [User journey surfaces](../user-journey/04-surfaces-and-urls.md)
- [Development CODE_STRUCTURE](../development/README.md#guides-code-structure)
