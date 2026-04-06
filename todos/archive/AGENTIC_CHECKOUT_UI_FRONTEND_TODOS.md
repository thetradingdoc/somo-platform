# Skin & Care — Agentic checkout UI (frontend only)

> **Experience spec level:** product + design blueprint — not only a feature checklist.  
> **Scope:** HTML/CSS/JS, React Native, copy, motion — no API contracts here.  
> **Companion:** [`AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md`](./AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md) (backend / payments).

**North star:** **Chat = primary interface** · **Payment = outcome of conversation** (continuation, not a competing “real” checkout). Target feel: **iMessage + Apple Pay + Glossier** — not hospital portal + chatbot + Stripe form.

---

## Iconography — non-negotiable

- [x] **Use [Heroicons](https://heroicons.com/)** (Tailwind Labs official set, made for Tailwind CSS) — **outline** or **solid** 24px, consistent stroke — for **all UI chrome**: send, close, switch/chevron, lock, shopping-bag adjacency, drawer, etc. — *Done for `unified-dashboard/patients/checkout-chat.html` (paper-airplane, chevron-down, lock-closed, x-mark, shopping-bag); extend same pattern to other agentic surfaces.*
- [x] **Do not** use AI-generated icons, random icon packs, or **emoji** as interactive icons (🐼 in docs = illustrative only; **production UI** uses **logo image asset** `logo-panda.png` where brand requires mascot, **not** emoji). — *No emoji chrome on checkout-chat; landing/panda asset unchanged.*
- [x] **Product photos** from API / landing assets remain the visual for SKUs; icons are for **actions and system affordances** only.

---

## Kelly tone & microcopy (UI contract)

- [x] **Voice:** warm, confident, **non-clinical** — skincare specialist, not a doctor. — *Reflected in `checkout-kelly.json` / `DEFAULT_KELLY_COPY` and assistant copy paths.*
- [x] **Brevity:** short replies by default; longer blocks only for ingredient or routine education. — *UI strings are short; education length handled by agent.*
- [x] **Soft nudges** (examples for copy deck): “If you’re ready, I can get this lined up for you” / “Want me to pull your server-locked total?” — *In `checkout-kelly.json` `softNudges` + first-time sys line.*
- [x] **Emotional states** in copy variants:
  - **First-time:** welcoming, explains what Kelly can do + one line on server-locked price.
  - **Hesitant:** reassuring, no pressure; FAQ-friendly.
  - **Ready-to-buy:** direct, single clear next step (ties to **conversion moments** below).
  — *First-time vs returning via `sysFirstTimeHtml` / `sysReturningHtml` + calm error string; hesitant/ready-to-buy nuance also belongs in agent prompts (see backend doc).*
- [x] Document strings in one place (JSON or `copy/checkout-kelly.md`) so web + app stay aligned. — *Canonical: [`unified-dashboard/copy/checkout-kelly.json`](../unified-dashboard/copy/checkout-kelly.json); human notes: [`unified-dashboard/copy/checkout-kelly.md`](../unified-dashboard/copy/checkout-kelly.md); `checkout-chat.html` loads JSON when served and falls back to inlined `DEFAULT_KELLY_COPY`.*

---

## Speed perception (agentic UX dies if it feels slow)

- [x] **Typing indicator** appears **immediately** on send (within ~100ms) — shimmer or “Kelly is preparing…” — target **<800ms** to first perceived motion. — *`queueTypingIndicator()` (double `requestAnimationFrame`) + `#ccTypingIndicator` row with animated dots + copy `typingIndicator`; removed on first delta/tool status/done/error.*
- [x] **Quote refresh:** optimistic or instant **skeleton** on price line; avoid blank flash after tool completes. — *`setPriceLoading` + `.cc-price--skeleton` shimmer; backup/restore via `data-prev-backup` on failure; quoted line gets pulse.*
- [x] **Product switch:** **immediate** UI update (name, image, price from last known catalog) **before** quote API returns; reconcile when server responds. — *Name + catalog price update synchronously in `switchProduct`; quote reconciles in `fetchQuote` (server-locked line). Product image in header deferred until catalog exposes an image URL.*
- [x] **Streaming:** append tokens without layout jump; stable scroll anchor. — *`.cc-msg-streaming` min-height + `word-break` / `overflow-wrap`; log uses `scrollTop` on append.*

---

## Mobile-first & thumb zone

- [x] **Design at 375px width first**; desktop = **widened mobile**, not a separate layout. — *Single column, `max-width: 640px` centered; base padding tuned for narrow widths; `@media (min-width: 480px)` widens horizontal padding slightly.*
- [x] **Primary actions** (send, in-chat Pay, Switch) sit in **thumb reach** — bottom half of screen; no &lt;44px tap targets. — *`.cc-bottom-dock` stacks composer, send, checkout, links; controls `min-height` ≥ 44px (`cc-btn` 48px, chip/nudge hit areas 44px+).*
- [x] **Composer fixed** above safe-area; no overlap with iOS home indicator. — *Composer + primary actions live in `.cc-bottom-dock` with `padding-bottom: max(0px, env(safe-area-inset-bottom))`; main chat scrolls independently.*

---

## Conversion moments (chat → revenue, intentional)

- [x] After Kelly **answers a product question** → subtle line or chip: “Ready to check out?” (non-blocking). — *`maybeShowConversionChip` when assistant text ≥ 24 chars; chip CTA `chipCheckoutCta` (“Continue”) + `chipReadyCheckout`.*
- [x] After **quote / server-locked price** appears in thread or summary → **highlight** total + one **primary** next step (see **Payment flow**). — *Header price: `.cc-price--highlight` + `cc-price--quoted-pulse`; primary checkout remains footer CTA + chip (in-thread Pay hero still in **Payment flow** section below).*
- [x] After **2+ user turns** without purchase intent → optional gentle nudge (copy + single CTA), throttle so it never nags. — *`#turnNudge` strip; `localStorage` key `checkout_nudge_last_<productId>` min 24h between shows; hidden on checkout intent.*

---

## Payment flow — agentic-first (modal = secondary)

- [x] **Primary path:** Kelly surfaces **`[ Pay $XX.XX securely ]` inside the chat thread** (full-width within bubble column, 44px min height, `#ffa51f`, dark text) when quote + intent are ready — **this is the hero CTA**, not the footer. — *`#btnPayInThread` / `#inThreadPayWrap`; shown when `quoteId` + price (quoted or catalog fallback); styled `.cc-btn-pay-hero`.*
- [x] **Tap** → open **confirmation** (modal with email + trust row) **or** redirect if product policy requires — modal is **confirmation / fallback**, not the first time the user sees “checkout.” — *In-thread Pay + footer tertiary both call `openPayConfirmationModal()`; Stripe redirect unchanged after email.*
- [x] **Footer “Continue to secure checkout”:** remove **or** demote to **tertiary** (“Pay without chat”) so **no competing primary CTAs** (non-negotiable UX rule). — *`#btnCheckout` uses `.cc-btn-tertiary` + copy `payWithoutChat`.*
- [x] **In-thread** explanation before external redirect: “You’ll complete card entry on our secure page.” — *`#inThreadPayNote` + modal `#payRedirectNote`; key `payRedirectNote` in `checkout-kelly.json`.*

---

## P0 — Brand continuity (match `littlelab-landing`)

- [x] **Shared tokens:** `unified-dashboard/assets/css/skin-care-tokens.css` — `--brand-accent: #ffa51f`, `--brand-black`, `--brand-gray`, borders `#eee8df`, cream `#faf9f6` (chat bg), Kelly bubble tint `#fff8ef`.
- [x] **Fonts:** Inter + Gloock per `littlelab-landing/public/index.html`. — *Google Fonts link + `var(--font-ui)` / `var(--font-display)`.*
- [x] **Header bar (see wireframe):** **72px** target height, **white** bg, **1px solid #eee8df** bottom — **no blue gradients**; max **two** chroma families: **amber + neutrals**. — *`.cc-header-bar` + `.cc-header-product`.*
- [x] **Wordmark** “Skin & Care” (Gloock) + **32×32** panda asset + **“Back to shop”** 12px muted link. — *`logo-panda.svg` in `assets/images/`; wordmark `.cc-wordmark`.*
- [x] **`theme-color`:** `#ffa51f`.
- [x] **`<title>`:** `Skin & Care — Checkout`.
- [x] **Back to shop** → configured landing base URL. — *`window.LANDING_BASE` resolver in [`config.js`](../unified-dashboard/assets/js/config.js); `applyKellyCopy` sets `href` when present; static fallback `../littlelab-landing/public/index.html`.*

---

## P0.5 — Premium parity

- [x] **Product strip** (see wireframe): **88px** row — **64×64** image, **12px** radius, name, server-locked price, **Switch** pill **32px** height. — *`.cc-product-strip`, `#productStripImg`, `#btnProductSwitch`.*
- [x] **Favicon / apple-touch-icon** aligned with landing. — *`../assets/images/favicon.svg` (amber + panda mark) on `checkout-chat.html` + `payment-success.html`.*
- [x] **Trust row** in modal: Visa / MC / Amex marks + lock copy. — *`.cc-pay-marks` + `.cc-modal-trust-line` (lock + Stripe copy).*
- [x] **Success page** Skin & Care shell + return to shop. — *`payment-success.html`: tokens, fonts, wordmark/panda, cream bg, **Return to shop** / **Back to shop** use `window.LANDING_BASE` when set.*
- [x] **Empty state:** brand **photography** (panda logo asset + optional bottle **photo**) + Heroicon accent — **no** AI-generated illustration. — *`#chatEmptyState`: SVG panda, CSS bottle silhouette, Heroicon sparkles; copy `chatEmptyHint` in JSON.*

---

## P1 — Layout spec (375px wireframe)

Reference **width 375px**, ~800px scroll; **desktop** scales width, same vertical rhythm.

| Zone | Target | Notes |
|------|--------|--------|
| Safe area | top + bottom | iOS `env(safe-area-inset-*)` |
| **Header** | **72px**, 16px horizontal padding | Panda + wordmark + back link |
| **Product strip** | **88px**, 12px padding | Image + title + price + Switch |
| **Chat** | **~55–60vh** flex | Background `#faf9f6` |
| **Composer** | **72px** fixed | 44px pill input + 44px circular send (Heroicon arrow) |

- [x] **User bubble:** right, white, **1px #eee8df**, radius **14px**, max width **85%**.
- [x] **Kelly bubble:** left, bg **`#fff8ef`**, radius **14px**, max width **85%**.
- [x] **Order summary** (optional card): 12px padding, 12px radius, 13–14px type, border `#eee8df`. — *`.cc-order-summary` wraps in-thread pay.*
- [x] **Switch drawer:** bottom sheet, rows **64px**, **48×48** thumbs, 12–16px padding. — *`#productSwitchSheet` + `.cc-sheet-row` / `.cc-sheet-thumb`.*

---

## P2 — Product switching

- [x] Bottom **drawer** with thumb + name + price (replaces `<select>`). — *`#productSwitchSheet` rows; `<select>` kept for a11y sync only (`cc-sr-only`, no `onchange` UX).*
- [x] Optional confirm on switch. — *Confirm block in sheet; “Don’t ask again this session” → `sessionStorage` `cc_skip_product_switch_confirm`.*
- [x] Skeletons + errors with link to shop. — *Strip `is-loading` shimmer; `#loadErr` branded card + Heroicon + **Back to shop** (`LANDING_BASE`).*

---

## P3 — Chat thread

- [x] Welcome / returning copy (see **Kelly tone**). — *`sysFirstTimeHtml` / `sysReturningHtml` via `applyKellyCopy` + `checkout-kelly.json`.*
- [x] Streaming + tool status; no duplicate assistant bubble on `done`. — *Composer status row + arrow-path icon for tool status; `doneHandled` dedupes; stream fallback updates same bubble instead of duplicating; partial stream bubble removed before error card.*
- [x] **Conversion** affordances (see **Conversion moments**). — *Unchanged: chip + turn nudge + in-thread pay (see sections above).*
- [x] Errors: branded card + Heroicon **exclamation** or **arrow-path** — not raw text only. — *Connection failure → `.cc-msg-error-card` + triangle icon; tool line uses arrow-path in status row.*

---

## P4 — Pay modal (secondary path)

- [x] **90%** width, max **420px**, **16px** radius, **20px** padding. — *`.cc-modal` `width: 90%`, `max-width: 420px`, `border-radius: 16px`, `padding: 20px`.*
- [x] Title **18px** bold; total **16px** bold; email **48px** height; primary button **48px**, `#ffa51f`. — *`.cc-modal-title-row` / `.cc-total`; `.cc-input` `min-height: 48px`; `#btnPayStripe` `.cc-btn-pay-modal-primary`.*
- [x] Trust row + **Heroicon** `lock-closed` beside “Secure checkout” copy where appropriate. — *Modal title + trust line use lock outline paths; Stripe copy in `#payTrustText`.*

---

## P5 — Landing handoff

- [x] Ask link: query preservation + click loading state. — *`buildAskAboutProductUrl` preserves query; Ask link shows **Opening…** + `is-busy` while navigating.*
- [x] Optional bridge screen with logo. — *`bridge=1` on return URL → `#ccBridgeOverlay` (~900ms) on `checkout-chat.html`; copy in JSON `bridgeMessage`.*
- [x] Ask vs Buy legend when `CHAT_FIRST_CHECKOUT` on. — *`.solutions-ask-buy-legend` under catalog controls on `littlelab-landing`.*

---

## P6 — Patient app

- [x] Same tokens, thumb zone, in-chat Pay primary. — *`constants/skinCareTokens.ts`; 48px targets; amber **Pay $X securely** + lock icon; tertiary **Pay without chat**; pay modal.*
- [x] **Heroicons** via `@heroicons/react` / mirrored SVGs for parity with web. — *`patient-app/components/CheckoutHeroicons.tsx` (`react-native-svg` paths, no web-only package).*
- [x] Fix **`KELLY_QUOTE_KEY`** constant. — *`doclittle_kelly_commerce_quote_v1` in `checkout-chat.tsx` (SecureStore get/set).*
- [x] Product images in drawer. — *`expo-image` thumbs in product picker modal + header strip when URL present.*

---

## P7 — Accessibility

- [x] WCAG AA on amber-on-white; focus rings. — *Amber `#ffa51f` on buttons with dark text; `:focus-visible` rings on main controls in `checkout-chat.html`.*
- [x] `aria-live` for price + messages. — *Existing `#productPrice` / `#chatLog`; RN price `accessibilityLiveRegion`.*
- [x] **375px and 320px** smoke tests. — *Checklist: [`docs/testing/AGENTIC_CHECKOUT_A11Y_SMOKE.md`](../docs/testing/AGENTIC_CHECKOUT_A11Y_SMOKE.md).*
- [x] `prefers-reduced-motion`. — *Web: reduce shimmer / typing / quote pulse in `checkout-chat.html`.*

---

## P8 — Analytics

- [x] `agentic_primary` vs `manual_checkout_click` vs `in_chat_pay_tap`. — *`dataLayer` / `emitFunnelEvent` in `checkout-chat.html`. RN: `patient-app/lib/checkoutAnalytics.ts` (`emitCheckoutAnalytics`, `DeviceEventEmitter` `checkout-funnel`, optional `__checkoutAnalyticsSink`; dev-only console in `__DEV__`).*
- [x] Optional “Why this price?” disclosure. — *`<details id="whyPriceDetails">` + `whyPriceSummary` / `whyPriceBody` in JSON.*

---

## P9 — Design system hygiene

- [x] Canonical asset paths + env vars documented. — *[`docs/architecture/SKIN_CARE_TOKENS_AND_ASSETS.md`](../docs/architecture/SKIN_CARE_TOKENS_AND_ASSETS.md).*
- [x] `skin-care-tokens.css` import rule for new Skin & Care surfaces. — *Same doc + comment header in `skin-care-tokens.css`.*

---

## Key UX rules (checklist)

- [x] **No competing primary CTAs** — chat-led pay wins; footer checkout demoted or removed. — *Web + RN: in-thread Pay hero + tertiary without chat.*
- [x] **No clinical blue** in Skin & Care mode; **amber + neutrals** only. — *RN checkout restyled; web unchanged.*
- [x] **Immediate feedback** on send, switch, and quote. — *Quote loading / `fetchQuote` / stream fallback.*
- [x] **Mobile-first always** — 375px baseline. — *Web column + RN single column.*

---

## Done = definition

- [x] Brand, typography, **Heroicons**, and motion match **Skin & Care** landing tier. — *Within web + RN parity scope above.*
- [x] User completes purchase **from conversation** with **in-thread Pay** as the main path. — *Hero Pay + modal confirmation.*
- [x] **Modal** feels like **confirmation**, not the start of checkout. — *Unchanged web modal; RN pay sheet.*

---

## File map

| Surface | File |
|---------|------|
| Web checkout | `unified-dashboard/patients/checkout-chat.html` |
| Tokens | `unified-dashboard/assets/css/skin-care-tokens.css` |
| RN tokens | `patient-app/constants/skinCareTokens.ts` |
| RN Heroicons (mirrored) | `patient-app/components/CheckoutHeroicons.tsx` |
| Landing reference | `littlelab-landing/src/styles.css`, `src/index.js` |
| Success | `middleware-platform/public/payment/success.html` |
| Native | `patient-app/app/checkout-chat.tsx` |
| Icons | [Heroicons](https://heroicons.com/) — web SVG / RN `react-native-svg` paths |
