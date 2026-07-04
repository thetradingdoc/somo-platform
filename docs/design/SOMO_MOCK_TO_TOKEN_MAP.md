# Somo mock → token mapping

> **Last reviewed:** 2026-06-30  
> **Source mock:** `somo-screen-designs.html` (26 frames)  
> **Brand SSOT:** [`docs/Brand/SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md)  
> **CSS SSOT:** [`unified-dashboard/assets/css/somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css)  
> **Components:** [`unified-dashboard/assets/css/somo-front-desk-components.css`](../../unified-dashboard/assets/css/somo-front-desk-components.css) (`sfd-*` prefix)

**Rule:** Never copy mock CSS variables (`--moss`, `--brass`, `--clay`) into product code. Map every visual to Somo tokens below.

---

## Color mapping

| Mock token | Mock use | Somo replacement | CSS variable |
|------------|----------|------------------|--------------|
| `--moss` / `--moss-dark` | Sidebar, dark surfaces | MSU green sidebar | `--somo-msu` (`#164437`) |
| `--moss` (CTA) | Primary buttons on light | Product green CTA | `--somo-green` (`#16a637`) |
| `--moss-dark` (hover) | Primary hover | Green hover | `--somo-green-hover` (`#128a2e`) |
| `--paper` | Page background | Marketing paper | `--somo-bg-marketing` (`#fbf9f4`) → `sfd-paper` |
| `--white` | Cards | Surface white | `--sfd-surface` / `#ffffff` |
| `--ink` | Body text on light | Marketing ink | `--somo-text-marketing` (`#1a1a1a`) → `sfd-ink` |
| Provider body | Portal content | Provider ink | `--ink` (`#0b1120`) in `provider-portal.css` |
| `--brass` | Step current, secondary CTA | Lizard accent | `--somo-lizard` (`#b5e930`) |
| `--brass` (hover) | Secondary hover | Lizard hover | `--somo-lizard-hover` |
| `--brass-light` | Annotation / hint panels | Lizard tint | `--somo-lizard-10`, `--somo-lizard-20` |
| `--clay` / `--clay-light` | OFF, danger, closed | Red soft | `--red`, `--red-soft` (`provider-portal.css`) |
| `--slate` | Muted, SHADOW state | Muted text | `--somo-muted-marketing` / `--muted` → `sfd-muted` |
| `--line` | Borders | Border | `--somo-border-marketing` → `sfd-border` |
| Success / LIVE LED | Status dot | Green | `--somo-green` |
| Warning / PAUSED | Amber soft | Orange soft | `#fff7ed` / `#9a3412` (`sfd-nameplate--reauth`) |
| Error | Integration failure | Danger | `--sfd-danger` (`#dc2626`) |

---

## Typography mapping

| Mock | Use | Somo replacement | Where |
|------|-----|------------------|-------|
| Zilla Slab | Display headings on auth | **League Spartan** | `--font-brand` — login, invite, voice-setup |
| System sans | Provider body | **Plus Jakarta Sans** | `--font` — `provider-portal.css` |
| IBM Plex Mono | Phone numbers, table headers, badges | **Martian Mono** | `--mono` / `--sfd-mono` |
| Mock eyebrow | Step label | Plus Jakarta 0.85rem uppercase | `signup-eyebrow` |

---

## Logo & brand marks

| Mock | Somo rule |
|------|-----------|
| CSS dot brand mark (`.brand-mark .dot`) | **Forbidden** in product UI |
| Text-only wordmark SVG | **Forbidden** |
| Logo image | [`somo-logo.png`](../../unified-dashboard/assets/brand/somo-logo.png) — auth, nav |
| Icon | [`somo-icon.png`](../../unified-dashboard/assets/brand/somo-icon.png) — favicon, compact |

See [`SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md) (logo & icon table). Sync: `npm run brand:sync`.

---

## Component class mapping

| Mock pattern | Somo class | Notes |
|--------------|------------|-------|
| `.device` centered card | `.sfd-device-card` | Login, invite, wizard steps |
| `.card` | `.sfd-card` | Optional `.sfd-card--flat`, `.sfd-card--paper` |
| `.btn-primary` (moss) | `.sfd-btn.sfd-btn-primary` | `--somo-green` |
| `.btn-brass` | `.sfd-btn.sfd-btn-secondary` | `--somo-lizard` |
| `.btn-ghost` | `.sfd-btn.sfd-btn-ghost` | |
| `.btn-danger-outline` | `.sfd-btn.sfd-btn-danger-outline` | Skip anyway, destructive |
| `.stepper` / `.step` | `.sfd-stepper` / `.sfd-step` | Done/current via modifiers |
| `.badge` / status pill | `.sfd-nameplate` + variant | See nameplate table in spec |
| `.checklist-item` | `.sfd-checklist-item` + `.sfd-check` | Done: `.sfd-check--done` |
| `.toggle-row` + `.switch` | `.sfd-toggle-row` + `.sfd-switch` | Hours, outbound toggles |
| `.pill-help` / sub-nav | `.sfd-pill-tabs` | Settings IA |
| `.annot` / callout box | `.sfd-callout` | Dentrix interim copy |
| `.empty-state` | `.sfd-empty-state` | Dashed border |
| `.skeleton` | `.sfd-skeleton` | Calls loading |
| Modal overlay | `.sfd-modal-backdrop` + `.sfd-modal` | Skip calendar, convert lead |
| `.grid2` / `.grid3` | `.sfd-grid-2` / `.sfd-grid-3` | Connect cards, KPI row |
| `.product-nav` sidebar | `.pp-sidebar` + `.provider-portal--front-desk` | MSU override in components CSS |
| Table header mono | `.pp-table th` or `.sfd-table-head` | Uppercase, letter-spaced |
| RECOMMENDED badge | `.sfd-nameplate--sm` on card | Google Calendar card |

---

## Shell mapping

| Mock shell | Product shell | Pages |
|------------|---------------|-------|
| Wizard frame (no sidebar) | `signup-wizard-body` + `sfd-device-card` | `login.html`, `invite.html`, `voice-setup.html`, `signup.html` |
| Product shell (MSU sidebar) | `provider-portal` + `pp-sidebar` | `business/*.html` daily portal |
| Admin shell | `admin-portal` + `admin-sidebar` | `admin/*.html` |
| Patient shell | `patient-shell` + bottom tabs | `patients/*.html` |

Auth/onboarding pages **must not** mount `pp-sidebar`.

---

## Canonical onboarding stepper

Mock steppers drift across frames. **Canonical product sequence:**

```
Invite → Profile → Connect → Voice → Hours → Outbound → Live
```

| Decision | Resolution |
|----------|------------|
| Billing in mock stepper | **Not a wizard step** — Stripe Connect lives in Settings → Billing |
| PMS in old mock step 04 | **Informational on Profile**; real connection on Connect + Settings |
| Tone field in code | Relocate to Voice step or Settings → Kelly (not on Profile in mock) |
| Practice email in code | Keep on Profile (alerts/handoffs); not shown in mock |

Renderer: [`sfd-stepper.js`](../../unified-dashboard/assets/js/sfd-stepper.js).

---

## Mock frame → file quick reference

| Frame | Screen | File |
|-------|--------|------|
| 00a | Login | `unified-dashboard/login.html` |
| 01 | Accept invite | `unified-dashboard/business/invite.html` |
| 04 | Practice profile | `voice-setup.html` step 1 |
| 04a | Connect systems | `voice-setup.html` step 2 |
| 04a-google | OAuth (engineering) | `/auth/google/calendar/connect` |
| 04a-return | OAuth return | `voice-setup.html?step=2` |
| 04a-skip | Skip modal | `voice-setup.html` modal |
| 04b | Greeting | `voice-setup.html` step 3 |
| 04c | Hours | `voice-setup.html` step 4 |
| 04d | Outbound | `voice-setup.html` step 5 |
| 05 | Test call + forward | `voice-setup.html` step 6 |
| 06 | Kelly control center | `business/agent.html` |
| 07 | Today | `business/today.html` |
| 08 | Calls | `business/calls.html` |
| 09 | Connected Accounts | `business/settings.html` |
| 10 | Patient pay | `patients/pay.html` |
| 11 | Go-live checklist | `today.html#go-live-checklist` |
| A1 | Admin tenants | `admin/tenants.html` |
| A2 | Pipeline | `admin/pipeline.html` |
| A3 | Lead detail | `admin/lead.html` |
| A4 | Invite modal | `admin/tenants.html` modal |
| A5 | Convert lead | `admin/pipeline.html` + `admin/lead.html` |
| A6 | Tenant detail | `admin/tenants.html` detail |

---

## Appendix: mock-only elements (do not ship)

| Element | Treatment |
|---------|-----------|
| `.annot` design-review notes in mock HTML | Spec/internal only |
| Moss/brass/clay palette | Never in product CSS |
| Meta chrome in design file header | Design QA only |
| Second nav system (`product-nav` duplicate) | Use existing `pp-sidebar` |

---

## Related docs

- [`FRONT_DESK_SCREEN_UPDATE_SPEC.md`](./FRONT_DESK_SCREEN_UPDATE_SPEC.md) — full task registry, states, acceptance criteria
- [`SOMO_GUIDELINES.md`](../Brand/SOMO_GUIDELINES.md) — brand lines and palette summary
- [`sfd-component-gallery.html`](../../unified-dashboard/dev/sfd-component-gallery.html) — visual QA for `sfd-*` components
