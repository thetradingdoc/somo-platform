# Somo landing UI parity — gate before deploy

**Last updated:** 2026-06-03  
**GO doc:** [docs/agent/somo-demo/LANDING_UI_PARITY_GO.md](../../docs/agent/somo-demo/LANDING_UI_PARITY_GO.md)

## Gate checklist

| ID | Task | Owner | Status |
|----|------|-------|--------|
| UI-01 | Logo visible (contain sizing, no clip-path) | Eng | **done** |
| UI-02 | Footer stack + FAB hidden at footer | Eng | **done** |
| UI-03 | Localhost :4000 asset routing | Eng | **done** |
| UI-04 | Hosting bundle brand merge order | Eng | **done** |
| UI-05 | Playwright local (`test:e2e-somo-landing`) | Eng | **done** (5 passed) |
| UI-06 | Playwright live mobile (`test:prod:mobile`) | Eng | **done** (4/4, 2026-06-03) |
| UI-07 | Visual sign-off 390px + 1280px | Ops | **pending** — hard-refresh callsomo.com |
| UI-08 | Firebase deploy | Ops | **done** (2026-06-03) |
| UI-09 | Post-deploy live CSS smoke | Eng | **done** (`index-BEcqrBvT.css`) |

## After UI GO

Resume [SOMO_DEMO_QUALIFICATION_TODOS.md](./SOMO_DEMO_QUALIFICATION_TODOS.md): Q-17, Q-18, Sheets proof.
