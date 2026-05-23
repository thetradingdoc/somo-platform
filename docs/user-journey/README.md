# User journey (source of truth)

**Last updated:** 2026-05-21 — photo-first loop: pick → Today (phase card + `/photo`) → Timeline; Step 1 funnel on `/start`.

This folder defines **what we ship** for the routine tracker product. When code, copy, or URLs disagree with these docs, **update the code to match the journey** (or update these docs in the same PR with explicit rationale).

| Doc | Purpose |
|-----|---------|
| [01-north-star.md](./01-north-star.md) | One product, one outcome |
| [02-journey-now.md](./02-journey-now.md) | MVP flow — principles, happy path, implementation gaps |
| [03-journey-later.md](./03-journey-later.md) | Deferred surfaces and monetization |
| [04-surfaces-and-urls.md](./04-surfaces-and-urls.md) | Where each step runs (URLs, repos) |
| [05-landing-hero.md](./05-landing-hero.md) | Landing hero art, dual CTAs, copy |
| [06-mobile-and-web-parity.md](./06-mobile-and-web-parity.md) | Single journey on Expo + web; route map, brand colors, do-not-use |
| [07-v1-product-decisions.md](./07-v1-product-decisions.md) | Locked v1: photo = day logged, phase card, no floating chat |
| [08-step1-match-users.md](./08-step1-match-users.md) | Step 1 funnel — users and stories |
| [09-step1-match-design.md](./09-step1-match-design.md) | Step 1 funnel — design notes |
| [10-agentic-funnel-scope.md](./10-agentic-funnel-scope.md) | Agentic funnel scope |
| [11-growth-backlog.md](./11-growth-backlog.md) | Growth and friction backlog (deferred) |

**Supersedes:** scattered care-funnel notes in `docs/consumer/` (see redirect there).

**Canonical routine data:** `middleware-platform/data/routines/concern-routines.json` (same schema as `all_routines.json`); patient app bundles a copy under `patient-app/assets/data/all_routines.json`.
