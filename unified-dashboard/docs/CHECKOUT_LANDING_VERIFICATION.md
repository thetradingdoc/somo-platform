# Checkout ↔ landing — manual verification (process)

Use this when validating **Skin & Care** landing → **checkout-chat** after changes to catalog, rate limits, or UI.

## 17. Short manual checklist

**Prereqs:** API running (e.g. middleware on `:4000`), landing reachable (e.g. CRA `:3000` or built `public/index.html`), `REACT_APP_MERCHANT_ID` set on non-localhost if you need `provider_id` on links.

### Happy path — catalog up

1. Open the landing **products** section.
2. Tap the **checkout-in-chat** (cart) icon on a serum card.
3. On checkout, confirm within a few seconds:
   - **Hero title** shows the **product name** (not stuck on “Loading…”).
   - **Strip image** shows when the API or `product_image` query has a URL (non-blank when assets resolve).
   - **Price line** shows server/quoted pricing (a **non-zero** checkout path: quote/cart can proceed when merchant + product resolve).
   - **Cart** shows line items/subtotal after catalog succeeds; with catalog down, subtotal shows **—** and a short **cart sync** message (not a silent **$0.00** as the only signal).
4. Optional: **Back to shop** returns to the landing.

### Degraded path — catalog down

Simulate failure (pick one): DevTools **Offline**, block `*public/products*`, or force **429** until retries exhaust.

5. Confirm the hero **does not** stay on default **“Loading…”**:
   - Title uses **`product_name`** from the URL when present.
   - **Price** line explains catalog unavailable / retry (placeholder copy).
   - **Alert** shows explicit **rate limit** or **unavailable** messaging (not a blank shell).
   - **Retry catalog** is visible; after restoring network, **Retry** reloads catalog successfully when the API recovers.

### Deep-link sanity (Buy now / icon)

6. The landing icon sends **`product_id`**, **`product_name`**, optional **`product_image`**, optional **`provider_id`**. If the catalog request fails, the page should still **hydrate the hero from query params** so a correct link does not look “broken.”

---

## 18. Reviewing screenshots (keep **D** in mind)

When comparing checkout screenshots to the **marketing landing**:

- **Failure states** (catalog 429, offline, missing merchant) are **not** the same as **final visual design**. Empty cart, placeholder price, or error banners may reflect **data/API**, not unfinished chrome.
- Judge **layout, typography, orange primary, header wordmark, and chat-first hierarchy** on a **healthy catalog** run first.
- Then judge **degraded UX** separately: readable name, image hint, retry, and copy — not whether the page matches the hero while the API is denying requests.

---

## Automation pointer

Static checks + condensed browser steps:

```bash
node middleware-platform/scripts/smoke-checkout-hero-degraded.cjs
```

### Optional Playwright (hero not “Loading…” on 429)

Requires a running HTTP origin that serves `unified-dashboard/patients/` (path may differ per deploy).

```bash
cd middleware-platform
npm install
npx playwright install chromium
CHECKOUT_E2E_BASE_URL=http://127.0.0.1:4000 npm run test:e2e-checkout
```

---

## Cross-surface parity (follow-ups implemented in-repo)

| Surface | Catalog 429 retry | Degraded name / image hints | Notes |
|--------|-------------------|-----------------------------|--------|
| `checkout-chat.html` | Yes | Yes (`product_name`, `product_image`, id map) | Cart panel shows **—** + copy until catalog succeeds; `cart_bootstrap` runs only after catalog OK. |
| `patient-app/.../checkout-chat.tsx` | Yes | Yes (deep link params + id map) | **Retry catalog** button; catalog fetch works **without** `provider_id` (server default tenant). |
| `middleware-platform/public/customer/storefront.html` | Yes | N/A (grid, not hero) | Single `/api/public/products` fetch; **Retry catalog**; product images use `API_BASE` + relative paths. |

**Server default merchant:** `resolveMerchantId` in `public-commerce-helpers.js` reads **query + body**, then subdomain/DB default, then optional env **`PUBLIC_CATALOG_DEFAULT_PROVIDER_ID`**.

**Usage DB:** `usageLogger` is mounted on **`/public/`** as well as **`/api/`**; logged **`endpoint`** normalizes `/public/products` → `/api/public/products` (and same for prescriptions/commerce) so analytics dedupe with primary routes.

**External duplicates:** Proxies or old clients outside this repo can still hit multiple URL shapes; in-repo clients use one canonical path per load.
