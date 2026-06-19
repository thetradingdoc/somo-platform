# GitHub Actions (optional — billing may disable)

Minimal gate restored in `ci.yml`: `npm run ci:gate` + `smoke:voice-routing-matrix`.

**GitHub Actions is disabled** (billing). Use local CI instead:

```bash
npm run ci:gate          # before push / deploy (~5–15 min)
npm run ci:full          # deeper check before major releases
./scripts/install-git-hooks.sh   # optional: auto-run ci:gate on git push
```

Deploy scripts run `ci:gate` by default (`SKIP_CI=1` or `--skip-ci` to bypass).

The archived workflow definition is in `ci.yml.disabled` (manual `workflow_dispatch` only if you re-enable billing later).

Nightly Kelly prod checks: `npm run verify:kelly:nightly` (replaces `kelly-rails-prod-nightly.yml.disabled`). Schedule via cron on your machine if desired.
