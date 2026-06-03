# Somo landing

Single marketing SPA for **Somo** — served at `http://localhost:4000/` and `https://callsomo.com/` (Firebase Hosting).

**Last Updated:** 2026-05-30

## Dev

```bash
# Same-origin (recommended)
cd unified-dashboard/somo-landing && npm install && npm run build
cd middleware-platform && npm start
# → http://localhost:4000/

# Hot reload (optional)
npm run dev   # http://localhost:5180, proxies /api → :4000
```

## Build

```bash
npm run build
```

Output: `build/` (served from middleware and Firebase Hosting).

## Page sections

| Section | Component | Content |
|---------|-----------|---------|
| Hero | `Hero.jsx`, `TrustBar.jsx`, `ScrollCue.jsx` | Nav, demo CTA, trust bar |
| Capabilities | `CapabilityExplorerSection.jsx` | Horizontal accordion; Image 1 rail |
| How it works | `HowItWorksSection.jsx` | Step tabs + themed panels |
| Demo | `DemoSection.jsx`, `ParticleSphere.jsx` | Live call form + sphere |
| ROI | `RoiSection.jsx` | Old way / new way comparison |
| Pricing | `PricingSection.jsx` | Free (muted) + Practice (hero) tiers |
| Languages | `HipaaLangSection.jsx` | Six languages |
| FAQ | `FaqSection.jsx` | |

Copy: `src/content/landingContent.js`.

## Styles

| File | Scope |
|------|--------|
| `src/styles/somo.css` | Tokens, base, imports; marketing color aliases |
| `src/styles/somo-hero.css` | Nav, hero, buttons, trust bar |
| `src/styles/somo-sections.css` | How it works, ROI, pricing, FAQ, languages |
| `src/styles/capability-explorer.css` | Capability accordion |
| `src/styles/somo-demo.css` | Demo form, floating CTA, footer |
| `src/styles/scroll-cue.css` | Hero scroll indicator |

Hero behavior: [docs/deployment/SOMO_LANDING_HERO.md](../../docs/deployment/SOMO_LANDING_HERO.md).  
Palette: [docs/design/SOMO_MARKETING_COLORS.md](../../docs/design/SOMO_MARKETING_COLORS.md).

## Env

| Variable | Dev (:4000) | Notes |
|----------|-------------|-------|
| `VITE_API_BASE` | empty | Same-origin `/api/public/somo-demo/...` |
| `VITE_SIGNUP_URL` | `http://127.0.0.1:4000/signup?utm_source=somo` | Set in `.env.development` |
| `VITE_LOGIN_URL` | `/login?utm_source=somo` (proxied to :4000 in `npm run dev`) | Provider sign-in |

## E2E

```bash
cd middleware-platform
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright test -c playwright.somo-landing.config.cjs
```

Full runbook: [docs/deployment/SOMO_LANDING.md](../../docs/deployment/SOMO_LANDING.md).
