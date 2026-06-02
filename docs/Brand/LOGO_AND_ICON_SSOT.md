# Somo logo and icon — single source of truth

> **Last reviewed:** 2026-06-01

Read this before changing any logo, favicon, or nav mark in the repo.

## Canonical files (do not invent replacements)

All official raster assets live in **[`unified-dashboard/assets/brand/`](../../unified-dashboard/assets/brand/)**.

| Role | File | Use |
|------|------|-----|
| **Logo** (full lockup) | `somo-logo.png` | Nav, signup cards, login, API signup on light backgrounds — green gecko + “Somo” wordmark |
| **Master / archive** | `somo-logo-master.png` | Same as logo; keep in sync with `somo-logo.png` |
| **Icon** (gecko only) | `somo-icon.png`, `somo-icon-lizard.png` | Favicon source, app icon, dark headers beside typography |
| **Favicon** | `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` | Browser tab |
| **Apple touch** | `apple-touch-icon.png` | iOS home screen |

Regenerate favicon sizes after updating the icon:

```bash
npm run brand:favicons
```

Copy SSOT to API static and marketing public:

```bash
npm run brand:sync
```

## Forbidden in product UI

- **Do not** use text-only `somo-logo-wordmark.svg` or `somo-wordmark-text.svg` as a logo.
- **Do not** build logos from CSS (`<span class="doc">`), inline SVG text, or AI-generated geckos.
- **Do not** use `somo-gecko.svg` for favicon, nav lockup, or signup header (decorative marketing only).
- **Do not** add new logo files under `public/` without updating SSOT first.

## Dark green headers (API profile, docs sidebar)

Use **gecko icon + typography**, not the text-only wordmark:

```html
<div class="logo-brand logo-brand--on-dark">
  <img src="/assets/brand/somo-icon.png" alt="" width="40" height="40" aria-hidden="true" />
  <span class="logo-brand-text">Somo</span>
</div>
```

League Spartan “Somo” beside the official gecko is allowed; inventing a new mark is not.

## Light surfaces (signup card, terms)

```html
<img src="/assets/brand/somo-logo.png" alt="Somo" width="200" height="auto" />
```

## Favicon (all static HTML)

```html
<link rel="icon" href="/assets/brand/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32x32.png" />
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png" />
```

## Related

- [SOMO_GUIDELINES.md](./SOMO_GUIDELINES.md) — naming, colors, typography
- [SOMO_GUIDELINES.md#logo--icon--single-source-of-truth](./SOMO_GUIDELINES.md) — summary in main guide
