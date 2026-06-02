# Engineering documentation hygiene

**Last updated:** 2026-06-02  
**Owner:** Platform / solution engineering

Use this when adding or retiring docs so the repo stays navigable.

## Read first (do not open 12k-line consolidations first)

| Need | Document |
|------|----------|
| Where is the canonical doc for topic X? | [CANONICAL_DOC_MAP.md](./CANONICAL_DOC_MAP.md) |
| System snapshot (onboarding) | [architecture/CURRENT_STATE_ARCHITECTURE.md](../architecture/CURRENT_STATE_ARCHITECTURE.md) |
| Middleware routes | [architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md](../architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md) |
| End-to-end flows (landing → API) | [architecture/RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md](../architecture/RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md) |
| Deploy / rollback / cutover | [runbooks/CALLSOMO_GCP_CUTOVER.md](../runbooks/CALLSOMO_GCP_CUTOVER.md), [runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md) |
| Brand + logo + email HTML | [Brand/SOMO_GUIDELINES.md](../Brand/SOMO_GUIDELINES.md), [Brand/LOGO_AND_ICON_SSOT.md](../Brand/LOGO_AND_ICON_SSOT.md) |
| Kelly agentic rails | [architecture/kelly_rails_v2_as_built.md](../architecture/kelly_rails_v2_as_built.md) (built), [architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md](../architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md) (target/plan) |
| Active work | [todos/pending/README.md](../../todos/pending/README.md) |

## One story, one owner

- **Product architecture** → `docs/architecture/*.md` (focused files) or `CURRENT_STATE_ARCHITECTURE.md`.
- **Operational steps** → `docs/runbooks/`.
- **Checklists / sprints** → `todos/pending/` only; link to docs, do not copy long design sections.
- **Historical debugging** → `docs/archive/` with a date suffix; strip from active READMEs.

## Retire or stub (do not maintain two deploy/brand stories)

- Stub files may remain for old links; body must be ≤15 lines pointing to the SSOT.
- Prefer updating inbound links, then delete the stub in a follow-up PR.
- Register redirects in [`_consolidated_path_redirects.json`](../_consolidated_path_redirects.json) when removing paths.

## Legacy names (search before publishing)

Banned in new consumer-facing copy: DocLittle, myskinandcare, DodgeCall as product name.  
Internal env `Kelly*` and GCP resource `myskin-middleware` are fine — see [Brand/INFRA_BRAND_DEFERRAL.md](../Brand/INFRA_BRAND_DEFERRAL.md).

Automated checks: `npm run check:legacy-hosts`, `npm run check:brand-consumer-strings`.

## Consolidated mega-READMEs

`docs/architecture/README.md` and `docs/middleware-platform/README.md` are **archives of merged sections**, not day-one reading. Add new content as a focused sibling `.md` and one line in `CANONICAL_DOC_MAP.md`.
