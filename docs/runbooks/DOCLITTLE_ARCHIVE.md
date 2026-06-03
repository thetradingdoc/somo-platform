# Archive doclittle-platform

Manual checklist after **green CI** on `somo-platform` `main`.

## Preconditions

- [ ] `middleware-platform` Jest passes on Node 18.x and 20.x (`.github/workflows/ci.yml`)
- [ ] Provider Playwright projects `provider-portal` and `provider-rcm` pass locally against `:4000`
- [ ] Staging smoke passes (`scripts/smoke-staging.cjs` or deploy workflow)

## Archive steps

1. GitHub → **doclittle-platform** → Settings → Archive repository (requires admin).
2. Remove stale remote from local clone if present:
   ```bash
   git remote remove doclittle-old
   ```
3. Confirm Railway / legacy webhooks no longer point at archived repo ([GITHUB_SECRETS_SOMO_PLATFORM.md](./GITHUB_SECRETS_SOMO_PLATFORM.md)).

## Sign-off

Record date and approver in team ops log. Do not archive until production traffic uses somo-platform deploy paths only.
