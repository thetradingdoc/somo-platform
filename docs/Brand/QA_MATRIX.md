# Somo brand — manual QA matrix

**Last Updated:** 2026-05-30

Run after brand changes; production host may still be **myskinandcare.com**.

| Surface | URL (local :4000) | Check |
|---------|-------------------|--------|
| Marketing landing | `/` | Somo gecko wordmark; hero on white; lizard CTA `#b5e930` (not legacy `#93d33b`); MSU `#164437` on headings/pills; capability panels without gray taglines under tab labels; muted free pricing card + single lizard primary on Practice |
| Provider login | `/login` or `/business/login.html` | Somo branding, product green `#16a637` CTAs |
| RCM | `/business/rcm.html` | Provider shell “Somo”, green accents |
| Patient wallet | `/patients/wallet.html` | Somo colors, no Skin & Care |
| Signup terms | `/public/signup/terms.html` | Party name Somo, green header |
| Privacy | `/public/signup/privacy.html` | Somo privacy policy |
| PWA manifest | `manifest.webmanifest` | `name` Somo, `theme_color` `#16a637` (product) |

**Automated:** `npm run check:brand` from repo root.

**E2E:** `npm run test:e2e-somo-landing --prefix middleware-platform` (Somo hero, capabilities, pricing hierarchy).

**Palette SSOT:** [`docs/design/SOMO_MARKETING_COLORS.md`](../design/SOMO_MARKETING_COLORS.md).
