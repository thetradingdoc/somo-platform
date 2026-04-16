# Skin & Care — tokens, assets, and env (frontend)

## CSS tokens (web)

- **Canonical file:** `unified-dashboard/assets/css/skin-care-tokens.css`
- **Import rule for new HTML surfaces:** link global + tokens after charset/viewport, before page-specific CSS:

```html
<link rel="stylesheet" href="../assets/css/global.css" />
<link rel="stylesheet" href="../assets/css/skin-care-tokens.css" />
```

Use variables such as `var(--brand-accent)`, `var(--brand-cream)`, `var(--font-ui)` — do not introduce clinical blue for Skin & Care checkout.

## React Native parity

- **Constants:** `patient-app/constants/skinCareTokens.ts` mirrors the same hex values as `skin-care-tokens.css` for checkout and related native screens.

## Env vars (patient app)

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_BASE_URL` | Middleware base URL (required on device) |
| `EXPO_PUBLIC_MERCHANT_ID` | `provider_id` for public catalog / quote APIs |
| `EXPO_PUBLIC_DEMO_PRODUCT_ID` | Default product when opening checkout chat |
| `EXPO_PUBLIC_DEMO_PATIENT_EMAIL` | Optional login hint |

See `patient-app/.env.example` and `patient-app/config.ts`.

## Env vars (web / landing)

| Variable | Purpose |
|----------|---------|
| `REACT_APP_MERCHANT_ID` | Merchant id on littlelab-landing catalog |
| `REACT_APP_PATIENT_PORTAL_PREFIX` | Patient HTML base path |
| `REACT_APP_CHAT_FIRST_CHECKOUT` | `false` to hide Ask-first CTA |

## Brand assets

- Panda / favicon: `unified-dashboard/assets/images/` (e.g. `logo-panda.svg`, `favicon.svg`)
- Landing media: `unified-dashboard/littlelab-landing/public/images/`

## Related

- **[Landing Try now & LiveKit](./LANDING_TRY_NOW_LIVEKIT.md)** — camera-first voice page, orb PiP, `REACT_APP_API_BASE`, LiveKit token flow
