# Coding Layer Review Guide

> **Last reviewed:** 2026-06-20  
> **Audience:** Engineers reviewing coding-spine PRs  
> **Canonical flow:** [VOICE_CODING_SPINE.md](./VOICE_CODING_SPINE.md)

Use this guide to review changes without reading 4k-line god files end-to-end.

---

## Golden path (must not break)

```
OPQRST → run_triage_rag → resolveInsuranceCodes → collect_insurance → POST /voice/insurance/collect → computeVisitQuote → schedule_appointment
```

Kelly **must not** pass client `service_code` on internal HTTP collect. CPT/ICD come from the triage spine only.

---

## File map

| Area | Primary file | Role |
|------|--------------|------|
| Thresholds SSOT | `middleware-platform/config/coding-thresholds.js` | 0.65 confidence, HITL approved confidence |
| Resolver SSOT | `middleware-platform/services/resolve-insurance-codes.js` | Harness block, pair validation, CPT spine |
| Kelly tools | `middleware-platform/services/kelly-tool-executor.js` | Tool dispatch; `_collectInsurance`, `schedule_appointment` |
| Kelly modules | `middleware-platform/services/kelly-tool-executor/*` | Extracted collect, triage, commerce, HTTP client |
| Voice HTTP | `middleware-platform/routes/voice-appointments.js` | `/voice/insurance/collect`, schedule, checkout |
| Voice insurance | `middleware-platform/services/voice-insurance-*.js` | Collect service, spine handler |
| Voice insurance routes | `middleware-platform/routes/voice/insurance-routes.js` | Insurance endpoint registration |
| Triage guards | `middleware-platform/services/voice-triage-guards.js` | Session guardrails (schedule, collect) |
| Journey gates | `middleware-platform/services/journey-gates-service.js` | coding → quote → booking gate chain |
| HITL | `middleware-platform/services/coding-review-service.js` | Queue, approve/reject |
| HITL resume | `middleware-platform/services/coding-hitl-resume.js` | Kelly turn hints after approve |
| Retell | `middleware-platform/webhooks/retell-websocket.js` | WebSocket; tools via KellyToolExecutor |
| Verify lib | `middleware-platform/scripts/lib/*` | Shared env, assert, DB, seeds, spine checks |
| CI | `middleware-platform/scripts/ci-local.sh` | Static + integration gates |

---

## Invariants checklist

Review every coding PR against these:

- [ ] **No client `service_code`** on Kelly → HTTP collect POST body
- [ ] **Spine-only CPT** — `resolveInsuranceCodes` is the only production path for collect/eligibility/quote
- [ ] **Threshold SSOT** — use `CODING_CONFIDENCE_THRESHOLD` from `config/coding-thresholds.js`, not hardcoded 0.65
- [ ] **Harness rows rejected** — `seeded_for_harness=1` blocked in prod resolver
- [ ] **Pair validation** — invalid ICD/CPT pairs block collect and flag HITL
- [ ] **HITL resume** — meta cleared only after successful collect; no reroute override during resume
- [ ] **No terminal assist injection** — E2E uses `--no-assist`; no synthetic 99213 in prod paths
- [ ] **Quote before book** — journey gates enforce quote_delivered before schedule (except documented routine bypass)

---

## Test matrix

| Script | Proves | Requires |
|--------|--------|----------|
| `npm run capture:coding-prod-evidence` | Full static + integration bundle | Network optional; `DB_PATH=./var/db/middleware-dev.db` |
| `npm run verify:kelly-http-collect` | Kelly POST omits `service_code`; HTTP spine resolve | Writable DB |
| `npm run verify:live-spine` | Pinecone + CPT inference fixtures | Network |
| `npm run verify:terminal-call` | Terminal E2E spine checks | Writable DB; `--no-assist` |
| `npm run verify:live-call -- --session_id=…` | Real Retell session post-call | Readonly prod/staging DB export |
| `npm run verify:coding-hitl` | HITL queue + approve flow | Writable DB |
| `npm run verify:pair-validation` | Invalid pairs blocked | Writable DB |
| `npm run verify:staging-coding-deploy` | Cloud Run env + health | Staging URL |
| `jest __tests__/coding-layer-leaks.test.js` | No bypass writers in prod paths | None |
| `jest __tests__/collect-insurance-http-spine.test.js` | HTTP collect contract | None |

Run from `middleware-platform/` unless noted.

---

## Known footguns

1. **`KellyToolExecutor._post` mocks** — Many verify scripts mock HTTP; only `verify-kelly-http-collect.cjs` validates the real POST contract. Do not remove that script.
2. **DB path split** — Coding scripts default `./var/db/middleware-dev.db`; always set `DB_PATH` explicitly in CI/docs.
3. **Verify drift** — `terminal-coding-call.cjs` must use `coding-spine-checks.cjs` (same as standalone verifiers).
4. **Double resolve** — Kelly pre-resolves then HTTP re-resolves (intentional security boundary); do not re-add client CPT on HTTP.
5. **Retell split path** — Legacy axios handlers in `retell-websocket.js` bypass executor gates; all Kelly tools should go through `KellyToolExecutor.execute`.

---

## PR review checklist (copy-paste)

```markdown
## Coding PR review

- [ ] Read linked section in CODING_LAYER_REVIEW.md
- [ ] Invariants checklist (above) — all pass
- [ ] No new hardcoded CPT/ICD in voice paths
- [ ] Thresholds from coding-thresholds.js
- [ ] Tests added/updated for behavior change
- [ ] `node scripts/ci-local.sh` (or listed subset) green
- [ ] Verify script names unchanged (ops/CI depend on them)
- [ ] Docs updated if env vars or golden path changed
```

---

## Refactor boundaries (PR series)

| PR | Scope | Safe to merge independently? |
|----|-------|------------------------------|
| PR0 | This doc + ARCHITECTURE section | Yes |
| PR1 | Resolver parity (schedule, journey gates, quote dedup) | Yes — behavior change, needs tests |
| PR2–4 | Verify lib foundation, seeds, DB unification | Yes — low risk |
| PR5 | `coding-spine-checks.cjs` | Yes — fixes verify drift |
| PR6 | Deploy readiness dedup | Yes |
| PR7 | Kelly → voice-triage-guards | Medium — gate behavior |
| PR8–9 | Kelly module extraction | Medium — no logic change ideally |
| PR10–11 | Voice route splits | Medium — route registration order |
| PR12 | Retell → KellyToolExecutor | High — tool execution path |
| PR13+ | database.js repos | High — one repo per PR |

Do **not** combine PR7 (gates) with PR12 (Retell) in one review.

---

## Module extraction map (Kelly executor)

After PR8–9, prefer editing extracted modules over growing `kelly-tool-executor.js`:

- `collect-insurance.js` — `_collectInsurance`, session gates, HTTP POST
- `triage-tools.js` — OPQRST, rich intake, `_runTriageRAG`
- `http-client.js` — `_post`, `_postDirect`
- `checkout-context.js` — checkout stage machine
- `commerce-tools.js` — cart, checkout, payment status tools

---

## Questions for reviewers

If a PR touches resolver or collect:

1. Can a client still inject CPT via tool args or HTTP body?
2. Does HITL still block sub-threshold spine rows?
3. Are harness-seeded rows rejected in production?
4. Does the change preserve quote-before-book ordering?

Escalate to [VOICE_CODING_SPINE.md](./VOICE_CODING_SPINE.md) for env vars and admin HITL UI paths.
