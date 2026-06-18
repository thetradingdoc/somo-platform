# Landing UI parity — GO checklist

**Last updated:** 2026-06-03

## Production hosting GO (logo fix)

| Check | Result |
|-------|--------|
| Firebase deploy `somo-4ddf6` hosting | **Complete** (2026-06-03) |
| Bundle CSS | `index-BEcqrBvT.css` — `object-fit:contain`, no `clip-path` crop |
| `npm run test:prod:mobile` | **4/4 passed** (header + footer logo `naturalWidth > 0`) |
| `verify-hosting-dist-landing --live` | Run after deploy (see below) |

**Fix:** Removed broken `clip-path` crop on 1024×1024 `somo-logo.png`; nav/footer use contain sizing (~36px mobile / ~44px desktop header, ~40–48px footer).

## Commands

```bash
npm run deploy:staging-hosting
cd middleware-platform && npm run test:prod:mobile
node scripts/verify-hosting-dist-landing.cjs --live https://callsomo.com
```

Hard-refresh `https://callsomo.com` (Cmd+Shift+R).

## Local verification

| Check | Result |
|-------|--------|
| `test:e2e-somo-landing` | 5 passed, 1 skipped |
| `verify:hosting-dist-landing` (local dist) | PASS |

## Next (operator)

- [`todos/PENDING.md`](../../../todos/PENDING.md): Q-17, Q-18, Sheets proof
