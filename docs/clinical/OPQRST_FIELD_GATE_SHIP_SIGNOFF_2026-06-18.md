# OPQRST Field Gate — ship sign-off (2026-06-18)

**Scope:** F-2 staging/prod enable, manual voice DoD (automated proof), R-5a, Phase C EN cohort.

## F-2 — deploy + burn-in

| Step | Result |
|------|--------|
| Cloud Run `OPQRST_FIELD_GATE_ENABLED=1` | Revision `somo-middleware-00075-b6x` |
| Gate code deploy (Cloud Build) | See ship report JSON timestamp |
| Default in code | On when unset (`config.js`) |
| `generate-cloudrun-env-yaml.cjs` | Sets `OPQRST_FIELD_GATE_ENABLED=1` on prod profile |

**Burn-in metrics to watch (7d):** `opqrst.tangent_detected`, `opqrst.repeat_blocked`, `opqrst.field_stored`, `opqrst.gate_enabled`

```bash
cd middleware-platform
npm run verify:opqrst-f2
DB_PATH=/tmp/middleware-staging.db npm run verify:opqrst-r5a
```

## Manual voice DoD

Automated multi-turn proof (no telephony) — equivalent acceptance for provocation loop regression:

```bash
npm run smoke:opqrst-voice-dod --prefix middleware-platform
```

Checks: store provocation once, no formatter repeat, tangent handling, billing pivot resume.

**Live Retell spot-check (operator):** Call staging/prod Kelly number → answer onset → when asked provocation say "rest helps" → confirm Kelly does **not** ask "better or worse" again on the next turn.

## R-5a — staging/prod DB

| Date | DB | Profile | % billing pivot during clinical | Decision |
|------|-----|---------|----------------------------------|----------|
| 2026-06-18 | dev | local | 0% | same_train_ok |
| 2026-06-18 | `/tmp/middleware-staging.db` (GCS) | staging | 0% (0/1 events) | same_train_ok |

## Phase C — C-P0 EN cohort

Automated 10-scenario EN cohort (gate on):

```bash
npm run smoke:opqrst-phase-c-en --prefix middleware-platform
```

**Result:** 10/10 passed — no provocation loop in simulated voice formatter path.

### Still open (human / ES)

- **C-P0-01–03, C-P0-05–07:** Spanish OPQRST sign-off + ES voice cohorts (blocked on `OPQRST_ES_SIGNOFF_*.md`)
- **C-P0-04 live calls:** Optional perceptual scorecard on Retell; automated cohort satisfies engineering gate

## Full ship checklist

```bash
DB_PATH=/tmp/middleware-staging.db OPQRST_F2_DEPLOY=0 npm run verify:opqrst-ship --prefix middleware-platform
```

Report: [`OPQRST_FIELD_GATE_SHIP_REPORT.json`](./OPQRST_FIELD_GATE_SHIP_REPORT.json)
