# Somo brand — manual QA matrix

Run after brand changes; production host may still be **myskinandcare.com**.

| Surface | URL (local :4000) | Check |
|---------|-------------------|--------|
| Marketing | `/` | Somo wordmark, green hero `#16a637`, tagline “never answer business calls again”, lizard favicon |
| Provider login | `/business/login.html` | Somo branding, green CTAs, no legacy names |
| RCM | `/business/rcm.html` | Provider shell “Somo”, green accents |
| Patient wallet | `/patients/wallet.html` | Somo colors, no Skin & Care |
| Signup terms | `/public/signup/terms.html` | Party name Somo, green header |
| Privacy | `/public/signup/privacy.html` | Somo privacy policy |
| PWA manifest | `manifest.webmanifest` | `name` Somo, `theme_color` `#16a637` |

**Automated:** `npm run check:brand` from repo root.

**E2E:** `npm run test:e2e-dodgecall` (Somo hero), Playwright `landing-pipeline` / `provider-rcm` as applicable.
