# Kelly RCM Pipeline Todos

Status: pending roadmap  
Scope: Kelly identity + RCM backbone + financial rails  
Source map: `/Users/ojrichard/Downloads/kelly_rcm_todo_map.html`

## Playwright UI audit findings (merged)

### P0 issues

1. Provider shell/class inconsistency across business pages:
   - Missing `provider-shell` and/or `body.provider-portal` on multiple provider routes.
2. Route/auth inconsistency:
   - `settings.html` can render sign-in surface unexpectedly during provider flow.
3. Portal identity inconsistency:
   - Mixed naming in titles and headers (`Provider Portal`, `Doctor's Portal`, `Consult Clinic Dashboard`, `Business Management`).

### P1 issues

1. Theme inconsistency:
   - login/signup surfaces are white+purple while provider shell is blue/teal dominant.
2. Iconography inconsistency:
   - mixed emoji icon set across pages instead of one canonical icon system.
3. Legacy surfaces still present in inventory:
   - non-shell legacy pages remain reachable and break consistency expectations.

### P2 issues

1. Residual commerce/Shopify traces in clinic provider surfaces.
2. Billing section map still references legacy sections (`payments`, `commerce`) and needs strict clinic-only behavior.

## Normalized task matrix (TODO-01..24)

| ID | Decision | Priority | Phase | Notes |
|---|---|---|---|---|
| TODO-01 | Keep | P0 | Phase 1 | Canonical Kelly status endpoint is required first. |
| TODO-02 | Keep | P0 | Phase 1 | ON/OFF toggle must be first-class and stateful. |
| TODO-03 | Keep | P0 | Phase 1 | Global shell widget required for visibility contract. |
| TODO-04 | Keep | P0 | Phase 1 | Provisioning UX and retry flow required for seamless onboarding. |
| TODO-05 | Keep | P1 | Phase 1 | `rcm_journeys` + `rcm_journey_events` are core data backbone. |
| TODO-06 | Keep | P1 | Phase 1 | Journey creation on every Kelly call is required. |
| TODO-07 | Keep | P1 | Phase 1 | Stage transitions must be evented and auditable. |
| TODO-08 | Keep | P1 | Phase 2 | Timeline UI after backbone endpoints exist. |
| TODO-09 | Keep | P1 | Phase 3 | Ledger is required before serious money automation. |
| TODO-10 | Keep | P1 | Phase 3 | Canonical payment API required for orchestration. |
| TODO-11 | Keep | P1 | Phase 3 | Eligibility normalization drives patient responsibility logic. |
| TODO-12 | Keep | P2 | Phase 4 | Patient->provider copay flow after payments/ledger. |
| TODO-13 | Keep | P2 | Phase 4 | Remittance posting + overpayment/refund logic. |
| TODO-14 | Keep | P2 | Phase 4 | A/R days metric job and API. |
| TODO-15 | Keep | P2 | Phase 2 | Today-page money widget once summary API exists. |
| TODO-16 | Keep | P2 | Phase 2 | Billing payments section should be real data. |
| TODO-17 | Already done (verify) | P3 | Verification | EOB modal flow appears implemented; retain as regression check only. |
| TODO-18 | Keep (defer) | P3 | Phase 5 | New `rcm.html` command center after core APIs are stable. |
| TODO-19 | Keep (defer) | P3 | Phase 5 | Public patient payment page after payment request token APIs. |
| TODO-20 | Keep | P3 | Phase 4 | A/R KPI card after metrics API. |
| TODO-21 | Already done (verify) | P3 | Verification | Patient terminology updates appear implemented; keep as QA checklist item. |
| TODO-22 | Already done (verify) | P3 | Verification | Agent KPI label changes appear implemented; keep as QA checklist item. |
| TODO-23 | Partial (verify + clean) | P3 | Verification | Shopify card mostly removed but CSS leftovers remain; verify no clinic surfacing. |
| TODO-24 | Keep (defer) | P3 | Phase 5 | Sidebar RCM command center nav after `rcm.html` exists. |

## Inline acceptance criteria (Playwright-driven)

- TODO-03/04:
  - All provider pages in `unified-dashboard/business/*.html` render with `provider-shell.js` and `body.provider-portal`.
  - Kelly identity appears persistently in shell and reflects `pending|active|paused|error`.
  - Provisioning state banner behavior is deterministic (`pending`, `failed`, `ready`).
- TODO-08/15/16/18/24:
  - Titles are normalized to one provider brand standard.
  - Navigation entries map only to clinic canonical routes.
  - Iconography uses a single icon system (no ad-hoc mixed emoji for core controls).
- TODO-17:
  - `handleViewEob()` always opens modal and never uses alert fallback.
- TODO-21:
  - No `Has Therapist` terminology in provider patients surfaces.
- TODO-22:
  - No commerce KPIs in agent page; only provider-call outcomes.
- TODO-23:
  - No provider-facing Shopify copy/cards/classes on clinic portal.

## Cross-cutting UI consistency checklist

1. All provider pages include provider shell and provider portal body class.
2. Canonical title pattern and product naming enforced across provider routes.
3. White/purple clinic theme tokens applied consistently where specified.
4. Icon language standardized and accessible.
5. Legacy pages either redirected or visually shell-compliant until retired.

## Dependency order

1. TODO-01 -> TODO-02 -> TODO-03 -> TODO-04  
2. TODO-05 -> TODO-06 -> TODO-07 -> TODO-08  
3. TODO-09 -> TODO-10 -> TODO-11  
4. TODO-12 -> TODO-13 -> TODO-14 -> TODO-20  
5. TODO-15 -> TODO-16  
6. TODO-18 -> TODO-24  
7. TODO-19  

Verification-only checks (parallel): TODO-17, TODO-21, TODO-22, TODO-23

## Implementation phases

### Phase 1: Kelly identity and RCM backbone

- TODO-01, TODO-02, TODO-03, TODO-04
- TODO-05, TODO-06, TODO-07

### Phase 2: Provider UI wiring

- TODO-08, TODO-15, TODO-16

### Phase 3: Financial primitives

- TODO-09, TODO-10, TODO-11

### Phase 4: Settlement and KPI loop

- TODO-12, TODO-13, TODO-14, TODO-20

### Phase 5: Command center and patient payment UX

- TODO-18, TODO-24, TODO-19

## Missing governance tasks (added)

1. Idempotency and replay policy for payment + journey event ingestion.
2. Migration rollback plan for new schema objects (`rcm_*`, `ledger_*`).
3. Tenant isolation test suite for all new Kelly/RCM endpoints.
4. Provisioning SLOs/alerts for Kelly states (`pending`, `failed`, retries).

## Immediate sprint recommendation

- Build now: TODO-01..07
- Ship UI baseline: TODO-03, TODO-04, TODO-08
- Validate done items: TODO-17, TODO-21, TODO-22, TODO-23

## Seamless UX extension (doctor-first)

1. Mobile-first provider shell pass:
   - white professional sidebar, stronger page hierarchy, touch-friendly controls.
2. Full emoji removal across provider core/admin controls and KPI labels.
3. Remove provider chat launcher surfaces from core provider pages.
4. Agent operations clarity:
   - redefine `agent.html` as controls + outcomes + escalations.
5. First-time doctor onboarding:
   - plain-language setup checklist (`signup -> verify -> terms -> assigned number -> first test call`).
6. Regression checks:
   - today page must not fail when optional helper APIs are unavailable.
