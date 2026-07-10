# Phase 7.9 — Production deploy gate

Gate before promoting `somo-middleware` (Cloud Run) and Firebase `hosting-dist`.

## Commands

```bash
# Structural + local profile (CI-safe)
cd middleware-platform
npm run verify:phase7-deploy-gate

# Include live callsomo.com + api.callsomo.com + Cloud Run env
LIVE=1 npm run verify:phase7-deploy-gate
```

## Deploy sequence (operator)

1. `node scripts/build-staging-hosting.cjs` (repo root)
2. Deploy middleware to Cloud Run (existing pipeline)
3. `node scripts/deploy-firebase-hosting.cjs` (repo root)
4. `LIVE=1 npm run verify:phase7-deploy-gate --prefix middleware-platform`
5. `npm run verify:kelly-rails-cloudrun --prefix middleware-platform`

## Pass criteria

- `callsomo.com/business/today.html` returns 200
- `api.callsomo.com/health` returns 200
- Cloud Run: `KELLY_RAILS_V2=1`, `CONVERSATION_MODE_ROUTING=enforce`
- Firebase billing rewrite preserves query strings (Phase 5.16)

**Requires live prod access:** `LIVE=1` step and Cloud Run describe.
