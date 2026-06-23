# GitHub Actions (optional — billing may disable)

Minimal gate restored in `ci.yml`: `npm run ci:fast` + `smoke:voice-routing-matrix`.

**GitHub Actions is disabled** (billing). Use local CI instead:

```bash
npm run ci:fast          # pre-push / pre-deploy (~3 min) — same as ci:gate
npm run ci:slow          # network / DB coding gates (nightly / pre-release)
npm run ci:full          # fast + slow + reasoning regression + Playwright
./scripts/ci-timing.sh fast   # fast tier with per-step durations
./scripts/install-git-hooks.sh   # optional: auto-run ci:fast on git push
```

| Tier | npm script | When |
|------|------------|------|
| **fast** / **gate** | `ci:fast`, `ci:gate` | Every push, deploy scripts |
| **slow** | `ci:slow` | Nightly Kelly checks (`verify:kelly:nightly` appends this) |
| **full** | `ci:full` | Major releases |

Deploy scripts run `ci:fast` by default (`SKIP_CI=1` or `--skip-ci` to bypass).

The archived workflow definition is in `ci.yml.disabled` (manual `workflow_dispatch` only if you re-enable billing later).

Nightly Kelly prod checks: `npm run verify:kelly:nightly` (replaces `kelly-rails-prod-nightly.yml.disabled`). Schedule via cron on your machine if desired.
