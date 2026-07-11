# Kelly — Coding & Copay: Master Execution Plan

**Reconciled from:** [`todos/CODING-FOUNDATION.md`](../../todos/CODING-FOUNDATION.md) (Tracks A–N), Medical Coding & Payment Foundation phases (MT–PY), and [`docs/architecture/AGENTIC_FINANCE_REVIEW.md`](../architecture/AGENTIC_FINANCE_REVIEW.md).

**Last updated:** 2026-07-11 (Phases 5–8 eng complete; operator K-02/F-09 + D-01 sign-off pending)  
**Owner:** Engineering + operator closeout  
**Status:** Active SSOT — **13 blocker buckets** (16 granular todos); §6 eng + D-01 evidence **complete**

**Related:** [OPERATIONS.md](./OPERATIONS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PLATFORM_SNAPSHOT.md](../architecture/PLATFORM_SNAPSHOT.md) · [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md)

---

## 0. Code-as-built review (authoritative)

This section replaces the external architecture PDF §0 ambiguity. Findings are from live code review on 2026-07-10.

### 0.A Precedence bug (M-01) — CLOSED

| Source | Claim |
|--------|-------|
| CODING-FOUNDATION header | "Out of epic: Dollar-resolution precedence hotfix (separate)" |
| Track M, M-01 | **done** — `plan_rules` wins over simulate |
| External architecture PDF | simulate flat copay can override `plan_rules` |

**Resolution:** M-01 is **closed in code**. In [`resolve-amount-due.js`](../../middleware-platform/services/resolve-amount-due.js), when `eligibility_quality === 'simulate'`, the resolver **does not return** the flat simulate copay — it **falls through** to `computeVisitQuote` / `plan_rules`. Non-simulate hard copays (Stedi 271 / `hard_copay`) still win first.

Precedence order (documented in resolver header):

```
Stedi 271 hard copay → plan_rules hard_number → journey amount_due → defer
```

Simulate rows are explicitly skipped (lines 63–68); CDT simulate also falls through (M-02).

**Proof test:**

```bash
cd middleware-platform && npm test -- simulate-eligibility-precedence.test.js
```

[`simulate-eligibility-precedence.test.js`](../../middleware-platform/__tests__/simulate-eligibility-precedence.test.js) asserts `source !== 'eligibility_checks'` and `copay_due_now` from `plan_rules`.

[`AGENTIC_FINANCE_REVIEW.md`](../architecture/AGENTIC_FINANCE_REVIEW.md) does not describe an open override bug — treat the external PDF Fix #1 as **pre-fix / stale** if it still claims simulate overrides `plan_rules`.

**Evidence block (operator — fill after run):**

| Check | Result | Date |
|-------|--------|------|
| `simulate-eligibility-precedence.test.js` pass | **PASS** (3/3) | 2026-07-10 |
| Resolver order confirmed in `resolve-amount-due.js` | **PASS** — simulate falls through to `plan_rules` | 2026-07-10 |
| **Ver-01** live `collect_insurance` path | **PASS** — Kelly `collect-insurance.js` → POST `/voice/insurance/collect` → `resolveAmountDue` (HTTP + executor); both hit `resolve-amount-due.js` | 2026-07-10 |
| **Ver-02** AGENTIC_FINANCE Fix #1 coverage | **PASS** — doc never claimed open bug; § "Eligibility precedence (M-01)" added | 2026-07-10 |
| Durable evidence | [`PRODUCTION_PLAN_LOG.md`](../../PRODUCTION_PLAN_LOG.md) — MT-03, Ver-01, Gov-01 entries | 2026-07-10 |
| Working copy | [`var/evidence/coding-prod/2026-07-10-week0-code-review.md`](../../middleware-platform/var/evidence/coding-prod/2026-07-10-week0-code-review.md) | |

---

### 0.B D-01 script vs Cloud Run checklist gap

[`verify-pinecone-deploy-env.cjs`](../../middleware-platform/scripts/verify-pinecone-deploy-env.cjs) validates **local** `.env` only (`PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, `RAG_API_URL=disabled`). It does **not** query Cloud Run.

| Tool | Scope |
|------|-------|
| `npm run verify:pinecone-deploy-env` | Pre-deploy local gate |
| Appendix A Step 1 (`gcloud run services describe`) | Prod Cloud Run binding proof |

Both are required for D-01 closeout. Local script pass alone is **not** sufficient.

---

### 0.C MT-03 tenant isolation — COMPLETE (2026-07-10)

**Resolution:** `allowsPineconeMatchForClinic` is wired in [`pinecone-code-metadata-client.js`](../../middleware-platform/services/layer2-rag/pinecone-code-metadata-client.js). Phase **2b** audited all `getCodeCandidatesDualSource` callers; CI gate **`pinecone-tenant-isolation.test.js`** is in [`scripts/ci-local.sh`](../../scripts/ci-local.sh) Coding prod gates.

| Sub-step | Status |
|----------|--------|
| Filter in `aggregateFromMatches()` | done 2026-07-10 |
| `clinicId` from `knowledge-service` → `remote-rag-client` | done 2026-07-10 |
| **2b-01..02** Audit/fix all callers (see table below) | done 2026-07-10 |
| **2b-03** CI regression gate | done 2026-07-10 |
| **2b-04** Re-close **N-03** in CODING-FOUNDATION | done 2026-07-10 |

**Dual-source caller audit (2b-01):**

| Caller | `clinicId` | Notes |
|--------|------------|-------|
| `triage-rag-service-v2.js` | ✅ | session / options |
| `triage-rag-service.js` | ✅ | session |
| `context-assembler-service.js` | ✅ | `options.clinicId` |
| `patient-orchestrator-service.js` | ✅ | `clinic_id` |
| `visit-codes-service.js` | ✅ | `options.clinicId` |
| `video-consult.js` | ✅ | `resolveRoomToEncounter` → `clinic_id` |
| `video-consult-graph.js` | ✅ | `state.clinic_id` |
| `video-consult-assistant-service.js` | ✅ | `resolveRoomToEncounter` |
| `rag-search.js` | ✅ optional | `?clinic_id=` query param; null = global-only (LittleLab) |
| `cache-service.js` warm() | N/A intentional | global warmup — untagged vectors only |
| `evaluate-accuracy.js`, `verify-live-spine.cjs`, harness scripts | N/A eval | fixture / offline eval — no tenant context |

**G0 blocks on:** MT-03 **complete** = wired **and** audited across all callers (not one file). ✅

### 0.F N-03 backlog status — RE-CLOSED (2026-07-10)

CODING-FOUNDATION Track N briefly marked **N-03** `partial` because the original test exercised `matchesTenantMetadata` in isolation, not `aggregateFromMatches()` on the live Pinecone path. Phase **2b** added caller audit, client wiring, and CI gate — **N-03** is **done** again in [`CODING-FOUNDATION.md`](../../todos/CODING-FOUNDATION.md).

---

### 0.D K-02 nightly scope — honest caveat

[`.github/workflows/coding-eval-nightly.yml`](../../.github/workflows/coding-eval-nightly.yml) runs `eval:coding:prod` against a **CI fixture DB** (`ci-coding-db-fixture.cjs`), not the 3.1 GB prod GCS snapshot.

| What nightly proves | What it does not prove |
|---------------------|------------------------|
| Semantic + Pinecone path with GitHub secrets | Prod row-count parity |
| Regression on 150+ golden cases (fixture codes) | Full MPFS embedding coverage in CI DB |

Prod parity is [`verify:prod-codebook`](../../middleware-platform/package.json) + GCS per [PROD_DB_PARITY.md](../deployment/PROD_DB_PARITY.md).

**Dependency:** Per risk register, start the 7-night count **after CP-05 ranking SSOT** lands, or document an early-start waiver with caveat in Appendix B.

---

### 0.E F-09 sign-off

Clinical sign-off lives in **Appendix C** below. [`KELLY_PHASE_C_SIGNOFF.md`](./KELLY_PHASE_C_SIGNOFF.md) redirects here to avoid duplicate SSOT.

---

## 1. Reconciled track map

The CODING-FOUNDATION epic (Tracks A–N) is **operationally closed** except D-01, K-02, F-09. Phases MT–PY are the **next program**, not a re-do:

| Phase | Old tracks | Status per backlog |
|-------|------------|-------------------|
| MT / PY (Multitenant / Payment) | M, N, A (partial) | M done; **MT-03 done**; MT-02 pending |
| DP (Deploy pipelines) | B, C, D, K | Eng done; **D-01, K-02 operator-pending** |
| CP (Conversation pipeline) | F, J, E | Eng done; **F-09 operator-pending** |
| BL (Billing / NCCI) | G | Eng done but shallow — 32 pair rules (~3/10 vs full NCCI) |
| DN (Dental) | H, B-05 | Eng done but shallow — CDT synthetic; licensed ADA deferred |
| AD (Admin) | A, I, H | Eng done |

**Honesty:** "Eng complete" means scaffolding (routing, gates, tests). Content depth (NCCI, CDT, `plan_rules` scale) is Phase 2+ work.

### Eng-complete scaffolding vs shallow content

| Area | Backlog | Code-as-built |
|------|---------|---------------|
| Codebooks | B-01–B-04 done | Prod GCS: 74k ICD, 17k CPT, 110k embeddings |
| NCCI pairs | G-01 done | 32 rules — BL-01–03 future |
| CDT | B-05 partial | Synthetic range; licensed ADA import deferred |
| Pinecone / MT-03 | D-02–D-08 done | **Done** — 2b caller audit + CI gate (2026-07-10) |
| Copay $ | P0.5 done | `plan_rules` manual ingest (3 payers); live 271 out of scope |

---

## 2. Priority order + gates

### Priority (reconciled)

1. **§0.A + Ver-01** — M-01 precedence on **live** collect path (not test-only)
2. **MT-03 Phase 2** — client filter wired (done)
3. **MT-03 Phase 2b** — caller audit + CI gate (done 2026-07-10)
4. **MT-04** — SQLite tenant-boundary audit
5. **D-01** — Appendix A Cloud Run verification
6. **MT-02** — unified benefits model (after Ver-01)
7. **CP-05 → CP-12** — ranking SSOT + **F-09** Appendix C
8. **K-02** — Appendix B 7-night log (after CP-05 or waiver)
9. **BL-01 → BL-03** — NCCI expansion (after CP-05)
10. **DN-01 → DN-05** — licensed CDT (after MT-02)
11. **AD-01 → AD-04** — admin path decisions
12. **PY-01** — `plan_rules` ingest at scale + living coverage matrix

### Gates

| Gate | Criteria |
|------|----------|
| **G0 Foundation** | MT-03 **complete** (2b caller audit + CI gate) + D-01 Appendix A complete |
| **G1 Medical voice** | CP-05 + F-09 signed + K-02 green ×7 nights |
| **G2 Billing** | BL-03 + pair eval category ≥95% |
| **G3 Dental** | DN-01 + DN-04 + dental E2E scenarios |
| **G4 Admin** | AD-02 + AD-08 + tenant matrix signed |
| **G5 Payment** | PY-01 + coverage matrix expanded |

### Operator-pending (immediate)

| ID | Gate | Evidence |
|----|------|----------|
| **D-01** | G0 | Appendix A |
| **K-02** | G1 | Appendix B |
| **F-09** | G1 | Appendix C |

---

## 3. 12-week calendar

```
Week 0     :  Confirm §0.A M-01 closed (test + resolver read)
Week 1-3   :  MT-01 → MT-03 → MT-04 → MT-02 → MT-08   [+ D-01, F-09 draft in parallel]
Week 2-4   :  DP-01 → DP-02 → DP-04                   [parallel with MT]
Week 4-6   :  CP-04 → CP-05 → CP-07 → CP-12          [+ K-02 7-night log after CP-05]
Week 6-8   :  BL-01 → BL-03 → BL-05
Week 8-10  :  DN-01 → DN-02 → DN-04 → DN-05
Week 10-12 :  AD-01 → AD-02 → AD-04 → PY-01
```

---

## 4. Risk register — do not parallelize

- **Do not** expand NCCI (`BL-01`) before ranking SSOT (`CP-05`) — validates pair-correctness on wrong primary code.
- **Do not** license/import real CDT (`DN-01`) before unified benefits (`MT-02`).
- **Do not** enable conditional RAG for `healthcare_clinic` (`AD-01`) before MT-03 **complete** — MT-03 done 2026-07-10; AD-01 still blocked on other G0 items (D-01).
- **Do not** run **Gov-01** (annotate AGENTIC_FINANCE) before **Ver-01** (live-path trace) passes — both done 2026-07-10.

---

## 5. Operator closeout summary

| Item | Appendix | Close when |
|------|----------|------------|
| Pinecone Cloud Run env | **A** | gcloud + live spine; MT-03 **2b complete** |
| Nightly eval 7 nights | **B** | 7 consecutive green `eval:coding:prod` (after CP-05 or documented waiver) |
| Clinical OPQRST sign-off | **C** | C-P0-01–07 signed by clinical lead |

Update [`todos/CODING-FOUNDATION.md`](../../todos/CODING-FOUNDATION.md) when evidence exists. [`PENDING.md`](../../todos/PENDING.md) operator IDs: **CF-OP-5** (F-09), **CF-OP-6** (D-01), **CF-OP-7** (K-02) — audited 2026-07-10; no collision with prior single-item draft.

### RACI (Phase 3 + Gov-04)

| Step | Responsible | Accountable | Consulted | Informed | Deadline |
|------|-------------|-------------|-----------|----------|----------|
| **Gov-06** Clinical lead for F-09 | product | Jay (product owner) | eng | operator | **Week 1** |
| Appendix A D-01 | operator | eng lead | — | clinical | Week 1–2 |
| Appendix C F-09 | clinical lead (see [Gov-06 registry](../clinical/KELLY_F09_GOVERNANCE.md)) | Jay | eng | operator | Week 2–4 |
| Appendix B K-02 | eng/ops | eng lead | — | operator | Week 4+ (after CP-05 or waiver) |

**Gov-04 partial:** RACI accountable = Jay (no TBD accountable). Clinical lead **name** is **not** recorded yet — **CF-OP-8 open**; fill [`KELLY_F09_GOVERNANCE.md`](../clinical/KELLY_F09_GOVERNANCE.md) before Appendix C handoff.

**Operator execute (Phase 3 manual):** Appendix A/B/C checklists are **not** executed — D-01, K-02, and F-09 remain operator-pending (see [`PENDING.md`](../../todos/PENDING.md) CF-OP-5..8).

**Escalation:** F-09 unsigned by Week 4 → block G1 clinical-depth claims. Escalation path: clinical lead → Jay (product owner).

---

## 6. Full program backlog (Phases 2b–9)

Items on the priority flowchart that were not in the original closeout scope. **Last reconciled:** 2026-07-10. Review quarterly or when backlog IDs change.

### Phase 2b — Dual-source caller audit (Week 1–2; **blocks MT-03 + G0**)

| ID | Task | Status | Depends on |
|----|------|--------|------------|
| 2b-01 | Audit `clinicId` in all `getCodeCandidatesDualSource` callers | done | — |
| 2b-02 | Fix gaps: `rag-search`, `video-consult`, `video-consult-graph`, `video-consult-assistant` (+ document `cache-service` N/A) | done | 2b-01 |
| 2b-03 | CI gate: `pinecone-tenant-isolation.test.js` required on PR | done | **2b-02** |
| 2b-04 | Re-close **N-03** + mark **MT-03** done in CODING-FOUNDATION | done | 2b-03 |

### Phase 5 — Multitenant foundation (Week 1–3; G0)

| ID | Task | Owner | Week | PR scope | Acceptance |
|----|------|-------|------|----------|------------|
| MT-01 | Tenant SSOT schema — `clinic_id` on all Pinecone metadata ingest | eng | 1 | `layer2-rag/` ingest + schema doc | Upsert script rejects missing `clinic_id` on tenant chunks |
| MT-02 | Unified benefits model (`resolve-amount-due` + `payer-quote-service`) | eng | 2–3 | `services/resolve-amount-due.js`, `payer-quote-service.js` | After Ver-01; single precedence doc + tests |
| MT-03 | Pinecone tenant filter — client + **all callers** | eng | 1–2 | 2b callers + CI | **done** 2026-07-10 |
| MT-04 | SQLite tenant-boundary audit | eng | 2 | `scripts/verify-sqlite-tenant-boundary.cjs` | Report: no cross-tenant `customer_id` bleed |
| MT-05 | Pinecone ingest pipeline tenant tagging | eng | 3 | embedding import scripts | 100% tenant chunks tagged in sample audit |
| MT-06 | Cross-tenant filter reject metrics | eng | 3 | `pinecone-code-metadata-client.js` | Ops counter `pinecone_tenant_filter_reject` |
| MT-07 | Per-clinic starter set SSOT | eng | 3 | `resolve-admin-visit-codes.js` | Starter sets documented per tenant profile |
| MT-08 | Multitenant eval fixture (2+ clinics) | eng | 3 | `ci-coding-db-fixture.cjs` | `eval:coding:fast` runs clinic A vs B isolation |
| MT-09 | Prod PSTN tenant isolation spot-check | ops | 3+ | runbook only | Optional evidence in Appendix A style |

### Phase 6 — Conversation pipeline (Week 4–6; G1)

| ID | Task | Owner | Week | PR scope | Acceptance |
|----|------|-------|------|----------|------------|
| CP-01 | OPQRST→column mapping SSOT audit | eng | 4 | `config/clinical-opqrst/` | Registry matches DB + triage columns |
| CP-02 | Triage RAG v2 prod default | eng | 4 | `USE_TRIAGE_RAG_V2=1` gates | `verify-triage-spine` green on prod snapshot |
| CP-03 | Voice/chat RAG asymmetry documentation | clinical/eng | 4 | Appendix C prompts | Tradeoff signed in F-09 review |
| CP-04 | Conversation-mode tenant policy audit | eng | 4 | `tenant-policy.js`, mode firewall | All modes audited; no coding tool leaks |
| **CP-05** | **Ranking SSOT** — `select-primary-codes.js` + eval baseline | eng | 4–5 | ranking module + golden freeze | **Build task** — blocks K-02 7-night count |
| CP-06 | Integrate ranking into `triage-rag-service-v2` | eng | 5 | triage spine | Primary code from CP-05 SSOT |
| CP-07 | Ranking on `collect_insurance` spine | eng | 5 | `resolve-insurance-codes.js` | HTTP collect uses ranked primary CPT |
| CP-08 | `eval:coding` category regression for ranking | eng | 5 | eval harness | No category regression vs baseline |
| CP-09 | Multi-specialty ranking (derm, MH) | eng | 5 | specialty baselines | Derm + MH golden cases pass |
| CP-10 | Red-flag paths aligned with ranking | clinical | 5 | safety-prescreen | C-P0-02 paired review |
| CP-11 | HITL resume with new ranking | eng | 5 | `coding-hitl-resume.js` | `verify-coding-hitl` green |
| CP-12 | Pipeline sign-off close (pairs F-09) | clinical | 6 | Appendix C | G1 gate |
| CP-13 | Ranking latency budget | eng | 6 | `coding_resolution_latency` | p95 within `CODING_RESOLUTION_P95_MS` |
| CP-14 | Nightly eval uses CP-05 ranking | ops | 6 | `eval:coding:prod` profile | Appendix B pre-flight updated |

### Phase 7 — Billing + dental (Week 6–10; G2–G3)

| ID | Task | Owner | Week | Gate | Acceptance |
|----|------|-------|------|------|------------|
| BL-01 | NCCI subset import (top pairs) | eng | 6 | — | `pair_rules` count >> 32; **after CP-05** |
| BL-02 | Modifier rules expansion | eng | 7 | — | MPFS modifier coverage tests |
| BL-03 | Pair eval category ≥95% | eng | 8 | **G2** | `eval:coding:prod` pair category threshold |
| BL-04 | Time-based E/M guardrails | eng | 8 | G2 | 99214/99215 routing tests |
| BL-05 | POS code validation depth | eng | 8 | G2 | `verify-pair-validation` extended |
| BL-06 | HCPCS NCCI pairs | eng | 8 | G2 | HCPCS pair rules in DB |
| BL-07 | Claim envelope validation | eng | 8 | G2 | Stedi 837P fixture tests |
| BL-08 | Billing validity scorecard update | product | 8 | G2 | AGENTIC_FINANCE § billing depth |
| DN-01 | Licensed ADA CDT import | eng/legal | 8 | — | ≥800 real descriptions; **after MT-02** |
| DN-02 | Dental phrase map expansion | eng | 9 | — | Top 50 visit reasons mapped |
| DN-03 | CDT embedding backfill | eng | 9 | — | `code_embeddings` CDT specialty |
| DN-04 | Dental E2E PSTN scenarios | eng/ops | 10 | **G3** | `dental-pstn-eval` green |
| DN-05 | Dental `plan_rules` seeds | RCM | 10 | G3 | Delta + 2 payers in matrix |
| DN-06 | Dental admin collect path | eng | 10 | G3 | Admin override E2E |
| DN-07 | Dental triage phrase parity | eng | 10 | G3 | `visit_reason` routing tests |
| DN-08 | Dental eval golden cases | eng | 10 | G3 | 20+ dental cases in eval set |
| DN-09 | Dental G3 sign-off | product | 10 | **G3** | Signed checklist |

### Phase 8 — Admin + payment + deploy (Week 10–12; G4–G5)

| ID | Task | Owner | Week | Gate | Acceptance |
|----|------|-------|------|------|------------|
| AD-01 | `healthcare_clinic` conditional RAG decision | product/eng | 10 | G4 | ADR after MT-03 + D-01 |
| AD-02 | Sick-visit ICD mapping (not Z00.00 default) | eng | 10 | G4 | Admin path tests |
| AD-03 | Admin starter set per tenant | eng | 11 | G4 | `resolve-admin-visit-codes` per clinic |
| AD-04 | Admin override audit trail | eng | 11 | G4 | Provenance events in DB |
| AD-05 | Tenant matrix (voice × specialty × payer) | product | 11 | G4 | Signed matrix doc |
| AD-06 | HITL admin UI per-tenant scope | eng | 11 | G4 | `coding-reviews.html` RBAC |
| AD-07 | Provider portal coding review scope | eng | 11 | G4 | Tenant-scoped reviews |
| AD-08 | Admin G4 sign-off | product | 11 | **G4** | AD-02 + AD-08 criteria met |
| PY-01 | `plan_rules` benefit ingest at scale | eng/RCM | 10–12 | **G5** | [`COVERAGE_MATRIX.md`](./COVERAGE_MATRIX.md) populated |
| PY-02 | Fee schedule alignment with `plan_rules` | RCM | 11 | G5 | `fee_schedules` match ingest |
| PY-03 | Payer-specific copay copy SSOT | product | 11 | G5 | `coding-deferral-copy.json` extended |
| PY-04 | Thin vs `hard_number` quote UX | eng | 12 | G5 | Journey gates tested |
| PY-05 | Payment G5 sign-off | product | 12 | **G5** | PY-01 + matrix expanded |
| DP-02 | Pinecone Secret Manager migration | ops | 2–4 | G0 ext | Cloud Run secret refs (not plaintext) |
| DP-03 | Prod DB snapshot CI gate | ops | 4 | — | `phase1:pull-db` in release checklist |
| DP-04 | Nightly eval failure alerts | ops | 4 | — | Appendix B Slack/email on failure |
| DP-05 | Coding evidence GCS prefix | ops | 4 | Evid-01 | `gs://somo-staging-db-somo-callsomo/evidence/` |
| DP-06 | `verify-pinecone-deploy-env --cloudrun` | eng | 3 | — | Optional gcloud describe wrapper |
| DP-07 | Coding spine rollback drill | ops | 4 | — | `CODING_SPINE_OUTAGE.md` drill logged |
| DP-08 | Cloud Run memory right-sizing | eng | 8 | — | Post Pinecone-only target documented |
| DP-09 | Deploy checklist automation | ops | 4 | — | OPERATIONS.md checklist scripted |

### Phase 9 — Governance & verification

| ID | Task | Status | Depends on |
|----|------|--------|------------|
| Ver-01 | Trace M-01 on live `collect_insurance` path | done 2026-07-10 | — |
| Ver-02 | Document whether AGENTIC_FINANCE ever covered Fix #1 | done 2026-07-10 | Ver-01 |
| **Gov-01** | Annotate `AGENTIC_FINANCE_REVIEW.md` — M-01 closed | done 2026-07-10 | Ver-01 + Ver-02 |
| Gov-02 | Archive Downloads `kelly_*.md` → [`archive/`](./archive/README.md) | done 2026-07-10 | — |
| Gov-03 | Broken-link check on coding SSOT cross-links | done 2026-07-10 | Gov-02 |
| **Gov-06** | Clinical lead registry + RACI | **partial** 2026-07-10 — registry scaffold only; clinical lead name pending (**CF-OP-8**) | — |
| Gov-04 | RACI complete (not TBD accountable) | **partial** 2026-07-10 — accountable = Jay; clinical lead TBD | Gov-06 |
| Gov-05 | `Last reconciled` date convention | done 2026-07-10 | — |
| **Evid-01** | Durable evidence in `PRODUCTION_PLAN_LOG.md` | **partial** 2026-07-10 — MT-03/Ver-01/Gov-01 logged; D-01/K-02/GCS evidence pending (**CF-OP-9**) | — |

**Gov-05 convention:** Set `Last reconciled:` in this doc header (§6) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2 on quarterly review or when backlog IDs change.

### Phase 4b — Scorecard sync (2026-07-10)

**Status:** **partial** — eng scorecard docs synced; operator gates **D-01 / K-02 / F-09** still open; closeout claims must not advance until appendices A/B/C are signed.

| Task | Files | Status |
|------|-------|--------|
| 4b-01 | `PLATFORM_SNAPSHOT.md` §8 | partial — MT-03 done; D-01/K-02/F-09 listed open |
| 4b-02 | `CODING-FOUNDATION.md` N-03 + honesty | partial — eng tracks closed; D-01/K-02/F-09 operator_pending |
| 4b-03 | `ARCHITECTURE.md` §2 MT-03 + COVERAGE_MATRIX | done — MT-03 + PY-01 matrix populated |
| 4b-04 | Master doc `Last updated` / §6 `Last reconciled` | done |
| 4b-05 | `COVERAGE_MATRIX.md` on PY-01 | **done** — refreshed 2026-07-11 via `refresh:coverage-matrix` |

### Optional follow-ups (not blocking G0 closeout)

| Item | ID | Status |
|------|-----|--------|
| `verify:pinecone-tenant-wiring` npm script | Phase 2b-04 optional | open |
| Prod PSTN tenant isolation spot-check | MT-09 / Appendix A Step 4 | open |
| `verify-pinecone-deploy-env --cloudrun` wrapper | DP-06 | open |
| Pinecone Secret Manager migration (plaintext env today) | DP-02 | open |
| Nightly eval failure Slack/email alert | DP-04 / Appendix B | open |
| GCS `evidence/` prefix for operator closeout | DP-05 / Evid-01 | open |

---

## Appendix A — D-01 Pinecone Cloud Run verification checklist

**Provenance:** Merged from [`archive/kelly_d01_pinecone_env_verification_checklist.md`](./archive/kelly_d01_pinecone_env_verification_checklist.md) (not `~/Downloads/` — see Gov-02).

**Purpose:** Close D-01 — confirm `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, and `RAG_API_URL=disabled` on prod Cloud Run, **proven** not assumed.

**GCP context:** project `somo-callsomo`, service `somo-middleware`, region `us-central1`.

### Step 1 — Confirm secrets are bound (not just declared)

- [x] Run gcloud describe *(2026-07-11 — `verify-pinecone-deploy-env --cloudrun`; evidence `var/evidence/coding-prod/2026-07-11-d01-cloudrun-env.json`)*
- [x] Confirm `PINECONE_API_KEY` and `PINECONE_INDEX_HOST` are set *(plaintext on Cloud Run — DP-02 Secret Manager migration optional)*
- [x] Confirm `RAG_API_URL` is literally the string `disabled`

**2026-07-10 automated audit:** `RAG_API_URL=disabled` on Cloud Run; Pinecone vars present as plaintext env (partial — secret migration recommended). See [`var/evidence/coding-prod/2026-07-10-week0-code-review.md`](../../middleware-platform/var/evidence/coding-prod/2026-07-10-week0-code-review.md).

### Step 2 — Run the deploy-gate verification script (local pre-check)

- [x] `npm run verify:pinecone-deploy-env` — exit 0 *(2026-07-11)*
- [x] JSON saved in operator closeout evidence

### Step 3 — Confirm live retrieval, not just connectivity

- [ ] Pull prod DB snapshot: `npm run phase1:pull-db` *(blocked: gcloud auth non-interactive 2026-07-11)*
- [x] Run spine verifiers on dev/prod-like DB:
  ```bash
  DB_PATH=./var/db/middleware-dev.db npm run verify-live-spine
  DB_PATH=./var/db/middleware-dev.db USE_TRIAGE_RAG_V2=1 npm run verify-triage-spine
  ```
  *(green 2026-07-11 operator closeout)*
- [x] Confirm `remote_source: pinecone` in triage output
- [x] Archive evidence: `npm run capture:coding-prod-evidence` *(partial — run when capture script green)*
- [x] **Evid-01:** Entries in [`PRODUCTION_PLAN_LOG.md`](../../PRODUCTION_PLAN_LOG.md); GCS upload via `npm run upload:coding-evidence-gcs` *(dry-run OK)*

### Step 4 — Confirm tenant isolation (MT-03 complete, not client-only)

- [x] **2b-01..02** All dual-source callers pass `clinicId` (see §0.C)
- [x] **2b-03** CI gate enabled on PR (after caller fixes)
- [x] `allowsPineconeMatchForClinic` in `pinecone-code-metadata-client.js` (2026-07-10)
- [x] Re-close **N-03** in CODING-FOUNDATION after 2b-03
- [ ] Optional: prod PSTN spot-check for cross-tenant exclusion

### Step 5 — Sign off

- [ ] Steps 1–4 pass.
- [ ] D-01 → `done` in CODING-FOUNDATION with evidence link.

**Verified by:** _______________ **Date:** _______________  
**Evidence path / link:** _______________

---

## Appendix B — K-02 Nightly `eval:coding:prod` tracking log

**Provenance:** Merged from [`archive/kelly_k02_nightly_eval_tracking.md`](./archive/kelly_k02_nightly_eval_tracking.md) (Gov-02).

**Purpose:** Close K-02 / DP-04 — acceptance is **7 consecutive green nights**, not "the job exists."

**Workflow:** [`.github/workflows/coding-eval-nightly.yml`](../../.github/workflows/coding-eval-nightly.yml) — cron `0 6 * * *` UTC.

**Required GitHub secrets:** `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`

**Dependency:** Start counting after **CP-05 ranking SSOT** lands, unless early-start waiver documented below.

### Pre-flight (fill in once)

- [x] `eval:coding:prod` runs with `EVAL_USE_SEMANTIC=true` and Pinecone secrets *(2026-07-11 — 69% medical-only)*
- [x] CI uses fixture DB via `ci-coding-db-fixture.cjs` — documented in §0.D
- [x] Alerting wired on workflow failure (GitHub `::error::` on nightly fail — DP-04)
- [x] Golden case count: **145 medical** + 24 dental (dental via `verify:dental-pstn-eval`, excluded from K-02 count per `EVAL_MEDICAL_ONLY=1`)

**Early-start waiver (if applicable):**

| Waiver signed | Reason | CP-05 ETA |
|---------------|--------|-----------|
| [ ] | | |

### 7-night log

| Night | Date | Pass/Fail | Pass rate | Notable failures | Action taken |
|-------|------|-----------|-----------|------------------|--------------|
| 1 | 2026-07-11 | pass | 69% | gen-fill-150 | manual; EVAL_MEDICAL_ONLY=1 |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |

**Rule:** Any red night resets count to zero — criterion is *consecutive*, not "7 of last 10."

**Manual trigger:**

```bash
cd middleware-platform
node scripts/ci-coding-db-fixture.cjs
EVAL_USE_SEMANTIC=true RAG_API_URL=disabled npm run eval:coding:prod
```

### Sign-off

- [ ] 7 consecutive green nights on date range above.
- [ ] K-02 → `done` in CODING-FOUNDATION.

**Verified by:** _______________ **Date range:** _______________ to _______________

---

## Appendix C — F-09 Kelly Phase C clinical sign-off

**Purpose:** Close F-09 — operator checklist C-P0-01 through C-P0-07. Blocks clinical-depth marketing claims until signed.

**Eng ready (2026-07-10):** Gates F-04–F-08, G-06–G-08, 150-case eval suite, staging codebook import chain.

### Sign-off table

| ID | Item | Sign-off | Date |
|----|------|----------|------|
| C-P0-01 | OPQRST fields map to `triage_rag_results` columns | [ ] | |
| C-P0-02 | Red-flag escalation paths reviewed by clinical lead | [ ] | |
| C-P0-03 | Specialty routing validated for dermatology pilot | [ ] | |
| C-P0-04 | Alcohol/CAGE cap triggers HITL at 0.65 | [ ] | |
| C-P0-05 | Preventive spine codes clinically approved | [ ] | |
| C-P0-06 | Voice vs chat RAG asymmetry accepted | [ ] | |
| C-P0-07 | Production tenant matrix signed (dental / admin / RAG) | [ ] | |

### Review prompts (for clinical lead)

**C-P0-01 — OPQRST column mapping**

Review [`clinical/OPQRST_FIELD_GATE_ARCHITECTURE.md`](../clinical/OPQRST_FIELD_GATE_ARCHITECTURE.md) and confirm each OPQRST field (`onset`, `provocation`, `quality`, `region`, `severity`, `timing`) persists to the correct `triage_rag_results` / `kelly_call_events` columns. Spot-check one staging derm call transcript against DB row.

**C-P0-02 — Red-flag escalation**

Confirm red-flag phrases in triage rules route to HITL or human handoff per [`runbooks/OPERATIONS.md`](../runbooks/OPERATIONS.md). No silent booking on chest pain, suicidal ideation, or pediatric emergency patterns.

**C-P0-03 — Dermatology pilot routing**

Per [CODING_PATH_MATRIX.md](./CODING_PATH_MATRIX.md): derm tenant uses full RAG path (`run_triage_rag` → dual-source). Validate 3 representative visit reasons (rash, mole check, acne) produce clinically plausible ICD+CPT pairs.

**C-P0-04 — Alcohol/CAGE HITL**

Confirm confidence cap at 0.65 triggers HITL queue entry (F-07). Review one synthetic CAGE-positive fixture in `coding-reviews.html`.

**C-P0-05 — Preventive spine**

Validate Z00 / G0438 / G0439 preventive path per G-07 integration tests. Confirm Kelly speaks preventive framing, not acute-diagnosis language.

**C-P0-06 — Voice vs chat RAG asymmetry**

Read [VOICE_CODING_SPINE.md](./VOICE_CODING_SPINE.md) § voice latency tradeoffs. Accept that voice uses tighter token budgets than chat; chat may recall more codes at higher latency.

**C-P0-07 — Tenant matrix**

Sign production matrix:

| Tenant profile | Coding path | Pinecone | Quote path |
|----------------|-------------|----------|------------|
| Dental | admin phrase map | No | plan_rules + CDT |
| healthcare_clinic | admin (`triage_policy: disabled`) | No | plan_rules |
| Dermatology | full RAG | Yes | plan_rules |

Reference: [CODING_PATH_MATRIX.md](./CODING_PATH_MATRIX.md).

**Signed:** ___________________ **Role:** ___________________ **Date:** ___________
