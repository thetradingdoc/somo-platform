# Somo landing — hero section

Marketing hero at `/` (`unified-dashboard/somo-landing/`). Styles: `src/styles/somo-hero.css` (imported via `somo.css`).

## Structure

| Piece | Component / class |
|-------|-------------------|
| Nav | `Hero.jsx` → `.somo-nav`, `.somo-nav-cta` |
| Copy | `.somo-hero-copy` (badge, h1, sub, CTAs, checks) |
| Phone | `.somo-hero-visual` → `hero-phone-v2.jpg` |
| Trust bar | `TrustBar.jsx` → `.somo-hero-trust` |

## Assets

| File | Use |
|------|-----|
| `public/assets/brand/somo-logo.png` | Nav lockup |
| `public/assets/brand/hero-phone-v2.jpg` | Hero phone + language orbit (1024×858) |
| `public/assets/brand/trusted/*.svg` | Trust bar logos |

Preloaded in `index.html`: logo + hero phone.

## Desktop (≥961px)

- Hero background: **white** (`#ffffff`). Page body matches.
- Hero fills **one viewport** (`min-height` / `max-height: 100dvh`); demo section is below the fold.
- Grid: ~`0.88fr` copy / `1.12fr` visual (`1.14fr` visual at ≥1280px).
- Phone scales to **100% height** of the grid row (`object-fit: contain`), clipped inside `.somo-hero-visual` so it does not overlap the trust bar.
- Nav: larger logo (68px) and “Try for $0” pill.

## Mobile (≤960px)

- Stacked grid; hero height is **auto** (scroll to demo + trust).
- Checks and trust logos: single centered rows.

## Copy (current)

- Headline: “Never answer business calls again.”
- Sub: “Somo is your smartest assistant. It answers calls, books appointments, and handles billing so you can focus on what matters.”
- Hero CTAs: “Try live demo” (scroll to `#demo`), “Sign Up” (`VITE_SIGNUP_URL`).
- Nav CTA: “Try for $0” (signup).

## Local preview

```bash
cd unified-dashboard/somo-landing && npm run build
cd middleware-platform && npm run start:landing
# http://localhost:4000/
```

Or `npm run dev:landing:ui` → http://localhost:5180 (rebuild or HMR for CSS).

## Related

- [SOMO_LANDING.md](./SOMO_LANDING.md) — dev, env, deploy
- [../Brand/SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md) — tokens and palette
