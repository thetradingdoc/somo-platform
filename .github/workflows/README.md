# GitHub Actions (not used — no billing)

**Phase 0 gate is local.** Do not rely on GitHub Actions for deploy safety.

## Required before push or deploy

```bash
npm run ci:phase0          # Jest canaries + full suite + voice-routing smoke (~2–5 min)
npm run ci:gate            # full pre-deploy gate (~5–15 min)
./scripts/install-git-hooks.sh   # optional: auto-run ci:phase0 on git push
```

Deploy scripts run `ci:phase0` by default. Override only with `ALLOW_SKIP_CI=1` (discouraged).

The archived workflow definition is in `ci.yml.disabled` if billing is enabled later.

Nightly Kelly prod checks: `npm run verify:kelly:nightly`.
