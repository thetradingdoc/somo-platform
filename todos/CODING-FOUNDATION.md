# CODING-FOUNDATION Epic — Full Task Backlog (Medical + Dental)

**Last updated:** 2026-07-10 (gap-closure honesty pass)  
**Status:** Eng complete; **operator closeout pending** (D-01 deploy env on Cloud Run, K-02 nightly green, F-09 sign-off)  
**Related:** [PENDING.md](./PENDING.md) · [CODING_PATH_MATRIX.md](../docs/Medical%20Coding/CODING_PATH_MATRIX.md) · [VOICE_CODING_SPINE.md](../docs/Medical%20Coding/VOICE_CODING_SPINE.md)

**Scope:** ICD-10, CPT (MPFS), HCPCS, CDT, Pinecone/RAG (medical), phrase maps (dental + medical admin), triage spine, resolver/validation — production-grade for both medical and dental tenants.

**Out of epic:** Dollar-resolution precedence hotfix (separate); `plan_rules` benefit ingest; live Stedi **6.10**. Track **M** = coding-side handoff only.

**Decisions locked:**
| ID | Decision |
|----|----------|
| A-02 | `healthcare_clinic` keeps `triage_policy: disabled` — admin phrase map is primary medical path |
| D-06 | No Pinecone for dental — phrase map + CDT SQL + CDT embeddings |

---

## Track A — Tenant & spine routing (do first)

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| A-01 | eng | done | Document and enforce coding path matrix: `triage_policy` × `use_case` × `visit_reason` → admin / RAG / preventive | [CODING_PATH_MATRIX.md](../docs/Medical%20Coding/CODING_PATH_MATRIX.md); router enforces |
| A-02 | product | **decided** | Product decision: healthcare_clinic default triage | **Keep `disabled`** |
| A-03 | eng | done | When `conditional`, define triggers forcing `run_triage_rag` | `resolve-visit-codes.js` CONDITIONAL_RAG_TRIGGERS |
| A-04 | eng | done | Bring `CLINIC_TRIGGER_MAP` to parity with dental `TRIGGER_MAP` | Track I-01; coverage % in matrix |
| A-05 | eng | done | Single router: `resolveVisitCodingPath()` → admin \| rag \| preventive | [`resolve-visit-codes.js`](../middleware-platform/services/resolve-visit-codes.js) |
| A-06 | eng | done | E2E matrix: dental (no RAG), healthcare_clinic (admin), dermatology (full RAG) | All three quote/book without wrong codes |

---

## Track B — Codebook data layer (ICD-10, CPT, HCPCS, CDT)

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| B-01 | operator | done | Prod MPFS CPT import (~17k) | GCS `middleware-staging.db` 2026-07-10; 16851 CPT |
| B-02 | operator | done | Prod ICD-10-CM FY2025 parity | 74260 ICD on prod GCS |
| B-03 | operator | done | Prod HCPCS Level II parity | 9006 HCPCS on prod GCS |
| B-04 | operator | done | MPFS fee_schedules on prod | 30586 fee_schedules on prod GCS |
| B-05 | eng | **partial** | Full ADA CDT import (**7.7-EXT**) | Interim: `synthesizeAdaCdtRange()` tier-2 usable; licensed ADA PDF extraction deferred per CODEBOOK_LICENSING |
| B-06 | eng | done | CDT in parity gate | ≥800 rows, ≥80% non-placeholder |
| B-07 | eng | done | Extend `verify-prod-codebook.cjs` | ICD, HCPCS, CDT quality — not just CPT |
| B-08 | eng/legal | done | Document AMA CPT licensing gap | [CODEBOOK_LICENSING.md](../docs/compliance/CODEBOOK_LICENSING.md) |
| B-09 | eng | done | ICD-10-PCS voice scope decision | Documented out-of-scope in CODING_PATH_MATRIX |
| B-10 | eng | done | Codebook refresh runbook | Medical Coding OPERATIONS + GCS pull/push |

---

## Track C — Embeddings & semantic search

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| C-01 | operator | done | `populate-code-embeddings.js --until-done` on prod ICD+CPT+HCPCS | 98612 + CDT on GCS 2026-07-10 |
| C-02 | eng | done | CDT embeddings (`code_type='cdt'`) | 9900 CDT embeddings on prod GCS |
| C-03 | operator | done | `backfill-code-embeddings-specialty.js` on prod | 110017 rows specialty backfill |
| C-04 | eng | done | Wire `SEMANTIC_SEARCH_ENABLED` + latency budget on voice triage/suggest | Token budget gate |
| C-05 | eng | done | Eval profiles: `fast` (CI) vs `prod` (nightly) | `eval:coding:fast` / `eval:coding:prod` in package.json |

---

## Track D — Pinecone & remote RAG (medical only)

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| D-01 | eng/ops | operator_pending | Prod env: `PINECONE_*`, `RAG_API_URL=disabled` | `generate-cloudrun-env-yaml.cjs` |
| D-02 | eng | done | Pinecone index health gate on deploy | `production-readiness-gate.cjs` min vectors |
| D-03 | eng | done | Document code-metadata index provenance + re-index procedure | ARCHITECTURE §5.3 |
| D-04 | eng | done | Tune `PINECONE_MIN_SCORE` / `PINECONE_FALLBACK_MIN_SCORE` | Documented in `.env.staging.example` |
| D-05 | eng | done | Test `RAG_CPT_FALLBACK_PINECONE` | Integration test when local CPT empty |
| D-06 | product | **decided** | Dental Pinecone vs no RAG | **No Pinecone for dental** — documented |
| D-07 | eng | done | Migrate all consumers to `getCodeCandidatesDualSource` | orchestrator, context-assembler, cache-service migrated |
| D-08 | eng | done | Deprecate `enrichCandidatesFromExport` on prod paths | Disabled in production / `DISABLE_KNOWLEDGE_EXPORT_ENRICH` |

---

## Track E — Layer 2 local retrieval quality

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| E-01 | eng | done | Fix 5 eval misses (lay-05, abbr-14/15, pair-03/05) | `lay-language-icd-expansions.json` |
| E-02 | eng | done | Audit `icd10_term_corrections.json` + `concept_icd10_corrections.json` | Coverage report or test |
| E-03 | eng | done | Expand `medical-abbreviations.json` for ASR + ES/PT overlap | Multilang eval green |
| E-04 | eng | done | Eval for `guideline-resolver.js` + `negative-constraints.js` | Jest cases |
| E-05 | eng | done | Test `search-intent-builder.js` with perceptual state | Layer 1→2 boundary tests |
| E-06 | eng | done | Telehealth ranking regression | `rankCptWithTelehealthContext` tests |
| E-07 | eng | ongoing | MPFS ↔ lay-language mapping maintenance | Document in OPERATIONS |

---

## Track F — Triage spine (OPQRST → RAG v2)

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| F-01 | eng | done | Ranked primary ICD/CPT selection (not `[0]`) | `select-primary-codes.js` wired in triage-rag-service |
| F-02 | eng | done | Persist HCPCS in triage results | `hcpcs_codes` column + ranked G-code selection |
| F-03 | eng | done | Document voice vs chat RAG asymmetry | VOICE_CODING_SPINE.md |
| F-04 | eng | done | Gate `triage-rag-fast-complete.js` out of prod | `assert.notProduction()` |
| F-05 | eng | done | Enforce `KELLY_RAILS_FAST_RAG=0` on deploy | deploy gate |
| F-06 | eng | done | Eval cases for two-pass RAG upsert | No primary code corruption |
| F-07 | eng | done | Alcohol/CAGE confidence cap regression | HITL at 0.65 |
| F-08 | eng | done | `coding_provenance_json` on every triage write | pinecone \| local \| admin \| preventive |
| F-09 | operator | operator_pending | Kelly Phase C OPQRST sign-off C-P0-01–07 | Clinical depth claims blocked |

---

## Track G — Resolver & validation spine

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| G-01 | eng | done | Expand `code-pair-validation.json` NCCI PTP subset | 32 outpatient PTP rules; full NCCI bundles deferred |
| G-02 | eng | done | Wire modifier + time-based CPT rules | resolver or claim envelope |
| G-03 | eng | done | `validateCodesExist` on every path | Admin path wired |
| G-04 | eng | done | Re-enable pair validation for dental where ICD+CDT matter | Z01.20 + E/M/MH blocked |
| G-05 | eng | done | HITL queue workflow for invalid pairs | coding-reviews.html SLA |
| G-06 | eng | done | `seeded_for_harness=1` rejection at all entry points | collect + terminal verifiers |
| G-07 | eng | done | Preventive spine integration tests | Z00 + 99395/G0438 |
| G-08 | eng | done | Close Retell → KellyToolExecutor bypass | No direct axios coding handlers |

---

## Track H — Dental spine

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| H-01 | eng | done | Unify dental phrase maps → `dental-phrase-map.json` | Single SSOT |
| H-02 | eng | done | `resolve-admin-visit-codes.js` delegates to `resolveDentalCdtFromReason` | No duplicate loops |
| H-03 | eng | done | CDT codebook search tier 2 after phrase map | Works after B-05 |
| H-04 | eng | done | `search_cdt_codes` Kelly voice tool | Dental tenants allowlist |
| H-05 | eng | done | 0.65 confidence → HITL on CDT codebook hits | Same as medical |
| H-06 | eng | done | Expand phrase map ~15 → ~50 procedures | ~51 entries EN+ES |
| H-07 | eng | done | `emitCodingStarterSetMiss` → ops dashboard | Metrics visible |
| H-08 | eng | done | Spanish dental trigger phrases | In dental-phrase-map.json |
| H-09 | eng | done | Expand `cdt-codebook.test.js` + `dental-pstn-scenarios.cjs` | endo, perio, ortho |

---

## Track I — Medical admin phrase map

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| I-01 | eng | done | Expand `CLINIC_TRIGGER_MAP` | 51 clinic triggers; ~90% dental parity — see CODING_PATH_MATRIX |
| I-02 | eng | done | Map admin E/M codes to `plan_rules` seeds | Matches pilot-payer-rules.js |
| I-03 | eng | done | `validateCodesExist` on admin path before collect | No unconditional `code_pair_valid: true` |
| I-04 | eng | done | `UNSUPPORTED_ADMIN_CODE` coverage tests | Honest deferral |

---

## Track J — Voice tools & Kelly integration

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| J-01 | eng | done | Contract tests: search_icd10/cpt/hcpcs, validate_code_pair, suggest_codes | Dual-source where applicable |
| J-02 | eng | done | Enforce `run_triage_rag` before `collect_insurance` in CI | coding-spine-checks.cjs |
| J-03 | eng | done | No client `service_code` on HTTP collect | verify-kelly-http-collect.cjs |
| J-04 | eng | done | Block coding tools in demo/sales modes | tool-allowlists.js |
| J-05 | eng | done | Quote-before-book uses resolved codes only | journey-gates-service.js |

---

## Track K — Eval, CI, prod parity

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| K-01 | eng | done | `eval:coding:fast` keyword-only on PR | `npm run eval:coding:fast`; wire ci-local.sh |
| K-02 | eng | operator_pending | `eval:coding:prod` Pinecone+semantic nightly | `npm run eval:coding:prod`; nightly job pending |
| K-03 | eng | done | Golden cases 61 → 150+ | voice-agent-test-cases.json |
| K-04 | eng | done | `audit-eval-cpt-coverage.cjs` in CI | Per-specialty CPT prefixes |
| K-05 | eng | done | `capture-coding-prod-evidence` after voice deploy | Script + OPERATIONS deploy checklist; run post-deploy for evidence |
| K-06 | eng/ops | done | `verify-live-spine` + `verify-triage-spine` on staging w/ Pinecone | Green on staging DB 2026-07-10 (`remote_source: pinecone`) |
| K-07 | eng | done | `terminal-coding-call.cjs --no-assist` in CI | No synthetic 99213 |
| K-08 | eng | done | Extend `coding-layer-leaks.test.js` | New bypass paths covered |

---

## Track L — Telemetry, HITL, learning loop

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| L-01 | eng | done | `coding_provenance` Kelly events on every collect | coding-spine-checks |
| L-02 | eng/ops | done | HITL admin workflow SLA | coding-reviews.html |
| L-03 | eng | done | Claim feedback → `code_acceptance_rates` for voice | `InsuranceService.applyClaimAdjudicationOutcome` + `code-acceptance-webhook.test.js` |
| L-04 | eng | done | Auto POS + telehealth modifiers from resolved codes | billing-claim-envelope-service.js |

---

## Track M — Coding handoff to dollar resolution

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| M-01 | eng | done | Confirm `plan_rules` wins over simulate after hotfix | `simulate-eligibility-precedence.test.js` |
| M-02 | eng | done | Persist resolved `service_code` on `eligibility_checks` | Wired via collect; CDT-aware simulate in resolve-amount-due |
| M-03 | eng | done | `computeVisitQuote` always receives spine `primary_cpt` | collect-insurance passes resolved code |
| M-04 | eng | done | Coverage-matrix Jest fixtures | `coverage-matrix-copay.test.js` |

---

## Track N — Governance, licensing, ops resilience

| ID | Owner | Status | Task | Acceptance |
|----|-------|--------|------|------------|
| N-01 | legal | done | CDT licensing review (ADA) | CODEBOOK_LICENSING.md |
| N-02 | eng/compliance | done | PHI audit: Pinecone metadata + triage_rag_results | CODING_PHI_RETENTION.md |
| N-03 | eng | done | Cross-tenant Pinecone isolation test | Tenant A ≠ Tenant B chunks |
| N-04 | eng | done | Pin embedding model version index vs query | Doc in ARCHITECTURE.md |
| N-05 | eng | done | Rollback procedure for codebook imports | ARCHITECTURE.md runbook |
| N-06 | eng | done | End-to-end latency SLA p95 for code resolution | `coding_resolution_latency` events + `CODING_RESOLUTION_P95_MS` |
| N-07 | eng | done | Cost monitoring: Pinecone, embed, Groq per call | `llm_usage_log` + coding_resolution_latency events |
| N-08 | eng | done | Load/concurrency test SQLite + Pinecone + embeddings | load-coding-spine-smoke.cjs |
| N-09 | eng | done | On-call runbook coding-spine outages | CODING_SPINE_OUTAGE.md |
| N-10 | eng | done | RBAC on HITL admin UI | coding-reviews.html |
| N-11 | eng/ops | done | Codebook refresh calendar with owners | CODEBOOK_REFRESH_CALENDAR.md |

---

## Recommended execution order

```text
Week 1 — Trust, routing, legal/privacy
  A-01..A-06, M-01..M-04, G-08, N-01, N-02

Week 2 — Data parity
  B-01..B-07, C-01..C-03, K-05, N-05, N-11

Week 3 — Layer 2 prod truth
  D-01..D-08, F-01..F-03, K-01..K-02, E-01, N-06, N-08

Week 4 — Validation & ranking
  G-01..G-07, F-01, F-02, K-03, N-03, N-04

Week 5 — Dental parity
  H-01..H-09, B-05..B-06, C-02

Week 6 — Admin medical path
  I-01..I-04, A-04

Ongoing — Observability & governance
  L-01..L-04, N-07, N-09, N-10, E-02..E-07, J-01..J-05, K-06..K-08, F-04..F-09
```

---

## Scorecard

| Layer | Status | Notes |
|-------|--------|-------|
| Tenant routing | Done | A-01..A-06 wired + tenant-coding-matrix tests |
| Medical codebook | Dev done / prod operator | B-01..B-07 dev imports pass; prod GCS sync pending |
| Pinecone / RAG | Eng done | D-01..D-08; deploy gate via PINECONE_DEPLOY_GATE |
| Medical admin phrase | Done | I-01..I-04 (~40 CLINIC_TRIGGER_MAP entries) |
| Dental spine | Done | H-01..H-09; CDT 9.9k rows @ 96.8% quality |
| Resolver/validation | Done | G-01..G-08; 32 pair rules |
| Eval/CI | Done | 150 golden cases; ci-local + fixture DB on CI |
| Governance | Done | N-01..N-11 eng items; F-09 operator sign-off pending |

---

## CI gates (post-epic)

**PR:** `verify-codebook-parity` (+ CDT), `verify-pair-validation`, `verify-kelly-http-collect`, `coding-layer-leaks`, `coverage-matrix-copay`, `eval:coding:fast`, `terminal-coding-call --no-assist`

**Nightly:** `eval:coding:prod`, `verify-live-spine` (staging), `capture-coding-prod-evidence`

**Deploy:** `verify:prod-codebook`, `verify:kelly-rails-cloudrun`, Pinecone vector gate, `KELLY_RAILS_FAST_RAG=0`
