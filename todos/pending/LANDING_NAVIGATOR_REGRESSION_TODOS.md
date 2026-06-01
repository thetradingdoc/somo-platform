# Landing navigator — open regression tests

**Status:** UI work complete — see [`../archive/LANDING_NAVIGATOR_UI_UX_TODOS_COMPLETED_2026-05-31.md`](../archive/LANDING_NAVIGATOR_UI_UX_TODOS_COMPLETED_2026-05-31.md)

## Batch 9 — Location resolution (remaining)

- [ ] Add regression tests for race conditions and scope correctness:
  - Frontend tests for rapid ZIP A→B changes and stale response suppression
  - API contract tests for `scope_requested` / `scope_used` / `precision`
  - E2E tests validating no silent fallback and correct labels for unresolved ZIPs (e.g. `07205`, `10469`)

**Optional:** fold into post-deploy QA in [`CLEAN_PUSH_GCP_TODOS.md`](./CLEAN_PUSH_GCP_TODOS.md) after geo routes ship.
