# Provider portal shell

> **Last reviewed:** 2026-06-03

Canonical chrome for `unified-dashboard/business/*.html`. Today and Calendar are on this shell; other business pages migrate incrementally.

## HTML skeleton

```html
<body class="provider-portal">
  <button type="button" class="pp-mobile-toggle" id="ppMobileToggle" aria-label="Open menu">…</button>
  <div class="pp-app">
    <aside class="pp-sidebar" id="ppSidebar">…</aside>
    <div class="pp-main">
      <header class="pp-topbar pp-topbar--page">…</header>
      <main class="pp-content" id="ppMainContent">…</main>
    </div>
  </div>
</body>
```

Legacy pages may ship only `<main class="main-content">` and call `mountProviderPage()` from [`provider-layout.js`](../../unified-dashboard/assets/js/provider-layout.js) to inject the shell at runtime.

## Required scripts

| Script | Role |
|--------|------|
| `config.js` | API base |
| `auth-utils.js` | Session |
| `provider-shell.js` | Nav, badges, Kelly, `initProviderShell` |
| `provider-shell-chrome.js` | Gecko sidebar header + Kelly widget |
| `provider-layout.js` | `mountProviderPage()` for legacy pages |

Styles: [`somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css) + [`provider-portal.css`](../../unified-dashboard/assets/css/provider-portal.css).

## Page header (topbar)

Use `pp-topbar--page` with this structure:

```html
<header class="pp-topbar pp-topbar--page">
  <div class="pp-topbar-left">
    <p class="pp-page-eyebrow" id="ppPageEyebrow">Schedule</p>
    <h1 class="pp-page-title" id="ppPageTitle">Page title</h1>
    <p class="pp-page-sub" id="ppPageSub">Optional subtitle</p>
  </div>
  <div class="pp-topbar-right">…actions…</div>
</header>
```

### Typography scale

| Element | Class | Size | Weight |
|---------|--------|------|--------|
| Eyebrow | `pp-page-eyebrow` | 10px | 700, uppercase |
| Page title | `pp-page-title` | **28px** | 700 |
| Page subtitle | `pp-page-sub` | 14px | 400 |
| Panel title | `pp-panel-title` | 13px | 700 |
| Panel sub | `pp-panel-sub` | 10.5px | 400 |

Today sets the title via `#ppHeroGreeting` (same `pp-page-title` class) using `ppGreetingName()`.

### `mountProviderPage` options

```js
mountProviderPage({
  activeId: 'calendar',
  eyebrow: 'Schedule',
  title: 'Appointments calendar',
  subtitle: 'View and manage bookings from the AI front desk',
  topbarActions: '<a class="pp-btn pp-btn-primary pp-btn-sm" href="…">…</a>'
});
```

## Content toolbar

Secondary filters/actions below the topbar (e.g. Calendar): `div.pp-toolbar`, not a second page title card.

## Buttons and color

- Use `pp-btn`, `pp-btn-primary`, `pp-btn-outline`, `pp-btn-ghost`, `pp-btn-link`, `pp-btn-sm`
- Primary CTA: `var(--somo-green)` (`#16a637`) — no per-page `#10b981` overrides

## Anti-patterns

- **Never remove shell `<script>` tags** from pages that call `mountProviderPage()` or `initProviderShell()` (e.g. `config.js`, `auth-utils.js`, `provider-shell.js`, `provider-shell-chrome.js`, `provider-layout.js`)
- Copying `.layout` / `.sidebar` / `.page-header` CSS into each HTML file
- In-content `h1.page-title` at 28px **and** a mounted `pp-topbar` (duplicate headers)
- Text-only or invented logo marks (see [SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md))

## Rollout inventory

| Status | Pages |
|--------|--------|
| **Migrated** | `today.html`, `calendar.html`, `agent.html`, `patients.html`, `patient-payments.html` (static `pp-app` + `initProviderShell`) |
| **Runtime mount** | `claims.html`, `billing.html`, `settings.html`, `rcm.html`, … |
| **Follow-up** | Remove inline legacy sidebar CSS from mounted pages; adopt `pp-topbar--page` everywhere |

### Patient navigation

| Page | Purpose |
|------|---------|
| `patients.html` | FHIR roster — search, filters, KPIs; card click opens case |
| `patient-payments.html` | RCM payment requests and totals (not the roster) |
| `patient-case.html?patient_id=` | Case timeline and billing context for one patient |

Links from calendar/Today search → `patients.html`; roster and payments tables link → `patient-case.html` when a patient ID is known.

## Related

- [PROVIDER_TODAY_PAGE.md](./PROVIDER_TODAY_PAGE.md) — Today-specific layout and KPI grid
- [SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md) — brand on provider surfaces
- E2E: `middleware-platform/e2e/provider-portal-shell.spec.cjs`, `provider-today-portal.spec.cjs`
